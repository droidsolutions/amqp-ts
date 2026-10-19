import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

// declare a new queue, it will be created if it does not already exist
const queue = connection.declareQueue("hello", { durable: false });

// create a consumer function for the queue
// this keeps running until the program is halted or is stopped with queue.stopConsumer()
await queue.activateConsumer(
  (message) => {
    console.log("received message: " + message.getContent());
  },
  { noAck: true },
);
console.log(" [*] Waiting for messages. To exit press CTRL+C");
