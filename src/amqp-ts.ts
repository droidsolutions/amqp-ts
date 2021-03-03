/**
 * Created by Ab on 17-9-2015.
 *
 * methods and properties starting with '_' signify that the scope of the item should be limited to
 * the inside of the enclosing namespace.
 */

// simplified use of amqp exchanges and queues, wrapper for amqplib

import * as path from "path";

/** Name of the current application determined by AMQP_APPLICATIONNAME env or the name of the dir we're running in. */
export const ApplicationName =
  process.env.AMQP_APPLICATIONNAME ||
  (process.argv.length > 1
    ? path.parse
      ? path.parse(process.argv[1]).name
      : path.basename(process.argv[1])
    : "amqpApp");

// name for the RabbitMQ direct reply-to queue
export const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
