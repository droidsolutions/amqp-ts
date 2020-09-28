"use strict";
/**
 * Created by Ab on 17-9-2015.
 *
 * methods and properties starting with '_' signify that the scope of the item should be limited to
 * the inside of the enclosing namespace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECT_REPLY_TO_QUEUE = exports.ApplicationName = void 0;
// simplified use of amqp exchanges and queues, wrapper for amqplib
const path = require("path");
exports.ApplicationName = process.env.AMQPTS_APPLICATIONNAME ||
    (path.parse ? path.parse(process.argv[1]).name : path.basename(process.argv[1]));
// name for the RabbitMQ direct reply-to queue
exports.DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
//# sourceMappingURL=amqp-ts.js.map