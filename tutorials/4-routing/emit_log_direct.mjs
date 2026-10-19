import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";


const connection = new Connection(url);

const exchange = connection.declareExchange("direct_logs", "direct", { durable: false });

// get the severity and message from the command line
const args = process.argv.slice(2);
const message = new Message(args.slice(1).join(" ") || "Hello World!");
const severity = args.length > 0 ? args[0] : "info";

exchange.send(message, severity);

await connection.completeConfiguration();
console.log(" [x] Sent " + severity + " '" + message.getContent() + "'");
setTimeout(() => connection.close(), 500);
