"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
exports.ApplicationName = process.env.AMQPTS_APPLICATIONNAME ||
    (path.parse ? path.parse(process.argv[1]).name : path.basename(process.argv[1]));
exports.DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
//# sourceMappingURL=amqp-ts.js.map