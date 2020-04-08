"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const winston = require("winston");
const path = require("path");
exports.ApplicationName = process.env.AMQPTS_APPLICATIONNAME ||
    (path.parse ? path.parse(process.argv[1]).name : path.basename(process.argv[1]));
var amqp_log = new winston.Logger({
    transports: [
        new winston.transports.Console({
            level: process.env.AMQPTS_LOGLEVEL || "error",
        }),
    ],
});
exports.log = amqp_log;
exports.DIRECT_REPLY_TO_QUEUE = "amq.rabbitmq.reply-to";
//# sourceMappingURL=amqp-ts.js.map