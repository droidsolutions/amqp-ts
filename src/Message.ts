import { Queue } from "./Queue/Queue";
import { log } from "./amqp-ts";
import * as AmqpLib from "amqplib/callback_api";
import { Exchange } from "./Exchange/Exchange";

export class Message {
  content: Buffer;
  fields: any;
  properties: any;
  /** for received messages only: the channel it has been received on */
  _channel: AmqpLib.Channel;
  /** received messages only: original amqplib message */
  _message: AmqpLib.Message;
  constructor(content?: any, options: any = {}) {
    this.properties = options;
    if (content !== undefined) {
      this.setContent(content);
    }
  }
  setContent(content: any): void {
    if (typeof content === "string") {
      this.content = new Buffer(content);
    } else if (!(content instanceof Buffer)) {
      this.content = new Buffer(JSON.stringify(content));
      this.properties.contentType = "application/json";
    } else {
      this.content = content;
    }
  }
  getContent(): any {
    var content = this.content.toString();
    if (this.properties.contentType === "application/json") {
      content = JSON.parse(content);
    }
    return content;
  }
  sendTo(destination: Exchange | Queue, routingKey: string = ""): void {
    // inline function to send the message
    var sendMessage = () => {
      try {
        destination._channel.publish(exchange, routingKey, this.content, this.properties);
      } catch (err) {
        log.log("debug", "Publish error: " + err.message, {
          module: "amqp-ts",
        });
        var destinationName = destination._name;
        var connection = destination._connection;
        log.log("debug", "Try to rebuild connection, before Call.", {
          module: "amqp-ts",
        });
        connection._rebuildAll(err).then(() => {
          log.log("debug", "Retransmitting message.", { module: "amqp-ts" });
          if (destination instanceof Queue) {
            connection._queues[destinationName].publish(this.content, this.properties);
          } else {
            connection._exchanges[destinationName].publish(this.content, routingKey, this.properties);
          }
        });
      }
    };
    var exchange: string;
    if (destination instanceof Queue) {
      exchange = "";
      routingKey = destination._name;
    } else {
      exchange = destination._name;
    }
    // execute sync when possible
    if (destination.initialized.isFulfilled()) {
      sendMessage();
    } else {
      (<Promise<any>>destination.initialized).then(sendMessage);
    }
  }
  ack(allUpTo?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.ack(this._message, allUpTo);
    }
  }
  nack(allUpTo?: boolean, requeue?: boolean): void {
    if (this._channel !== undefined) {
      this._channel.nack(this._message, allUpTo, requeue);
    }
  }
  reject(requeue = false): void {
    if (this._channel !== undefined) {
      this._channel.reject(this._message, requeue);
    }
  }
}
