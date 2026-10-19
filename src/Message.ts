/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { IllegalOperationError, type Channel, type Message as AmqpMessage } from "amqplib";
import { AmqpProperties } from "./AmqpProperties.js";
import { errorMessage } from "./errorMessage.js";
import { Exchange } from "./Exchange/Exchange.js";
import { SimpleLogger } from "./LoggerFactory.js";
import { Queue } from "./Queue/Queue.js";

/**
 * Represents a message that can be send via AMQP.
 */
export class Message {
  public fields: any;
  /**
   * for received messages only: the channel it has been received on
   * @internal
   */
  public _channel: Channel;
  /**
   * received messages only: original amqplib message
   * @internal
   */
  public _message: AmqpMessage;
  /** Additional AQMP properties of the message. */
  public properties: AmqpProperties;
  /** The original contant of the message. */
  public content: Buffer;

  /**
   * Initializes a new instance of the @see Message class.
   *
   * If the given content is not a buffer or a string it will be converted to a json string and the content type will be
   * set.
   *
   * @param content The message content.
   * @param options The message options.
   */
  constructor(content?: any, options: AmqpProperties = {}) {
    this.properties = options;
    if (content !== undefined) {
      this.setContent(content);
    }
  }

  /**
   * Returns the content of the message. If properties.contentType is set to "application/json" the content will be
   * parsed. If not it will return the string that represents the buffer.
   */
  public getContent(): string | Record<string, unknown> {
    let content = this.content.toString();
    if (this.properties.contentType === "application/json") {
      content = JSON.parse(content);
    }
    return content;
  }

  /**
   * Returns the content of the message parsed from json.
   *
   * @throws {Error} If the content type in the message properties is not set to application/json.
   */
  public getJsonContent<T>(): T {
    if (this.properties.contentType !== "application/json") {
      throw new Error("The content of the message is not set as application/json.");
    }

    return JSON.parse(this.content.toString((this.properties.contentEncoding as BufferEncoding) ?? "utf-8")) as T;
  }

  /**
   * Publishes the message on the destination's channel once the destination is initialized. Appends the current
   * @see properties object and the @see content of the message.
   *
   * If the channel turns out to be closed (the connection or the channel was lost), the message is published again
   * once the destination is initialized again. A message that can never be published (the destination failed,
   * recovery gave up or the connection was closed) is logged at warn level and dropped.
   *
   * @param destination The destination of the message.
   * @param routingKey An optional routing key.
   */
  public sendTo(destination: Exchange | Queue, routingKey = ""): void {
    let exchange: string;
    if (destination instanceof Queue) {
      exchange = "";
      routingKey = destination.name;
    } else {
      exchange = destination.name;
    }

    void this._publish(destination, exchange, routingKey);
  }

  private async _publish(destination: Exchange | Queue, exchange: string, routingKey: string): Promise<void> {
    const connection = destination.connection;
    const log = (): SimpleLogger => connection.loggerFactory(this.constructor);
    for (;;) {
      const ready: Promise<unknown> = destination.initialized;
      try {
        await ready;
      } catch (err) {
        const reason = errorMessage(err);
        log().warn({ err }, "Dropping message to '%s', it cannot be initialized: %s", destination.name, reason);
        return;
      }

      try {
        if (!this.properties.timestamp) {
          // Set timestamp if not set by user
          this.properties.timestamp = Math.floor(new Date().getTime() / 1000);
        }

        destination._channel.publish(exchange, routingKey, this.content, this.properties);
        connection._increaseCounter("sentMessages");
        return;
      } catch (err) {
        if (!(err instanceof IllegalOperationError)) {
          const reason = (err as Error).message;
          log().error({ err }, "Publishing to '%s' failed, dropping the message: %s", destination.name, reason);
          return;
        }
        if (destination.initialized === ready) {
          // the channel was closed on purpose (close() or delete()), nothing re-initializes it
          log().warn({ err }, "Dropping message to '%s', its channel is closed.", destination.name);
          return;
        }
        log().debug({ err }, "Channel of '%s' closed, publishing again once it is re-initialized.", destination.name);
      }
    }
  }

  public ack(allUpTo?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.ack(this._message, allUpTo);
    }
  }

  public nack(allUpTo?: boolean, requeue?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.nack(this._message, allUpTo, requeue);
    }
  }

  public reject(requeue = false): void {
    if (this._channel !== undefined) {
      this._channel.reject(this._message, requeue);
    }
  }

  private setContent(content: any): void {
    if (typeof content === "string") {
      this.content = Buffer.from(content);
    } else if (!(content instanceof Buffer)) {
      this.content = Buffer.from(JSON.stringify(content));
      this.properties.contentType = "application/json";
      this.properties.contentEncoding = "utf-8";
    } else {
      this.content = content;
    }
  }
}
