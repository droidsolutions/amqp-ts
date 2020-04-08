import { EventEmitter } from "events";
import { Topology } from "./Topology";
import { ReconnectStrategy } from "./ReconnectStrategy";
import { DeclarationOptions as ExchangeDeclarationOptions } from "../Exchange/DeclarationOptions";
import { Exchange } from "../Exchange/Exchange";
import { log } from "../amqp-ts";
import { Binding } from "../Binding";
import { Queue } from "../Queue/Queue";
import { DeclarationOptions as QueueDeclrationOptions } from "../Queue/DeclarationOptions";
import * as AmqpLib from "amqplib/callback_api";

export class Connection extends EventEmitter {
  initialized: Promise<void>;
  private url: string;
  private socketOptions: any;
  private reconnectStrategy: ReconnectStrategy;
  private connectedBefore = false;
  _connection: AmqpLib.Connection;
  _retry: number;
  _rebuilding: boolean = false;
  _isClosing: boolean = false;
  public isConnected: boolean = false;
  _exchanges: {
    [id: string]: Exchange;
  };
  _queues: {
    [id: string]: Queue;
  };
  _bindings: {
    [id: string]: Binding;
  };
  constructor(
    url = "amqp://localhost",
    socketOptions: any = {},
    reconnectStrategy: ReconnectStrategy = { retries: 0, interval: 1500 },
  ) {
    super();
    this.url = url;
    this.socketOptions = socketOptions;
    this.reconnectStrategy = reconnectStrategy;
    this._exchanges = {};
    this._queues = {};
    this._bindings = {};
    this.rebuildConnection();
  }
  private rebuildConnection(): Promise<void> {
    if (this._rebuilding) {
      // only one rebuild process can be active at any time
      log.log("debug", "Connection rebuild already in progress, joining active rebuild attempt.", {
        module: "amqp-ts",
      });
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
            log.log("warn", "Connection re-established", { module: "amqp-ts" });
            this.emit("re_established_connection");
          } else {
            log.log("info", "Connection established.", { module: "amqp-ts" });
            this.emit("open_connection");
            this.connectedBefore = true;
          }
          resolve(null);
        }
      });
    });
    /* istanbul ignore next */
    this.initialized.catch((err) => {
      log.log("warn", "Error creating connection!", { module: "amqp-ts" });
      this.emit("error_connection", err);
      //throw (err);
    });
    return this.initialized;
  }
  private tryToConnect(thisConnection: Connection, retry: number, callback: (err: any) => void): void {
    AmqpLib.connect(thisConnection.url, thisConnection.socketOptions, (err, connection) => {
      /* istanbul ignore if */
      if (err) {
        thisConnection.isConnected = false;
        // only do every retry once, amqplib can return multiple connection errors for one connection request (error?)
        if (retry <= this._retry) {
          //amqpts_log.log("warn" , "Double retry " + retry + ", skipping.", {module: "amqp-ts"});
          return;
        }
        log.log("warn", "Connection failed.", { module: "amqp-ts" });
        this._retry = retry;
        if (thisConnection.reconnectStrategy.retries === 0 || thisConnection.reconnectStrategy.retries > retry) {
          log.log(
            "warn",
            "Connection retry " + (retry + 1) + " in " + thisConnection.reconnectStrategy.interval + "ms",
            { module: "amqp-ts" },
          );
          thisConnection.emit("trying_connect");
          setTimeout(
            thisConnection.tryToConnect,
            thisConnection.reconnectStrategy.interval,
            thisConnection,
            retry + 1,
            callback,
          );
        } else {
          //no reconnect strategy, or retries exhausted, so return the error
          log.log("warn", "Connection failed, exiting: No connection retries left (retry " + retry + ").", {
            module: "amqp-ts",
          });
          callback(err);
        }
      } else {
        var restart = (err: Error) => {
          log.log("debug", "Connection error occurred.", {
            module: "amqp-ts",
          });
          connection.removeListener("error", restart);
          //connection.removeListener("end", restart); // not sure this is needed
          thisConnection._rebuildAll(err); //try to rebuild the topology when the connection  unexpectedly closes
        };
        var onClose = () => {
          connection.removeListener("close", onClose);
          if (!this._isClosing) {
            thisConnection.emit("lost_connection");
            restart(new Error("Connection closed by remote host"));
          }
        };
        connection.on("error", restart);
        connection.on("close", onClose);
        //connection.on("end", restart); // not sure this is needed
        thisConnection._connection = connection;
        thisConnection.isConnected = true;
        callback(null);
      }
    });
  }
  _rebuildAll(err: Error): Promise<void> {
    log.log("warn", "Connection error: " + err.message, { module: "amqp-ts" });
    log.log("debug", "Rebuilding connection NOW.", { module: "amqp-ts" });
    this.rebuildConnection();
    //re initialize exchanges, queues and bindings if they exist
    for (var exchangeId in this._exchanges) {
      var exchange = this._exchanges[exchangeId];
      log.log("debug", "Re-initialize Exchange '" + exchange._name + "'.", {
        module: "amqp-ts",
      });
      exchange._initialize();
    }
    for (var queueId in this._queues) {
      var queue = this._queues[queueId];
      var consumer = queue._consumer;
      log.log("debug", "Re-initialize queue '" + queue._name + "'.", {
        module: "amqp-ts",
      });
      queue._initialize();
      if (consumer) {
        log.log("debug", "Re-initialize consumer for queue '" + queue._name + "'.", { module: "amqp-ts" });
        queue._initializeConsumer();
      }
    }
    for (var bindingId in this._bindings) {
      var binding = this._bindings[bindingId];
      log.log(
        "debug",
        "Re-initialize binding from '" + binding._source._name + "' to '" + binding._destination._name + "'.",
        { module: "amqp-ts" },
      );
      binding._initialize();
    }
    return new Promise<void>((resolve, reject) => {
      this.completeConfiguration().then(
        () => {
          log.log("debug", "Rebuild success.", { module: "amqp-ts" });
          resolve(null);
        },
        /* istanbul ignore next */ (rejectReason) => {
          log.log("debug", "Rebuild failed.", { module: "amqp-ts" });
          reject(rejectReason);
        },
      );
    });
  }
  close(): Promise<void> {
    this._isClosing = true;
    return new Promise<void>((resolve, reject) => {
      this.initialized.then(() => {
        this._connection.close((err) => {
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
   * Make sure the whole defined connection topology is configured:
   * return promise that fulfills after all defined exchanges, queues and bindings are initialized
   */
  completeConfiguration(): Promise<any> {
    var promises: Promise<any>[] = [];
    for (var exchangeId in this._exchanges) {
      var exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.initialized);
    }
    for (var queueId in this._queues) {
      var queue: Queue = this._queues[queueId];
      promises.push(queue.initialized);
      if (queue._consumerInitialized) {
        promises.push(queue._consumerInitialized);
      }
    }
    for (var bindingId in this._bindings) {
      var binding: Binding = this._bindings[bindingId];
      promises.push(binding.initialized);
    }
    return Promise.all(promises);
  }
  /**
   * Delete the whole defined connection topology:
   * return promise that fulfills after all defined exchanges, queues and bindings have been removed
   */
  deleteConfiguration(): Promise<any> {
    var promises: Promise<any>[] = [];
    for (var bindingId in this._bindings) {
      var binding: Binding = this._bindings[bindingId];
      promises.push(binding.delete());
    }
    for (var queueId in this._queues) {
      var queue: Queue = this._queues[queueId];
      if (queue._consumerInitialized) {
        promises.push(queue.stopConsumer());
      }
      promises.push(queue.delete());
    }
    for (var exchangeId in this._exchanges) {
      var exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.delete());
    }
    return Promise.all(promises);
  }
  declareExchange(name: string, type?: string, options?: ExchangeDeclarationOptions): Exchange {
    var exchange = this._exchanges[name];
    if (exchange === undefined) {
      exchange = new Exchange(this, name, type, options);
    }
    return exchange;
  }
  declareQueue(name: string, options?: QueueDeclrationOptions): Queue {
    var queue = this._queues[name];
    if (queue === undefined) {
      queue = new Queue(this, name, options);
    }
    return queue;
  }
  declareTopology(topology: Topology): Promise<any> {
    var promises: Promise<any>[] = [];
    var i: number;
    var len: number;
    if (topology.exchanges !== undefined) {
      for (i = 0, len = topology.exchanges.length; i < len; i++) {
        var exchange = topology.exchanges[i];
        promises.push(this.declareExchange(exchange.name, exchange.type, exchange.options).initialized);
      }
    }
    if (topology.queues !== undefined) {
      for (i = 0, len = topology.queues.length; i < len; i++) {
        var queue = topology.queues[i];
        promises.push(this.declareQueue(queue.name, queue.options).initialized);
      }
    }
    if (topology.bindings !== undefined) {
      for (i = 0, len = topology.bindings.length; i < len; i++) {
        var binding = topology.bindings[i];
        var source = this.declareExchange(binding.source);
        var destination: Queue | Exchange;
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
  get getConnection(): AmqpLib.Connection {
    return this._connection;
  }
}
