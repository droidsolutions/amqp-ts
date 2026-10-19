/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { Channel, ChannelModel, Options } from "amqplib";
import * as os from "node:os";
import { ApplicationName, DIRECT_REPLY_TO_QUEUE } from "../amqp-ts.js";
import { Binding } from "../Binding.js";
import { Connection } from "../Connection/Connection.js";
import { Deferred } from "../Deferred.js";
import { SimpleLogger } from "../LoggerFactory.js";
import { Message } from "../Message.js";
import { DeclarationOptions } from "./DeclarationOptions.js";
import { ExchangeType } from "./ExchangeType.js";
import { InitializeResult } from "./InitializeResult.js";

/**
 * Represents an exchange.
 */
export class Exchange {
  /**
   * A promise that resolves once the exchange is initialized. It is replaced by a pending promise while the exchange
   * is re-initialized after a lost connection or a closed channel.
   */
  public initialized: Promise<InitializeResult>;
  /** The underlying AMQP channel. */
  public _channel: Channel;
  /** Gets the name of the exchange. */
  public get name(): string {
    return this._name;
  }
  /** Gets the type of the exchange. */
  public get type(): string {
    return this._type;
  }

  private _consumer_handlers: Array<[string, any]> = new Array<[string, any]>();
  private _isConsumerInitializedRcp = false;
  private _name: string;
  private _type: ExchangeType;
  private _deleting: Promise<void>;
  private _closing: Promise<void>;
  private log: SimpleLogger;
  private _deferred: Deferred<InitializeResult>;
  /** The generation of the last initialization, and that initialization. */
  private _generation: number | undefined;
  private _initializing: Promise<void> = Promise.resolve();
  /** Changes with every initialization, so a superseded one can tell. */
  private _attempt = 0;
  /** The channel the exchange was successfully declared on. */
  private _readyChannel: Channel | undefined;

  /**
   * Initializes a new instance of the @see Exchange class.
   *
   * @summary Initializes an exchange by creating a channel and asserting the exchange exists on it. Once done the
   * {@link initialized} promise will resolve.
   * @param connection The AMQP connection.
   * @param name The name of the exchange.
   * @param type The type of the exchange.
   * @param options Any declaration otions.
   */
  constructor(
    public connection: Connection,
    name: string,
    type?: ExchangeType,
    private options: DeclarationOptions = {},
  ) {
    this.log = this.connection.loggerFactory(this.constructor, { exchange: name });

    this._name = name;
    this._type = type;
    this._deferred = new Deferred<InitializeResult>();
    this.initialized = this._deferred.promise;
    this.connection._exchanges[this._name] = this;
    // while disconnected the next connect initializes it
    if (this.connection._model) {
      this._initialize(this.connection._model, this.connection._generation).catch(() => {});
    }
  }

  /**
   * Creates a channel on the given model and declares the exchange on it, then settles {@link initialized}. Does
   * nothing if the exchange was already initialized for the given generation.
   * @internal
   */
  public _initialize(model: ChannelModel, generation: number): Promise<void> {
    if (this.connection._exchanges[this._name] !== this) {
      // failed, closed or deleted: only a new declaration brings it back
      return Promise.reject(new Error(`Exchange '${this._name}' is no longer declared`));
    }
    if (this._generation !== generation) {
      this._generation = generation;
      this._initializing = this._declare(model, ++this._attempt);
    }
    return this._initializing;
  }

  /**
   * Replaces a settled {@link initialized} with a pending one, until the exchange is initialized again.
   * @internal
   */
  public _invalidate(): void {
    this._readyChannel = undefined;
    if (this._deferred.settled) {
      this._deferred = new Deferred<InitializeResult>();
      this.initialized = this._deferred.promise;
    }
  }

  private async _declare(model: ChannelModel, attempt: number): Promise<void> {
    try {
      const channel = await model.createChannel();
      channel.on("error", (err: Error) => {
        this.log.warn({ err }, "Channel of exchange '%s' failed: %s", this._name, err.message);
      });
      channel.on("close", () => this._onChannelClose(channel, model));
      if (attempt !== this._attempt) {
        await channel.close().catch(() => {});
        return;
      }
      this._channel = channel;

      const ok = this.options.noCreate
        ? await channel.checkExchange(this._name)
        : await channel.assertExchange(this._name, this._type, this.options);
      if (attempt !== this._attempt) {
        await channel.close().catch(() => {});
        return;
      }
      this._readyChannel = channel;
      this._deferred.resolve(ok as InitializeResult);
    } catch (err) {
      if (attempt !== this._attempt) {
        return;
      }
      if (this.connection._isModelClosed(model)) {
        // the next connect initializes it again, until then initialized stays pending
        this.log.debug({ err }, "Connection lost while initializing exchange '%s'.", this._name);
        throw err;
      }
      this.log.error({ err }, "Failed to create exchange '%s'.", this._name);
      delete this.connection._exchanges[this._name];
      this._deferred.reject(err as Error);
      throw err;
    }
  }

  /**
   * A channel that closes while the connection stays up (for example after a publish to an exchange that was deleted
   * on the broker) is re-created and the exchange declared again. Closes during a failed declaration, on a lost
   * connection or caused by {@link close} or {@link delete} are left alone.
   */
  private _onChannelClose(channel: Channel, model: ChannelModel): void {
    if (channel !== this._readyChannel || this._closing !== undefined || this._deleting !== undefined) {
      return;
    }
    const generation = this._generation;
    this._invalidate();
    // the connection emits its own close right after closing its channels, so look at it once that happened
    queueMicrotask(() => {
      if (!this.connection._isModelUsable(model) || this._generation !== generation) {
        return;
      }
      this.log.warn("Channel of exchange '%s' closed, re-initializing it.", this._name);
      this._generation = undefined;
      this._initialize(model, generation).catch(() => {});
    });
  }

  /**
   * Directly sends a message to this exchange.
   *
   * @param message The message.
   * @param routingKey The routing key of the message.
   */
  public send(message: Message, routingKey = ""): void {
    message.sendTo(this, routingKey);
  }

  public rpc(requestParameters: any, routingKey = "", callback?: (err, message: Message) => void): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      function generateUuid(): string {
        return Math.random().toString() + Math.random().toString() + Math.random().toString();
      }
      const processRpc = (): void => {
        const uuid: string = generateUuid();
        if (!this._isConsumerInitializedRcp) {
          this._isConsumerInitializedRcp = true;
          this._channel
            .consume(
              DIRECT_REPLY_TO_QUEUE,
              (resultMsg) => {
                const result = new Message(resultMsg.content, resultMsg.properties);
                result.fields = resultMsg.fields;
                for (const handler of this._consumer_handlers) {
                  if (handler[0] === resultMsg.properties.correlationId) {
                    const func: () => void = handler[1];
                    func.apply("", [undefined, result]);
                  }
                }
                resolve(result);
              },
              { noAck: true },
            )
            .then(
              (_ok) => {
                if (callback) {
                  // send the rpc request
                  this._consumer_handlers.push([uuid, callback]);
                }
                // consumerTag = ok.consumerTag;
                const message = new Message(requestParameters, {
                  correlationId: uuid,
                  replyTo: DIRECT_REPLY_TO_QUEUE,
                });
                message.sendTo(this, routingKey);
              },
              /* istanbul ignore next */ (err: Error) => {
                reject(new Error("amqp-ts: Queue.rpc error: " + err.message));
              },
            );
        } else {
          this._consumer_handlers.push([uuid, callback]);
          const message = new Message(requestParameters, {
            correlationId: uuid,
            replyTo: DIRECT_REPLY_TO_QUEUE,
          });
          message.sendTo(this, routingKey);
          resolve(message);
        }
      };

      this.initialized.then(processRpc);
    });
  }

  /**
   * Removes any bindings of this exchange, deletes the exchange and then closes the channel.
   */
  public delete(): Promise<void> {
    if (this._deleting === undefined) {
      this._deleting = (async (): Promise<void> => {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        await this._channel.deleteExchange(this._name, {});
        delete this.connection._exchanges[this._name]; // remove the exchange from our administration
        await this._channel.close();
      })();
    }
    return this._deleting;
  }

  /**
   * Removes any bindings of this exchange and closes the channel.
   */
  public close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = (async (): Promise<void> => {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        delete this.connection._exchanges[this._name]; // remove the exchange from our administration
        await this._channel.close();
      })();
    }
    return this._closing;
  }

  /**
   * Creates a bew binding with this exchange to the given exchange.
   *
   * @param source The source exchange.
   * @param pattern The pattern.
   * @param args Any additonal arguments.
   * @returns A promise that resolves when the binding is initialized.
   */
  public bind(source: Exchange, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }

  /**
   * Unbinds the given exchange from the connection.
   *
   * @param source The exchange to unbind from.
   * @param pattern The pattern.
   * @param _args Any addtional arguments.
   */
  public unbind(source: Exchange, pattern = "", _args: any = {}): Promise<void> {
    return this.connection._bindings[Binding.id(this, source, pattern)].delete();
  }

  /** Returns a string containing the name of the exchange, the name of the host and the process ID. */
  public consumerQueueName(): string {
    return `${this._name}.${ApplicationName}.${os.hostname()}.${process.pid}`;
  }

  /**
   * Declares a queue, binds it to this exchange and activates the given consumer handler on the queue. The name of the
   * queue is determined by the name of the exchange, the application, the host and the ID of the process. Calling this
   * twice without @see stopConsumer between the calls will likely fail.
   *
   * @param onMessage The message handler.
   * @param options Any consumer options. See
   * @link https://www.squaremobius.net/amqp.node/channel_api.html#channel_consume for more information.
   * @throws {Error} If a handler has already been registered for this queue.
   */
  public activateConsumer(onMessage: (msg: Message) => any, options?: Options.Consume): Promise<any> {
    const queueName = this.consumerQueueName();
    if (this.connection._queues[queueName]) {
      return Promise.reject(new Error("amqp-ts Exchange.activateConsumer error: consumer already defined"));
    } else {
      const promises: Promise<any>[] = [];
      const queue = this.connection.declareQueue(queueName, { durable: false });
      promises.push(queue.initialized);
      const binding = queue.bind(this);
      promises.push(binding);
      const consumer = queue.activateConsumer(onMessage, options);
      promises.push(consumer);
      return Promise.all(promises);
    }
  }

  /**
   * Removes the bindings, the consumer and the queue if any exists.
   */
  public stopConsumer(): Promise<any> {
    const queue = this.connection._queues[this.consumerQueueName()];
    if (queue) {
      return queue.delete();
    } else {
      return Promise.resolve();
    }
  }
}
