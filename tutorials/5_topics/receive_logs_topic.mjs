import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.log("Usage: receive_logs_topic.mjs <facility>.<severity>");
  process.exit(1);
}

const connection = new Connection(url);

const exchange = connection.declareExchange("topic_logs", "topic", { durable: false });
const queue = connection.declareQueue("", { exclusive: true });

// connect the queue to the exchange for each key pattern
await Promise.all(keys.map((key) => queue.bind(exchange, key)));

await queue.activateConsumer(
  (message) => {
    const content = message.content.toString();
    const routingKey = message.fields.routingKey;
    console.log(" [x] " + routingKey + " : '" + content + "'");
  },
  { rawMessage: true, noAck: true },
);
console.log(" [*] Waiting for logs. To exit press CTRL+C");
