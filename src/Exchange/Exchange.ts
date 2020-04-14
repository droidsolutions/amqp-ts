import { DeclarationOptions } from "./DeclarationOptions";
import { InitializeResult } from "./InitializeResult";
import { log, DIRECT_REPLY_TO_QUEUE, ApplicationName } from "../amqp-ts";
import { Binding } from "../Binding";
import { Message } from "../Message";
import { Connection } from "../Connection/Connection";
import * as AmqpLib from "amqplib";
import * as os from "os";
import { StartConsumerOptions } from "../Queue/StartConsumerOptions";
import { ActivateConsumerOptions } from "../Queue/ActivateConsumerOptions";

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
  get name(): string {
    return this._name;
  }
  get type(): string {
    return this._type;
  }
  constructor(connection: Connection, name: string, type?: string, options: DeclarationOptions = {}) {
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
          this._connection._connection.createChannel().then((channel) => {
            this._channel = channel;
            if (this._options.noCreate) {
              this._channel
                .checkExchange(this._name)
                .then(resolve)
                .catch((err: Error) => {
                  log.log("error", "Failed to create exchange '" + this._name + "'.", { module: "amqp-ts" });
                  delete this._connection._exchanges[this._name];
                  reject(err);
                });
            } else {
              this._channel
                .assertExchange(this._name, this._type, this._options as AmqpLib.Options.AssertExchange)
                .then(resolve)
                .catch((err: Error) => {
                  log.log("error", "Failed to create exchange '" + this._name + "'.", { module: "amqp-ts" });
                  delete this._connection._exchanges[this._name];
                  reject(err);
                });
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
    this._connection._exchanges[this._name] = this;
  }

  public async init(): Promise<InitializeResult | undefined> {
    await this._connection.initialized;

    try {
      let result: InitializeResult | undefined = undefined;
      this._channel = await this._connection._connection.createChannel();
      if (this._options.noCreate) {
        await this._channel.checkExchange(this._name);
      } else {
        result = await this._channel.assertExchange(this._name, this._type, this._options);
      }

      this._connection._exchanges[this._name] = this;
      return result;
    } catch (err) {
      log.log("error", "Failed to create exchange '" + this._name + "'.", { module: "amqp-ts" });
      delete this._connection._exchanges[this._name];

      throw err;
    }
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
        const exchangeName = this._name;
        const connection = this._connection;
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
  public async rpc(
    requestParameters: any,
    routingKey = "",
    handler?: (err: Error, message: Message) => void,
  ): Promise<Message> {
    function generateUuid(): string {
      return Math.random().toString() + Math.random().toString() + Math.random().toString();
    }

    await this.initialized;

    const uuid: string = generateUuid();

    try {
      if (!this._isConsumerInitializedRcp) {
        this._isConsumerInitializedRcp = true;

        let closeResolve: (msg: Message) => void;

        const promise = new Promise<Message>((resolve) => {
          closeResolve = resolve;
        });

        await this._channel.consume(
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
            closeResolve(result);
          },
          { noAck: true },
        );

        if (handler) {
          // send the rpc request
          this._consumer_handlers.push([uuid, handler]);
        }
        // consumerTag = ok.consumerTag;
        const message = new Message(requestParameters, {
          correlationId: uuid,
          replyTo: DIRECT_REPLY_TO_QUEUE,
        });
        message.sendTo(this, routingKey);

        return promise;
      } else {
        this._consumer_handlers.push([uuid, handler]);
        const message = new Message(requestParameters, {
          correlationId: uuid,
          replyTo: DIRECT_REPLY_TO_QUEUE,
        });
        message.sendTo(this, routingKey);
        return message;
      }
    } catch (err) {
      throw new Error("amqp-ts: Queue.rpc error: " + err.message);
    }
  }
  public async delete(): Promise<void> {
    if (this._deleting === undefined) {
      let closeResolve: () => void;
      let closeReject: (err: Error) => void;

      this._deleting = new Promise<void>((resolve, reject) => {
        closeResolve = resolve;
        closeReject = reject;
      });

      try {
        await this.initialized;
        await Binding.removeBindingsContaining(this);

        await this._channel.deleteExchange(this._name, {});

        await this._channel.close();
        delete this.initialized; // invalidate exchange
        delete this._connection._exchanges[this._name]; // remove the exchange from our administration

        delete this._channel;
        delete this._connection;

        closeResolve();
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
        delete this.initialized; // invalidate exchange
        delete this._connection._exchanges[this._name]; // remove the exchange from our administration

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
