import { DeclarationOptions } from "./DeclarationOptions";
import { InitializeResult } from "./InitializeResult";
import { log, DIRECT_REPLY_TO_QUEUE, ApplicationName } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { Connection } from "../Connection/Connection";
import * as AmqpLib from "amqplib/callback_api";
import * as os from "os";
import { StartConsumerOptions } from "../Queue/StartConsumerOptions";
import { ActivateConsumerOptions } from "../Queue/ActivateConsumerOptions";
import Bluebird = require("bluebird");

export class Exchange {
  initialized: Bluebird<InitializeResult>;
  _consumer_handlers: Array<[string, any]> = new Array<[string, any]>();
  _isConsumerInitializedRcp: boolean = false;
  _connection: Connection;
  _channel: AmqpLib.Channel;
  _name: string;
  _type: string;
  _options: DeclarationOptions;
  _deleting: Promise<void>;
  _closing: Promise<void>;
  get name() {
    return this._name;
  }
  get type() {
    return this._type;
  }
  constructor(connection: Connection, name: string, type?: string, options: DeclarationOptions = {}) {
    this._connection = connection;
    this._name = name;
    this._type = type;
    this._options = options;
    this._initialize();
  }
  _initialize() {
    this.initialized = new Bluebird<InitializeResult>((resolve, reject) => {
      this._connection.initialized
        .then(() => {
          this._connection._connection.createChannel((err, channel) => {
            /* istanbul ignore if */
            if (err) {
              reject(err);
            } else {
              this._channel = channel;
              let callback = (err, ok) => {
                /* istanbul ignore if */
                if (err) {
                  log.log("error", "Failed to create exchange '" + this._name + "'.", { module: "amqp-ts" });
                  delete this._connection._exchanges[this._name];
                  reject(err);
                } else {
                  resolve(<InitializeResult>ok);
                }
              };
              if (this._options.noCreate) {
                this._channel.checkExchange(this._name, callback);
              } else {
                this._channel.assertExchange(
                  this._name,
                  this._type,
                  <AmqpLib.Options.AssertExchange>this._options,
                  callback,
                );
              }
            }
          });
        })
        .catch((err) => {
          log.log("warn", "Channel failure, error caused during connection!", {
            module: "amqp-ts",
          });
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
        log.log("warn", "Exchange publish error: " + err.message, {
          module: "amqp-ts",
        });
        var exchangeName = this._name;
        var connection = this._connection;
        connection._rebuildAll(err).then(() => {
          log.log("debug", "Retransmitting message.", { module: "amqp-ts" });
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
      var processRpc = () => {
        var uuid: string = generateUuid();
        if (!this._isConsumerInitializedRcp) {
          this._isConsumerInitializedRcp = true;
          this._channel.consume(
            DIRECT_REPLY_TO_QUEUE,
            (resultMsg) => {
              var result = new Message(resultMsg.content, resultMsg.fields);
              result.fields = resultMsg.fields;
              for (let handler of this._consumer_handlers) {
                if (handler[0] === resultMsg.properties.correlationId) {
                  let func: Function = handler[1];
                  func.apply("", [undefined, result]);
                }
              }
            },
            { noAck: true },
            (err, ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(new Error("amqp-ts: Queue.rpc error: " + err.message));
              } else {
                // send the rpc request
                this._consumer_handlers.push([uuid, callback]);
                // consumerTag = ok.consumerTag;
                var message = new Message(requestParameters, {
                  correlationId: uuid,
                  replyTo: DIRECT_REPLY_TO_QUEUE,
                });
                message.sendTo(this, routingKey);
              }
            },
          );
        } else {
          this._consumer_handlers.push([uuid, callback]);
          var message = new Message(requestParameters, {
            correlationId: uuid,
            replyTo: DIRECT_REPLY_TO_QUEUE,
          });
          message.sendTo(this, routingKey);
        }
      };
      // execute sync when possible
      if (this.initialized.isFulfilled()) {
        processRpc();
      } else {
        this.initialized.then(processRpc);
      }
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
            this._channel.deleteExchange(this._name, {}, (err, ok) => {
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
    var binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }
  unbind(source: Exchange, pattern = "", args: any = {}): Promise<void> {
    return this._connection._bindings[Binding.id(this, source, pattern)].delete();
  }
  consumerQueueName(): string {
    return this._name + "." + ApplicationName + "." + os.hostname() + "." + process.pid;
  }
  /**
   * deprecated, use 'exchange.activateConsumer(...)' instead
   */
  startConsumer(onMessage: (msg: any, channel?: AmqpLib.Channel) => any, options?: StartConsumerOptions): Promise<any> {
    var queueName = this.consumerQueueName();
    if (this._connection._queues[queueName]) {
      return new Promise<void>((_, reject) => {
        reject(new Error("amqp-ts Exchange.startConsumer error: consumer already defined"));
      });
    } else {
      var promises: Promise<any>[] = [];
      var queue = this._connection.declareQueue(queueName, { durable: false });
      promises.push(queue.initialized);
      var binding = queue.bind(this);
      promises.push(binding);
      var consumer = queue.startConsumer(onMessage, options);
      promises.push(consumer);
      return Promise.all(promises);
    }
  }
  activateConsumer(onMessage: (msg: Message) => any, options?: ActivateConsumerOptions): Promise<any> {
    var queueName = this.consumerQueueName();
    if (this._connection._queues[queueName]) {
      return new Promise<void>((_, reject) => {
        reject(new Error("amqp-ts Exchange.activateConsumer error: consumer already defined"));
      });
    } else {
      var promises: Promise<any>[] = [];
      var queue = this._connection.declareQueue(queueName, { durable: false });
      promises.push(queue.initialized);
      var binding = queue.bind(this);
      promises.push(binding);
      var consumer = queue.activateConsumer(onMessage, options);
      promises.push(consumer);
      return Promise.all(promises);
    }
  }
  stopConsumer(): Promise<any> {
    var queue = this._connection._queues[this.consumerQueueName()];
    if (queue) {
      return queue.delete();
    } else {
      return Promise.resolve();
    }
  }
}
