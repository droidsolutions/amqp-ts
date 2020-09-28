/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Exchange } from "../Exchange/Exchange";
import { Connection } from "../Connection/Connection";
import { DIRECT_REPLY_TO_QUEUE } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { InitializeResult } from "./InitializeResult";
import * as AmqpLib from "amqplib/callback_api";
import { DeclarationOptions } from "./DeclarationOptions";
import { StartConsumerOptions } from "./StartConsumerOptions";
import { StartConsumerResult } from "./StartConsumerResult";
import { DeleteResult } from "./DeleteResult";
import { SimpleLogger } from "../LoggerFactory";

export class Queue {
  public initialized: Promise<InitializeResult>;
  public _channel: AmqpLib.Channel;
  public _consumerInitialized: Promise<StartConsumerResult>;
  private _name: string;
  _consumer: (msg: any, channel?: AmqpLib.Channel) => any;
  private _isStartConsumer: boolean;
  private _rawConsumer: boolean;
  private _consumerOptions: StartConsumerOptions;
  private _consumerTag: string;
  private _consumerStopping: boolean;
  private _deleting: Promise<DeleteResult>;
  private _closing: Promise<void>;
  private log: SimpleLogger;

  public get name(): string {
    return this._name;
  }

  constructor(public connection: Connection, name: string, private options: DeclarationOptions = {}) {
    this.log = this.connection.loggerFactory(this.constructor, { queue: name });

    this._name = name;
    this.connection._queues[this._name] = this;
    this._initialize();
  }
  _initialize(): void {
    this.initialized = new Promise<InitializeResult>((resolve, reject) => {
      this.connection.initialized
        .then(() => {
          this.connection.connection.createChannel((err, channel) => {
            /* istanbul ignore if */
            if (err) {
              reject(err);
            } else {
              this._channel = channel;
              const callback = (err: Error, ok: InitializeResult): void => {
                /* istanbul ignore if */
                if (err) {
                  this.log.error({ err }, "Failed to create queue '%s'.", this._name);
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
  static _packMessageContent(content: any, options: any): Buffer {
    if (typeof content === "string") {
      content = Buffer.from(content);
    } else if (!(content instanceof Buffer)) {
      content = Buffer.from(JSON.stringify(content));
      options.contentType = "application/json";
    }
    return content;
  }
  static _unpackMessageContent(msg: AmqpLib.Message): any {
    let content = msg.content.toString();
    if (msg.properties.contentType === "application/json") {
      content = JSON.parse(content);
    }
    return content;
  }

  send(message: Message): void {
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

  public activateConsumer(
    onMessage: (msg: Message) => any,
    options: StartConsumerOptions = {},
  ): Promise<StartConsumerResult> {
    if (this._consumerInitialized !== undefined) {
      return Promise.reject(new Error("amqp-ts Queue.activateConsumer error: consumer already defined"));
    }

    this._consumerOptions = options;
    this._consumer = onMessage;
    this._initializeConsumer();

    return this._consumerInitialized;
  }

  _initializeConsumer(): void {
    const processedMsgConsumer = (msg: AmqpLib.Message): void => {
      try {
        /* istanbul ignore if */
        if (!msg) {
          return; // ignore empty messages (for now)
        }
        const payload = Queue._unpackMessageContent(msg);
        const result = this._consumer(payload);
        // convert the result to a promise if it isn't one already
        Promise.resolve(result)
          .then((resultValue) => {
            // check if there is a reply-to
            if (msg.properties.replyTo) {
              const options: any = {};
              resultValue = Queue._packMessageContent(resultValue, options);
              this._channel.sendToQueue(msg.properties.replyTo, resultValue, options);
            }
            // 'hack' added to allow better manual ack control by client (less elegant, but should work)
            if (this._consumerOptions.manualAck !== true && this._consumerOptions.noAck !== true) {
              this._channel.ack(msg);
            }
          })
          .catch((err) => {
            this.log.error({ err }, "Queue.onMessage RPC promise returned error: %s", err.message);
          });
      } catch (err) {
        /* istanbul ignore next */
        this.log.error({ err }, "Queue.onMessage consumer function returned error: %s", err.message);
      }
    };

    const rawMsgConsumer = (msg: AmqpLib.Message): void => {
      try {
        this._consumer(msg, this._channel);
      } catch (err) {
        /* istanbul ignore next */
        this.log.error({ err }, "Queue.onMessage consumer function returned error: %s", err.message);
      }
    };

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
                resultValue = new Message(resultValue, {});
              }
              resultValue.properties.correlationId = msg.properties.correlationId;
              this._channel.sendToQueue(msg.properties.replyTo, resultValue.content, resultValue.properties);
            }
          })
          .catch((err) => {
            this.log.error({ err }, "Queue.onMessage RPC promise returned error: %s", err.message);
          });
      } catch (err) {
        /* istanbul ignore next */
        this.log.error({ err }, "Queue.onMessage consumer function returned error: %s", err.message);
      }
    };

    this._consumerInitialized = new Promise<StartConsumerResult>((resolve, reject) => {
      this.initialized.then(() => {
        let consumerFunction = activateConsumerWrapper;
        if (this._isStartConsumer) {
          consumerFunction = this._rawConsumer ? rawMsgConsumer : processedMsgConsumer;
        }
        this._channel.consume(
          this._name,
          consumerFunction,
          this._consumerOptions as AmqpLib.Options.Consume,
          (err, ok) => {
            /* istanbul ignore if */
            if (err) {
              reject(err);
            } else {
              this._consumerTag = ok.consumerTag;
              resolve(ok);
            }
          },
        );
      });
    });
  }
  stopConsumer(): Promise<void> {
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
            resolve(null);
          }
        });
      });
    });
  }
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
            return this._channel.deleteQueue(this._name, {}, (err: Error, ok: DeleteResult) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this.initialized; // invalidate queue
                delete this.connection._queues[this._name]; // remove the queue from our administration
                this._channel.close((err) => {
                  /* istanbul ignore if */
                  if (err) {
                    reject(err);
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
  bind(source: Exchange, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }
  unbind(source: Exchange, pattern = "", _args: any = {}): Promise<void> {
    return this.connection._bindings[Binding.id(this, source, pattern)].delete();
  }
}
