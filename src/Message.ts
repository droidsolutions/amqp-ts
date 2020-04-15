import { Queue } from "./Queue/Queue";
import * as AmqpLib from "amqplib/callback_api";
import { Exchange } from "./Exchange/Exchange";
import { SimpleLogger } from "./LoggerFactory";

export class Message {
  public fields: any;
  public _channel: AmqpLib.Channel;
  /** for received messages only: the channel it has been received on */
  /** received messages only: original amqplib message */
  public _message: AmqpLib.Message;
  public properties: any;
  public content: Buffer;

  constructor(content?: any, options: any = {}) {
    this.properties = options;
    if (content !== undefined) {
      this.setContent(content);
    }
  }
  
  public getContent(): any {
    let content = this.content.toString();
    if (this.properties.contentType === "application/json") {
      content = JSON.parse(content);
    }
    return content;
  }
  
  public sendTo(destination: Exchange | Queue, routingKey = ""): void {
    let exchange: string;
    // inline function to send the message
    const sendMessage = (): void => {
      try {
        destination._channel.publish(exchange, routingKey, this.content, this.properties);
      } catch (err) {
        const log: SimpleLogger = destination.connection.loggerFactory(this.constructor);
        log.debug({ err }, "Publish error: %s", err.message);
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
      this.content = new Buffer(content);
    } else if (!(content instanceof Buffer)) {
      this.content = new Buffer(JSON.stringify(content));
      this.properties.contentType = "application/json";
    } else {
      this.content = content;
    }
  }
}
