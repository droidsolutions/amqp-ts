import { DeclarationOptions } from "./DeclarationOptions";
import { InitializeResult } from "./InitializeResult";
import { DIRECT_REPLY_TO_QUEUE, ApplicationName } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { Connection } from "../Connection/Connection";
import * as AmqpLib from "amqplib/callback_api";
import * as os from "os";
import { StartConsumerOptions } from "../Queue/StartConsumerOptions";
import { ActivateConsumerOptions } from "../Queue/ActivateConsumerOptions";
import { SimpleLogger } from "../LoggerFactory";

export class Exchange {
  initialized: Promise<InitializeResult>;
  _consumer_handlers: Array<[string, any]> = new Array<[string, any]>();
  _isConsumerInitializedRcp = false;
  _connection: Connection;
  _channel: AmqpLib.Channel;
  _name: string;
  _type: string;
  _options: DeclarationOptions;
  _deleting: Promise<void>;
  _closing: Promise<void>;

  private log: SimpleLogger;

  get name(): string {
    return this._name;
  }
  get type(): string {
    return this._type;
  }

  constructor(connection: Connection, name: string, type: string, options: DeclarationOptions = {}) {
    this.log = connection.loggerFactory(this.constructor, { exchange: name });

    this._connection = connection;
    this._name = name;
    this._type = type;
    this._options = options;
    this._initialize();
  }
  _initialize(): void {
    this.initialized = new Promise<InitializeResult>((resolve, reject) => {
      this._connection.initialized
        .then(() => {
          this._connection._connection.createChannel((err, channel) => {
            /* istanbul ignore if */
            if (err) {
              reject(err);
            } else {
              this._channel = channel;
              const callback = (err: Error, ok: InitializeResult): void => {
                /* istanbul ignore if */
                if (err) {
                  this.log.error({ err }, "Failed to create exchange '%s'.", this._name);
                  delete this._connection._exchanges[this._name];
                  reject(err);
                } else {
                  resolve(ok);
                }
              };
              if (this._options.noCreate) {
                this._channel.checkExchange(this._name, callback);
              } else {
                this._channel.assertExchange(
                  this._name,
                  this._type,
                  this._options as AmqpLib.Options.AssertExchange,
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
    this._connection._exchanges[this._name] = this;
  }
  /**
   * deprecated, use 'exchange.send(message: Message, routingKey?: string)' instead
   */
  publish(content: any, routingKey = "", options: any = {}): void {
    if (typeof content === "string") {
      content = new Buffer(content);
    } else if (!(content instanceof Buffer)) {
      content = new Buffer(JSON.stringify(content));
      options.contentType = options.contentType || "application/json";
    }
    this.initialized.then(() => {
      try {
        this._channel.publish(this._name, routingKey, content, options);
      } catch (err) {
        this.log.warn({ err }, "Exchange publish error: %s", err.message);
        const exchangeName = this._name;
        const connection = this._connection;
        connection._rebuildAll(err).then(() => {
          this.log.debug("Retransmitting message with routing key '%s'.", routingKey);
          connection._exchanges[exchangeName].publish(content, routingKey, options);
        });
      }
    });
  }
  send(message: Message, routingKey = ""): void {
    message.sendTo(this, routingKey);
  }
  rpc(requestParameters: any, routingKey = "", callback?: (err, message: Message) => void): Promise<Message> {
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
              const result = new Message(resultMsg.content, resultMsg.fields);
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
            (err, _ok) => {
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
  delete(): Promise<void> {
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
                  delete this._connection._exchanges[this._name]; // remove the exchange from our administration
                  /* istanbul ignore if */
                  if (err) {
                    reject(err);
                  } else {
                    delete this._channel;
                    delete this._connection;
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
  close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = new Promise<void>((resolve, reject) => {
        this.initialized
          .then(() => {
            return Binding.removeBindingsContaining(this);
          })
          .then(() => {
            delete this.initialized; // invalidate exchange
            delete this._connection._exchanges[this._name]; // remove the exchange from our administration
            this._channel.close((err) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this._channel;
                delete this._connection;
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
    return this._connection._bindings[Binding.id(this, source, pattern)].delete();
  }
  consumerQueueName(): string {
    return this._name + "." + ApplicationName + "." + os.hostname() + "." + process.pid;
  }
  /**
   * deprecated, use 'exchange.activateConsumer(...)' instead
   */
  startConsumer(onMessage: (msg: any, channel?: AmqpLib.Channel) => any, options?: StartConsumerOptions): Promise<any> {
    const queueName = this.consumerQueueName();
    if (this._connection._queues[queueName]) {
      return new Promise<void>((_, reject) => {
        reject(new Error("amqp-ts Exchange.startConsumer error: consumer already defined"));
      });
    } else {
      const promises: Promise<any>[] = [];
      const queue = this._connection.declareQueue(queueName, { durable: false });
      promises.push(queue.initialized);
      const binding = queue.bind(this);
      promises.push(binding);
      const consumer = queue.startConsumer(onMessage, options);
      promises.push(consumer);
      return Promise.all(promises);
    }
  }
  activateConsumer(onMessage: (msg: Message) => any, options?: ActivateConsumerOptions): Promise<any> {
    const queueName = this.consumerQueueName();
    if (this._connection._queues[queueName]) {
      return new Promise<void>((_, reject) => {
        reject(new Error("amqp-ts Exchange.activateConsumer error: consumer already defined"));
      });
    } else {
      const promises: Promise<any>[] = [];
      const queue = this._connection.declareQueue(queueName, { durable: false });
      promises.push(queue.initialized);
      const binding = queue.bind(this);
      promises.push(binding);
      const consumer = queue.activateConsumer(onMessage, options);
      promises.push(consumer);
      return Promise.all(promises);
    }
  }
  stopConsumer(): Promise<any> {
    const queue = this._connection._queues[this.consumerQueueName()];
    if (queue) {
      return queue.delete();
    } else {
      return Promise.resolve();
    }
  }
}
