import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

const queue = connection.declareQueue("task_queue", { durable: true });

// this keeps running until the program is halted or is stopped with queue.stopConsumer()
await queue.activateConsumer(
  (message) => {
    // fake a second of work for every dot in the message
    const content = message.getContent();
    const seconds = content.split(".").length - 1;
    console.log(" [x] received message: " + content);
    setTimeout(() => {
      console.log(" [x] Done");
      message.ack(); // acknowledge that the message has been received (and processed)
    }, seconds * 1000);
  },
  { noAck: false },
);
console.log(" [*] Waiting for messages. To exit press CTRL+C");
