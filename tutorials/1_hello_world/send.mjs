import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

// declare a new queue, it will be created if it does not already exist
const queue = connection.declareQueue("hello", { durable: false });

// the message is sent as soon as the connection and the queue are ready
queue.send(new Message("Hello World!"));

// wait until everything is declared, then give the message a moment to leave and close the connection
await connection.completeConfiguration();
console.log(" [x] Sent 'Hello World!'");
setTimeout(() => connection.close(), 500);
