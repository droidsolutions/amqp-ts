import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

const exchange = connection.declareExchange("logs", "fanout", { durable: false });

// an exclusive queue with a generated name, it is deleted when the connection closes
const queue = connection.declareQueue("", { exclusive: true });

// connect the queue to the exchange
await queue.bind(exchange);

await queue.activateConsumer((message) => {
  console.log(" [x] " + message.getContent());
});
console.log(" [*] Waiting for logs. To exit press CTRL+C");
