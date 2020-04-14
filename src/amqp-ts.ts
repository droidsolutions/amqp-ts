/**
 * Created by Ab on 17-9-2015.
 *
 * methods and properties starting with '_' signify that the scope of the item should be limited to
 * the inside of the enclosing namespace.
 */

// simplified use of amqp exchanges and queues, wrapper for amqplib

import * as path from "path";

export const ApplicationName =
  process.env.AMQPTS_APPLICATIONNAME ||
  (path.parse ? path.parse(process.argv[1]).name : path.basename(process.argv[1]));


// name for the RabbitMQ direct reply-to queue
export const DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
