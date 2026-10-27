import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

const exchange = connection.declareExchange("topic_logs", "topic", { durable: false });

// get the topic key and message from the command line
const args = process.argv.slice(2);
const message = new Message(args.slice(1).join(" ") || "Hello World!");
const key = args.length > 0 ? args[0] : "anonymous.info";

exchange.send(message, key);

await connection.completeConfiguration();
console.log(" [x] Sent " + key + ": '" + message.getContent() + "'");
setTimeout(() => connection.close(), 500);
