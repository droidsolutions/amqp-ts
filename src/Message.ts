/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import * as AmqpLib from "amqplib/callback_api";
import { AmqpProperties } from "./AmqpProperties";
import { Exchange } from "./Exchange/Exchange";
import { SimpleLogger } from "./LoggerFactory";
import { Queue } from "./Queue/Queue";

/**
 * Represents a message that can be send via AMQP.
 */
export class Message {
  public fields: any;
  /** for received messages only: the channel it has been received on */
  public _channel: AmqpLib.Channel;
  /** received messages only: original amqplib message */
  public _message: AmqpLib.Message;
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
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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
   * Tries to publish the message on the destination channel. Appends the current @see properties object and the
   * @see content of the message.
   *
   * @param destination The destination of the message.
   * @param routingKey An optional routing key.
   */
  public sendTo(destination: Exchange | Queue, routingKey = ""): void {
    let exchange: string;
    // inline function to send the message
    const sendMessage = (): void => {
      try {
        if (!this.properties.timestamp) {
          // Set timestamp if not set by user
          this.properties.timestamp = Math.floor(new Date().getTime() / 1000);
        }

        destination._channel.publish(exchange, routingKey, this.content, this.properties);
        destination.connection._increaseCounter("sentMessages");
      } catch (err) {
        const log: SimpleLogger = destination.connection.loggerFactory(this.constructor);
        log.debug({ err }, "Publish error: %s", (err as Error).message);
        const destinationName = destination.name;
        const connection = destination.connection;
        log.debug("Try to rebuild connection, before Call.");
        connection._rebuildAll(err).then(() => {
          log.debug("Retransmitting message.");
          if (destination instanceof Queue) {
            // connection._queues[destinationName].publish(this.content, this.properties);
            connection._queues[destinationName].send(this);
          } else {
            // connection._exchanges[destinationName].publish(this.content, routingKey, this.properties);
            connection._exchanges[destinationName].send(this);
          }
        });
      }
    };
    if (destination instanceof Queue) {
      exchange = "";
      routingKey = destination.name;
    } else {
      exchange = destination.name;
    }

    (destination.initialized as Promise<any>).then(sendMessage);
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
