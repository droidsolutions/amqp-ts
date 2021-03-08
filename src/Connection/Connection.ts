import * as AmqpLib from "amqplib/callback_api";
import { EventEmitter } from "events";
import { Binding } from "../Binding";
import { DeclarationOptions as ExchangeDeclarationOptions } from "../Exchange/DeclarationOptions";
import { Exchange } from "../Exchange/Exchange";
import { ExchangeType } from "../Exchange/ExchangeType";
import { EmtpyLogger, LoggerFactory, SimpleLogger } from "../LoggerFactory";
import { DeclarationOptions as QueueDeclrationOptions } from "../Queue/DeclarationOptions";
import { Queue } from "../Queue/Queue";
import { ReconnectStrategy } from "./ReconnectStrategy";
import { Topology } from "./Topology";

export class Connection extends EventEmitter {
  public initialized: Promise<void>;
  public connection: AmqpLib.Connection;
  public isConnected = false;
  public _exchanges: {
    [id: string]: Exchange;
  };
  public _queues: {
    [id: string]: Queue;
  };
  public _bindings: {
    [id: string]: Binding;
  };

  private url: string;
  private socketOptions: any;
  private reconnectStrategy: ReconnectStrategy;
  private connectedBefore = false;
  private _retry: number;
  private _rebuilding = false;
  private _isClosing = false;
  private log: SimpleLogger;

  /**
   *
   * @param url The url to RabbitMQ
   * @param socketOptions Socket options are passed to {@link AmqpLib.connect}.
   * @param reconnectStrategy Options specifying the reconnect strategy.
   * @param loggerFactory A factory function that returns a logger.
   */
  constructor(
    url = "amqp://localhost",
    socketOptions: any = {},
    reconnectStrategy: ReconnectStrategy = { retries: 0, interval: 1500 },
    public loggerFactory?: LoggerFactory,
  ) {
    super();
    if (!this.loggerFactory) {
      this.loggerFactory = (_, __): SimpleLogger => new EmtpyLogger();
    }
    this.log = this.loggerFactory(this.constructor, { module: "amqp-ts" });

    this.url = url;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.socketOptions = socketOptions;
    this.reconnectStrategy = reconnectStrategy;
    this._exchanges = {};
    this._queues = {};
    this._bindings = {};
    this.rebuildConnection();
  }

  public tryToConnect(thisConnection: Connection, retry: number, callback: (err: any) => void): void {
    AmqpLib.connect(thisConnection.url, thisConnection.socketOptions, (err: Error, connection) => {
      /* istanbul ignore if */
      if (err) {
        thisConnection.isConnected = false;
        // only do every retry once, amqplib can return multiple connection errors for one connection request (error?)
        if (retry <= this._retry) {
          //amqpts_log.log("warn" , "Double retry " + retry + ", skipping.", {module: "amqp-ts"});
          return;
        }
        this.log.warn({ err }, "Connection failed.");
        this._retry = retry;
        if (thisConnection.reconnectStrategy.retries === 0 || thisConnection.reconnectStrategy.retries > retry) {
          this.log.warn("Connection retry %d in %d ms", retry + 1, thisConnection.reconnectStrategy.interval);
          thisConnection.emit("trying_connect");
          setTimeout(
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            thisConnection.tryToConnect.bind(this),
            thisConnection.reconnectStrategy.interval,
            thisConnection,
            retry + 1,
            callback,
          );
        } else {
          //no reconnect strategy, or retries exhausted, so return the error
          this.log.warn("Connection failed, exiting: No connection retries left (retry %d).", retry);
          callback(err);
        }
      } else {
        const restart = (err: Error): void => {
          this.log.debug({ err }, "Connection error occurred.");
          connection.removeListener("error", restart);
          //connection.removeListener("end", restart); // not sure this is needed
          thisConnection._rebuildAll(err); //try to rebuild the topology when the connection  unexpectedly closes
        };
        const onClose = (): void => {
          connection.removeListener("close", onClose);
          if (!this._isClosing) {
            thisConnection.emit("lost_connection");
            restart(new Error("Connection closed by remote host"));
          }
        };
        connection.on("error", restart);
        connection.on("close", onClose);
        //connection.on("end", restart); // not sure this is needed
        thisConnection.connection = connection;
        thisConnection.isConnected = true;
        callback(null);
      }
    });
  }

  public _rebuildAll(err: Error): Promise<void> {
    this.log.warn({ err }, "Connection error: %s", err.message);
    this.log.debug("Rebuilding connection NOW.");
    this.rebuildConnection();
    //re initialize exchanges, queues and bindings if they exist
    for (const exchangeId in this._exchanges) {
      const exchange = this._exchanges[exchangeId];
      this.log.debug("Re-initialize Exchange '%s'.", exchange.name);
      exchange._initialize();
    }
    for (const queueId in this._queues) {
      const queue = this._queues[queueId];
      const consumer = queue._consumer;
      this.log.debug("Re-initialize queue '%s'.", queue.name);
      queue._initialize();
      if (consumer) {
        this.log.debug("Re-initialize consumer for queue '%s'.", queue.name);
        queue._initializeConsumer();
      }
    }
    for (const bindingId in this._bindings) {
      const binding = this._bindings[bindingId];
      this.log.debug("Re-initialize binding from '%s' to '%s'.", binding._source.name, binding._destination.name);
      binding._initialize();
    }
    return new Promise<void>((resolve, reject) => {
      this.completeConfiguration().then(
        () => {
          this.log.debug("Rebuild success.");
          resolve(null);
        },
        /* istanbul ignore next */ (rejectReason) => {
          this.log.debug("Rebuild failed.");
          reject(rejectReason);
        },
      );
    });
  }

  public close(): Promise<void> {
    this._isClosing = true;
    return new Promise<void>((resolve, reject) => {
      this.initialized.then(() => {
        this.connection.close((err) => {
          /* istanbul ignore if */
          if (err) {
            reject(err);
          } else {
            this.isConnected = false;
            this.emit("close_connection");
            resolve(null);
          }
        });
      });
    });
  }

  /**
   * Make sure the whole defined connection topology is configured. Goes through each exchange, queue and binding and
   * waits until all of them are initialized.
   *
   * @return A promise that fulfills after all defined exchanges, queues and bindings are initialized.
   */
  public completeConfiguration(): Promise<any> {
    const promises: Promise<any>[] = [];
    for (const exchangeId in this._exchanges) {
      const exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.initialized);
    }
    for (const queueId in this._queues) {
      const queue: Queue = this._queues[queueId];
      promises.push(queue.initialized);
      if (queue._consumerInitialized !== undefined) {
        promises.push(queue._consumerInitialized);
      }
    }
    for (const bindingId in this._bindings) {
      const binding: Binding = this._bindings[bindingId];
      promises.push(binding.initialized);
    }
    return Promise.all(promises);
  }

  /**
   * Delete the whole defined connection topology:
   * return promise that fulfills after all defined exchanges, queues and bindings have been removed
   */
  public deleteConfiguration(): Promise<any> {
    const promises: Promise<any>[] = [];
    for (const bindingId in this._bindings) {
      const binding: Binding = this._bindings[bindingId];
      promises.push(binding.delete());
    }
    for (const queueId in this._queues) {
      const queue: Queue = this._queues[queueId];
      if (queue._consumerInitialized !== undefined) {
        promises.push(queue.stopConsumer());
      }
      promises.push(queue.delete());
    }
    for (const exchangeId in this._exchanges) {
      const exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.delete());
    }
    return Promise.all(promises);
  }

  /**
   * Declares a new exchange. Depdendent on the options it auto creates the exchange if it doesn ot already exists.
   * 
   * @param name The name of the exchange.
   * @param type The type
   * @param options Options that are passed to assertExchange in amqp-lib.
   */
  public declareExchange(name: string, type?: ExchangeType, options?: ExchangeDeclarationOptions): Exchange {
    let exchange = this._exchanges[name];
    if (exchange === undefined) {
      exchange = new Exchange(this, name, type, options);
    }
    return exchange;
  }

  public declareQueue(name: string, options?: QueueDeclrationOptions): Queue {
    let queue = this._queues[name];
    if (queue === undefined) {
      queue = new Queue(this, name, options);
    }
    return queue;
  }

  public declareTopology(topology: Topology): Promise<any> {
    const promises: Promise<any>[] = [];
    let i: number;
    let len: number;
    if (topology.exchanges !== undefined) {
      for (i = 0, len = topology.exchanges.length; i < len; i++) {
        const exchange = topology.exchanges[i];
        promises.push(this.declareExchange(exchange.name, exchange.type, exchange.options).initialized);
      }
    }
    if (topology.queues !== undefined) {
      for (i = 0, len = topology.queues.length; i < len; i++) {
        const queue = topology.queues[i];
        promises.push(this.declareQueue(queue.name, queue.options).initialized);
      }
    }
    if (topology.bindings !== undefined) {
      for (i = 0, len = topology.bindings.length; i < len; i++) {
        const binding = topology.bindings[i];
        const source = this.declareExchange(binding.source);
        let destination: Queue | Exchange;
        if (binding.exchange !== undefined) {
          destination = this.declareExchange(binding.exchange);
        } else {
          destination = this.declareQueue(binding.queue);
        }
        promises.push(destination.bind(source, binding.pattern, binding.args));
      }
    }
    return Promise.all(promises);
  }

  public get getConnection(): AmqpLib.Connection {
    return this.connection;
  }

  private rebuildConnection(): Promise<void> {
    if (this._rebuilding) {
      // only one rebuild process can be active at any time
      this.log.debug("Connection rebuild already in progress, joining active rebuild attempt.");
      return this.initialized;
    }
    this._retry = -1;
    this._rebuilding = true;
    this._isClosing = false;
    // rebuild the connection
    this.initialized = new Promise<void>((resolve, reject) => {
      this.tryToConnect(this, 0, (err) => {
        /* istanbul ignore if */
        if (err) {
          this._rebuilding = false;
          reject(err);
        } else {
          this._rebuilding = false;
          if (this.connectedBefore) {
            this.log.info("Connection re-established");
            this.emit("re_established_connection");
          } else {
            this.log.info("Connection established.");
            this.emit("open_connection");
            this.connectedBefore = true;
          }
          resolve(null);
        }
      });
    });
    /* istanbul ignore next */
    this.initialized.catch((err: Error) => {
      this.log.warn({ err }, "Error creating connection!");
      this.emit("error_connection", err);
      //throw (err);
    });
    return this.initialized;
  }
}
