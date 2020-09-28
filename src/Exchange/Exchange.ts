/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { DeclarationOptions } from "./DeclarationOptions";
import { InitializeResult } from "./InitializeResult";
import { DIRECT_REPLY_TO_QUEUE, ApplicationName } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { Connection } from "../Connection/Connection";
import * as AmqpLib from "amqplib/callback_api";
import * as os from "os";
import { StartConsumerOptions } from "../Queue/StartConsumerOptions";
import { SimpleLogger } from "../LoggerFactory";

export class Exchange {
  public initialized: Promise<InitializeResult>;
  public _channel: AmqpLib.Channel;
  public get name(): string {
    return this._name;
  }
  public get type(): string {
    return this._type;
  }

  private _consumer_handlers: Array<[string, any]> = new Array<[string, any]>();
  private _isConsumerInitializedRcp = false;
  private _name: string;
  private _type: string;
  private _deleting: Promise<void>;
  private _closing: Promise<void>;
  private log: SimpleLogger;

  constructor(public connection: Connection, name: string, type?: string, private options: DeclarationOptions = {}) {
    this.log = this.connection.loggerFactory(this.constructor, { exchange: name });

    this._name = name;
    this._type = type;
    this._initialize();
  }

  public _initialize(): void {
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

  public delete(): Promise<void> {
    if (this._deleting === undefined) {
      this._deleting = new Promise<void>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            this._channel.deleteExchange(this._name, {}, (err, _ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                this._channel.close((err) => {
                  delete this.initialized; // invalidate exchange
                  delete this.connection._exchanges[this._name]; // remove the exchange from our administration
                  /* istanbul ignore if */
                  if (err) {
                    reject(err);
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
  public bind(source: Exchange, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }

  public unbind(source: Exchange, pattern = "", _args: any = {}): Promise<void> {
    return this.connection._bindings[Binding.id(this, source, pattern)].delete();
  }

  public consumerQueueName(): string {
    return `${this._name}.${ApplicationName}.${os.hostname()}.${process.pid}`;
  }

  public activateConsumer(onMessage: (msg: Message) => any, options?: StartConsumerOptions): Promise<any> {
    const queueName = this.consumerQueueName();
    if (this.connection._queues[queueName]) {
      return new Promise<void>((_, reject) => {
        reject(new Error("amqp-ts Exchange.activateConsumer error: consumer already defined"));
      });
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

  public stopConsumer(): Promise<any> {
    const queue = this.connection._queues[this.consumerQueueName()];
    if (queue) {
      return queue.delete();
    } else {
      return Promise.resolve();
    }
  }
}
