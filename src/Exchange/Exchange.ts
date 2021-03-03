/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as AmqpLib from "amqplib/callback_api";
import * as os from "os";
import { ApplicationName, DIRECT_REPLY_TO_QUEUE } from "../amqp-ts";
import { Binding } from "../Binding";
import { Connection } from "../Connection/Connection";
import { SimpleLogger } from "../LoggerFactory";
import { Message } from "../Message";
import { DeclarationOptions } from "./DeclarationOptions";
import { ExchangeType } from "./ExchangeType";
import { InitializeResult } from "./InitializeResult";

/**
 * Represents an exchange.
 */
export class Exchange {
  /** A promise that resolves once the exchange is initialized. */
  public initialized: Promise<InitializeResult>;
  /** The underlying AMQP channel. */
  public _channel: AmqpLib.Channel;
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
  constructor(public connection: Connection, name: string, type?: ExchangeType, private options: DeclarationOptions = {}) {
    this.log = this.connection.loggerFactory(this.constructor, { exchange: name });

    this._name = name;
    this._type = type;
    this._initialize();
  }

  /**
   * Initializes the exchange and resolves the @see initialized promise once the initialization is complete.
   */
  public _initialize(): void {
    this.initialized = new Promise<InitializeResult>((resolve, reject) => {
      this.connection.initialized
        .then(() => {
          this.connection.connection.createChannel((createChannelError, channel) => {
            /* istanbul ignore if */
            if (createChannelError) {
              reject(createChannelError);
            } else {
              this._channel = channel;
              const callback = (err: Error, ok: InitializeResult): void => {
                /* istanbul ignore if */
                if (err) {
                  this.log.error({ err }, "Failed to create exchange '%s'.", this._name);
                  delete this.connection._exchanges[this._name];
                  reject(err);
                } else {
                  resolve(ok);
                }
              };
              if (this.options.noCreate) {
                this._channel.checkExchange(this._name, callback);
              } else {
                this._channel.assertExchange(
                  this._name,
                  this._type,
                  this.options as AmqpLib.Options.AssertExchange,
                  callback,
                );
              }
            }
          });
        })
        .catch((err) => {
          this.log.warn({ err }, "Channel failure, error caused during connection!");
        });
    });
    this.connection._exchanges[this._name] = this;
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

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  public rpc(requestParameters: any, routingKey = "", callback?: (err, message: Message) => void): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      function generateUuid(): string {
        return Math.random().toString() + Math.random().toString() + Math.random().toString();
      }
      const processRpc = (): void => {
        const uuid: string = generateUuid();
        if (!this._isConsumerInitializedRcp) {
          this._isConsumerInitializedRcp = true;
          this._channel.consume(
            DIRECT_REPLY_TO_QUEUE,
            (resultMsg) => {
              const result = new Message(resultMsg.content, resultMsg.properties);
              result.fields = resultMsg.fields;
              for (const handler of this._consumer_handlers) {
                if (handler[0] === resultMsg.properties.correlationId) {
                  const func: Function = handler[1];
                  func.apply("", [undefined, result]);
                }
              }
              resolve(result);
            },
            { noAck: true },
            (err: Error, _ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(new Error("amqp-ts: Queue.rpc error: " + err.message));
              } else {
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
              }
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
      this._deleting = new Promise<void>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            this._channel.deleteExchange(this._name, {}, (deleteExchangeError, _ok) => {
              /* istanbul ignore if */
              if (deleteExchangeError) {
                reject(deleteExchangeError);
              } else {
                this._channel.close((channelCloseError) => {
                  delete this.initialized; // invalidate exchange
                  delete this.connection._exchanges[this._name]; // remove the exchange from our administration
                  /* istanbul ignore if */
                  if (channelCloseError) {
                    reject(channelCloseError);
                  } else {
                    delete this._channel;
                    delete this.connection;
                    resolve(null);
                  }
                });
              }
            });
          })
          .catch((err) => {
            reject(err);
          });
      });
    }
    return this._deleting;
  }
  
  /**
   * Removes any bindings of this exchange and closes the channel.
   */
  public close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = new Promise<void>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            delete this.initialized; // invalidate exchange
            delete this.connection._exchanges[this._name]; // remove the exchange from our administration
            this._channel.close((err) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this._channel;
                delete this.connection;
                resolve(null);
              }
            });
          })
          .catch((err) => {
            reject(err);
          });
      });
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
  public activateConsumer(onMessage: (msg: Message) => any, options?: AmqpLib.Options.Consume): Promise<any> {
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
