import { Exchange } from "../Exchange/Exchange";
import { Connection } from "../Connection/Connection";
import { log, DIRECT_REPLY_TO_QUEUE } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { InitializeResult } from "./InitializeResult";
import * as AmqpLib from "amqplib";
import { DeclarationOptions } from "./DeclarationOptions";
import { StartConsumerOptions } from "./StartConsumerOptions";
import { StartConsumerResult } from "./StartConsumerResult";
import { DeleteResult } from "./DeleteResult";
import { ActivateConsumerOptions } from "./ActivateConsumerOptions";

export class Queue {
  initialized: Promise<InitializeResult>;
  _connection: Connection;
  _channel: AmqpLib.Channel;
  _name: string;
  _options: DeclarationOptions;
  _consumer: (msg: any, channel?: AmqpLib.Channel) => any;
  _isStartConsumer: boolean;
  _rawConsumer: boolean;
  _consumerOptions: StartConsumerOptions;
  _consumerTag: string;
  _consumerInitialized: Promise<StartConsumerResult>;
  _consumerStopping: boolean;
  _deleting: Promise<DeleteResult>;
  _closing: Promise<void>;
  get name(): string {
    return this._name;
  }

  constructor(connection: Connection, name: string, options: DeclarationOptions = {}) {
    this._connection = connection;
    this._name = name;
    this._options = options;
    this._connection._queues[this._name] = this;
    this._initialize();
  }

  public _initialize(): void {
    this.initialized = new Promise<InitializeResult>((resolve, reject) => {
      this._connection.initialized
        .then(() => {
          this._connection._connection.createChannel().then((channel) => {
            this._channel = channel;
            const errorHandler = (err: Error): void => {
              log.log("error", "Failed to create queue '" + this._name + "'.", { module: "amqp-ts" });
              delete this._connection._queues[this._name];
              reject(err);
            };
            const callback = (ok: InitializeResult): void => {
              if (this._options.prefetch) {
                this._channel.prefetch(this._options.prefetch);
              }
              resolve(ok);
            };
            if (this._options.noCreate) {
              this._channel.checkQueue(this._name).then(callback).catch(errorHandler);
            } else {
              this._channel
                .assertQueue(this._name, this._options as AmqpLib.Options.AssertQueue)
                .then(callback)
                .catch(errorHandler);
            }
          });
        })
        .catch((_err) => {
          log.log("warn", "Channel failure, error caused during connection!", {
            module: "amqp-ts",
          });
          reject(_err);
        });
    });
  }

  public async init(): Promise<InitializeResult> {
    await this._connection.initialized;
    try {
      this._channel = await this._connection._connection.createChannel();
      let result: InitializeResult;
      if (this._options.noCreate) {
        result = await this._channel.checkQueue(this._name);
      } else {
        result = await this._channel.assertQueue(this._name, this._options);
      }
      if (this._options.prefetch) {
        this._channel.prefetch(this._options.prefetch);
      }

      return result;
    } catch (error) {
      delete this._connection._queues[this._name];
      log.log("warn", "Channel failure, error caused during connection!", {
        module: "amqp-ts",
      });
    }
  }

  static _packMessageContent(content: any, options: any): Buffer {
    if (typeof content === "string") {
      content = new Buffer(content);
    } else if (!(content instanceof Buffer)) {
      content = new Buffer(JSON.stringify(content));
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
  /**
   * deprecated, use 'queue.send(message: Message)' instead
   */
  publish(content: any, options: any = {}): void {
    // inline function to send the message
    const sendMessage = (): void => {
      try {
        this._channel.sendToQueue(this._name, content, options);
      } catch (err) {
        log.log("debug", "Queue publish error: " + err.message, {
          module: "amqp-ts",
        });
        const queueName = this._name;
        const connection = this._connection;
        log.log("debug", "Try to rebuild connection, before Call.", {
          module: "amqp-ts",
        });
        connection._rebuildAll(err).then(() => {
          log.log("debug", "Retransmitting message.", { module: "amqp-ts" });
          connection._queues[queueName].publish(content, options);
        });
      }
    };
    content = Queue._packMessageContent(content, options);
    // execute sync when possible
    this.initialized.then(sendMessage);
  }
  send(message: Message): void {
    message.sendTo(this);
  }
  public async rpc(requestParameters: any): Promise<Message> {
    await this.initialized;

    let handlerResolve: (msg: Message) => void;
    const promise = new Promise<Message>((resolve) => {
      handlerResolve = resolve;
    });

    let consumerTag: string;
    try {
      const result = await this._channel.consume(
        DIRECT_REPLY_TO_QUEUE,
        (resultMsg) => {
          this._channel.cancel(consumerTag);
          const result = new Message(resultMsg.content, resultMsg.fields);
          result.fields = resultMsg.fields;
          handlerResolve(result);
        },
        { noAck: true },
      );
      // send the rpc request
      consumerTag = result.consumerTag;
      const message = new Message(requestParameters, {
        replyTo: DIRECT_REPLY_TO_QUEUE,
      });
      message.sendTo(this);
      return promise;
    } catch (err) {
      throw new Error("amqp-ts: Queue.rpc error: " + err.message);
    }
  }
  prefetch(count: number): void {
    this.initialized.then(() => {
      this._channel.prefetch(count);
      this._options.prefetch = count;
    });
  }

  public async recover(): Promise<void> {
    await this.initialized;
    await this._channel.recover();
  }
  /**
   * deprecated, use 'queue.activateConsumer(...)' instead
   */
  startConsumer(
    onMessage: (msg: any, channel?: AmqpLib.Channel) => any,
    options: StartConsumerOptions = {},
  ): Promise<StartConsumerResult> {
    if (this._consumerInitialized) {
      return new Promise<StartConsumerResult>((_, reject) => {
        reject(new Error("amqp-ts Queue.startConsumer error: consumer already defined"));
      });
    }
    this._isStartConsumer = true;
    this._rawConsumer = options.rawMessage === true;
    delete options.rawMessage; // remove to avoid possible problems with amqplib
    this._consumerOptions = options;
    this._consumer = onMessage;
    this._initializeConsumer();
    return this._consumerInitialized;
  }
  activateConsumer(
    onMessage: (msg: Message) => any,
    options: ActivateConsumerOptions = {},
  ): Promise<StartConsumerResult> {
    if (this._consumerInitialized) {
      return new Promise<StartConsumerResult>((_, reject) => {
        reject(new Error("amqp-ts Queue.activateConsumer error: consumer already defined"));
      });
    }
    this._consumerOptions = options;
    this._consumer = onMessage;
    this._initializeConsumer();
    return this._consumerInitialized;
  }
  public _initializeConsumer(): void {
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
            log.log("error", "Queue.onMessage RPC promise returned error: " + err.message, { module: "amqp-ts" });
          });
      } catch (err) {
        /* istanbul ignore next */
        log.log("error", "Queue.onMessage consumer function returned error: " + err.message, { module: "amqp-ts" });
      }
    };
    const rawMsgConsumer = (msg: AmqpLib.Message): void => {
      try {
        this._consumer(msg, this._channel);
      } catch (err) {
        /* istanbul ignore next */
        log.log("error", "Queue.onMessage consumer function returned error: " + err.message, { module: "amqp-ts" });
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
            log.log("error", "Queue.onMessage RPC promise returned error: " + err.message, { module: "amqp-ts" });
          });
      } catch (err) {
        /* istanbul ignore next */
        log.log("error", "Queue.onMessage consumer function returned error: " + err.message, { module: "amqp-ts" });
      }
    };
    this._consumerInitialized = new Promise<StartConsumerResult>((resolve, reject) => {
      this.initialized.then(() => {
        let consumerFunction = activateConsumerWrapper;
        if (this._isStartConsumer) {
          consumerFunction = this._rawConsumer ? rawMsgConsumer : processedMsgConsumer;
        }
        this._channel
          .consume(this._name, consumerFunction, this._consumerOptions as AmqpLib.Options.Consume)
          .then((value: AmqpLib.Replies.Consume) => {
            this._consumerTag = value.consumerTag;
            resolve(value);
          })
          .catch(reject);
      });
    });
  }

  public async stopConsumer(): Promise<void> {
    if (this._consumerStopping || !(await this._consumerInitialized)) {
      return Promise.resolve();
    }
    this._consumerStopping = true;

    await this._consumerInitialized;
    await this._channel.cancel(this._consumerTag);
    delete this._consumerInitialized;
    delete this._consumer;
    delete this._consumerOptions;
    delete this._consumerStopping;
  }

  public async delete(): Promise<DeleteResult> {
    if (this._deleting === undefined) {
      let closeResolve: (res: DeleteResult) => void;
      let closeReject: (err: Error) => void;

      this._deleting = new Promise<DeleteResult>((resolve, reject) => {
        closeResolve = resolve;
        closeReject = reject;
      });

      try {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        await this.stopConsumer();

        const deleteResult = await this._channel.deleteQueue(this._name, {});
        delete this.initialized; // invalidate queue
        delete this._connection._queues[this._name]; // remove the queue from our administration
        await this._channel.close();

        delete this._channel;
        delete this._connection;
        closeResolve(deleteResult);
      } catch (err) {
        closeReject(err);
      }
    }
    return this._deleting;
  }
  public async close(): Promise<void> {
    if (this._closing === undefined) {
      let closeResolve: () => void;
      let closeReject: (err: Error) => void;

      this._closing = new Promise<void>((resolve, reject) => {
        closeResolve = resolve;
        closeReject = reject;
      });

      try {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        await this.stopConsumer();

        delete this.initialized; // invalidate queue
        delete this._connection._queues[this._name]; // remove the queue from our administration
        await this._channel.close();
        delete this._channel;
        delete this._connection;
        closeResolve();
      } catch (err) {
        closeReject(err);
      }
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
}
