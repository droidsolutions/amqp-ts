import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";


const connection = new Connection(url);

const queue = connection.declareQueue("task_queue", { durable: true });

// get the message from the command line
const message = new Message(process.argv.slice(2).join(" ") || "Hello World!", { persistent: true });

queue.send(message);

await connection.completeConfiguration();
console.log(" [x] Sent '" + message.getContent() + "'");
setTimeout(() => connection.close(), 500);
