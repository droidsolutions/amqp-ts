import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";


const connection = new Connection(url);

const exchange = connection.declareExchange("logs", "fanout", { durable: false });

const message = new Message(process.argv.slice(2).join(" ") || "Hello World!");

exchange.send(message);

await connection.completeConfiguration();
console.log(" [x] Sent '" + message.getContent() + "'");
setTimeout(() => connection.close(), 500);
