/**
 * AmqpSimple.ts - provides a simple interface to read from and write to RabbitMQ amqp exchanges
 * Created by Ab on 17-9-2015.
 *
 * methods and properties starting with '_' signify that the scope of the item should be limited to
 * the inside of the enclosing namespace.
 */

// simplified use of amqp exchanges and queues, wrapper for amqplib

import * as winston from "winston";
import * as path from "path";

export var ApplicationName =
  process.env.AMQPTS_APPLICATIONNAME ||
  (path.parse ? path.parse(process.argv[1]).name : path.basename(process.argv[1]));

// create a custom winston logger for amqp-ts
var amqp_log = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: process.env.AMQPTS_LOGLEVEL || "error",
    }),
  ],
});
export var log = amqp_log;

// name for the RabbitMQ direct reply-to queue
export const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
