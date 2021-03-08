/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as AmqpLib from "amqplib/callback_api";
import { DIRECT_REPLY_TO_QUEUE } from "../amqp-ts";
import { Binding } from "../Binding";
import { Connection } from "../Connection/Connection";
import { Exchange } from "../Exchange/Exchange";
import { SimpleLogger } from "../LoggerFactory";
import { Message } from "../Message";
import { DeclarationOptions } from "./DeclarationOptions";
import { DeleteResult } from "./DeleteResult";
import { InitializeResult } from "./InitializeResult";
import { StartConsumerResult } from "./StartConsumerResult";

/** Represents an AQMP queue. */
export class Queue {
  /** A promise that resolves once the conneciton is initialized and the channel is created. */
  public initialized: Promise<InitializeResult>;
  /** The AMQP channel. */
  public _channel: AmqpLib.Channel;
  /** A promise that resolves when a consumer handler is registered and initialized. */
  public _consumerInitialized: Promise<StartConsumerResult>;
  private _name: string;
  _consumer: (msg: any, channel?: AmqpLib.Channel) => any;
  private _consumerOptions: AmqpLib.Options.Consume;
  private _consumerTag: string;
  private _consumerStopping: boolean;
  private _deleting: Promise<DeleteResult>;
  private _closing: Promise<void>;
  private log: SimpleLogger;

  /** Returns the name of the queue. */
  public get name(): string {
    return this._name;
  }

  /**
   * Initializes a new instance of the @see Queue class.
   *
   * @summary Waits until the given connection is initialized, then creates a channel on it and declares a queue with
   * the given name.
   * @param connection The AMQP connection.
   * @param name The name of the queue.
   * @param options Any queue declaring options.
   * @constructor
   */
  constructor(public connection: Connection, name: string, private options: DeclarationOptions = {}) {
    this.log = this.connection.loggerFactory(this.constructor, { queue: name });

    this._name = name;
    this.connection._queues[this._name] = this;
    this._initialize();
  }

  /** Waits until the connection is initialized then creates a channel and declares the queue on it. */
  _initialize(): void {
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
                  this.log.error({ error: err }, "Failed to create queue '%s'.", this._name);
                  delete this.connection._queues[this._name];
                  reject(err);
                } else {
                  if (this.options.prefetch) {
                    this._channel.prefetch(this.options.prefetch);
                  }
                  resolve(ok);
                }
              };
              if (this.options.noCreate) {
                this._channel.checkQueue(this._name, callback);
              } else {
                this._channel.assertQueue(this._name, this.options as AmqpLib.Options.AssertQueue, callback);
              }
            }
          });
        })
        .catch((err) => {
          this.log.warn(err, "Channel failure, error caused during connection!");
        });
    });
  }

  /**
   * Directly sends a message to the underlying queue.
   *
   * @param message The AMQP message.
   */
  public send(message: Message): void {
    message.sendTo(this);
  }

  rpc(requestParameters: any): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const processRpc = (): void => {
        let consumerTag: string;
        this._channel.consume(
          DIRECT_REPLY_TO_QUEUE,
          (resultMsg) => {
            this._channel.cancel(consumerTag);
            const result = new Message(resultMsg.content, resultMsg.properties);
            result.fields = resultMsg.fields;
            resolve(result);
          },
          { noAck: true },
          (err: Error, ok) => {
            /* istanbul ignore if */
            if (err) {
              reject(new Error("amqp-ts: Queue.rpc error: " + err.message));
            } else {
              // send the rpc request
              consumerTag = ok.consumerTag;
              const message = new Message(requestParameters, {
                replyTo: DIRECT_REPLY_TO_QUEUE,
              });
              message.sendTo(this);
            }
          },
        );
      };
      this.initialized.then(processRpc);
    });
  }

  /**
   * Sets the prefetch of the current quere. This limits the amount of unacknowledged messages on a channel. If you
   * already specified this in the options in the constructor you don't need to set it here again.
   *
   * For more information see {@link https://www.rabbitmq.com/consumer-prefetch.html}.
   * @param count The maximum number of unacknowledged messages send to each listener of this queue.
   */
  prefetch(count: number): void {
    this.initialized.then(() => {
      this._channel.prefetch(count);
      this.options.prefetch = count;
    });
  }

  recover(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.initialized.then(() => {
        this._channel.recover((err, _ok) => {
          if (err) {
            reject(err);
          } else {
            resolve(null);
          }
        });
      });
    });
  }

  /**
   * Actives a consumer by binding the given handler to this queue.
   *
   * @param onMessage The message handler that is executed when a new message arrives.
   * @param options Options for underlying amqplib. See
   * @link https://www.squaremobius.net/amqp.node/channel_api.html#channel_consume for more info.
   * @throws {Error} Rejects when a consumer is already bound to this queue.
   * @returns A promise that resolves once the handler is bound to the queue.
   */
  public activateConsumer(
    onMessage: (msg: Message) => any,
    options: AmqpLib.Options.Consume = {},
  ): Promise<StartConsumerResult> {
    if (this._consumerInitialized !== undefined) {
      return Promise.reject(new Error("amqp-ts Queue.activateConsumer error: consumer already defined"));
    }

    this._consumerOptions = options;
    this._consumer = onMessage;
    this._initializeConsumer();

    return this._consumerInitialized;
  }

  /**
   * Initializes the consumer with a handler function. Resolves the @see _consumerInitialized promise once the handler
   * is bound.
   */
  _initializeConsumer(): void {
    const activateConsumerWrapper = (msg: AmqpLib.Message): void => {
      try {
        const message = new Message(msg.content, msg.properties);
        message.fields = msg.fields;
        message._message = msg;
        message._channel = this._channel;
        const result = this._consumer(message);
        // convert the result to a promise if it isn't one already
        Promise.resolve(result)
          .then((resultValue) => {
            // check if there is a reply-to
            if (msg.properties.replyTo) {
              if (!(resultValue instanceof Message)) {
                resultValue = new Message(resultValue ?? "", {});
              }
              resultValue.properties.correlationId = msg.properties.correlationId;
              resultValue.properties.appId = msg.properties.appId;

              this._channel.sendToQueue(msg.properties.replyTo, resultValue.content, resultValue.properties);
            }
          })
          .catch((err) => {
            this.log.error(
              { err, correlationId: msg.properties.correlationId, consumerTag: msg.fields.consumerTag },
              "Replying on message %s throw an error: %s",
              msg.properties.correlationId,
              err.message,
            );
          });
      } catch (err) {
        /* istanbul ignore next */
        this.log.error(
          { err, correlationId: msg.properties.correlationId, consumerTag: msg.fields.consumerTag },
          "Consuming the message %s returned error: %s",
          msg.properties.correlationId,
          err.message,
        );
      }
    };

    this._consumerInitialized = new Promise<StartConsumerResult>((resolve, reject) => {
      this.initialized.then(() => {
        this._channel.consume(this._name, activateConsumerWrapper, this._consumerOptions, (err, ok) => {
          /* istanbul ignore if */
          if (err) {
            reject(err);
          } else {
            this._consumerTag = ok.consumerTag;
            resolve(ok);
          }
        });
      });
    });
  }

  /**
   * Completely removes the consumer handler and cancels the channel.
   */
  public stopConsumer(): Promise<void> {
    if (this._consumerStopping || this._consumerInitialized == undefined) {
      return Promise.resolve();
    }
    this._consumerStopping = true;
    return new Promise<void>((resolve, reject) => {
      this._consumerInitialized.then(() => {
        this._channel.cancel(this._consumerTag, (err, _ok) => {
          /* istanbul ignore if */
          if (err) {
            reject(err);
          } else {
            delete this._consumerInitialized;
            delete this._consumer;
            delete this._consumerOptions;
            delete this._consumerStopping;
            resolve();
          }
        });
      });
    });
  }

  /**
   * Removes any bindings of this queue, the consumer handler and then deletes the queue.
   */
  delete(): Promise<DeleteResult> {
    if (this._deleting === undefined) {
      this._deleting = new Promise<DeleteResult>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            return this.stopConsumer();
          })
          .then(() => {
            return this._channel.deleteQueue(this._name, {}, (deleteQueueError: Error, ok: DeleteResult) => {
              /* istanbul ignore if */
              if (deleteQueueError) {
                reject(deleteQueueError);
              } else {
                delete this.initialized; // invalidate queue
                delete this.connection._queues[this._name]; // remove the queue from our administration
                this._channel.close((channelCloseError) => {
                  /* istanbul ignore if */
                  if (channelCloseError) {
                    reject(channelCloseError);
                  } else {
                    delete this._channel;
                    delete this.connection;
                    resolve(ok);
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
   * Remoevs bindings of this queue as well as the consumer handler and then closes the AMQP channel.
   */
  close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = new Promise<void>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            return this.stopConsumer();
          })
          .then(() => {
            delete this.initialized; // invalidate queue
            delete this.connection._queues[this._name]; // remove the queue from our administration
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
   * Binds the queue to the given exchange.
   *
   * @param source The exchange on which to bind the queue.
   * @param pattern The pattern to use.
   * @param args Any arguments.
   */
  public bind(source: Exchange, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }

  /**
   * Unbinds the queue from the given exchange by deleting the binding.
   *
   * @param source The exchange to unbind from.
   * @param pattern The pattern the queue was bind with.
   * @param _args Any additional arguments.
   */
  public unbind(source: Exchange, pattern = "", _args: any = {}): Promise<void> {
    return this.connection._bindings[Binding.id(this, source, pattern)].delete();
  }
}
