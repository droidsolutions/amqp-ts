import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const severities = process.argv.slice(2);
if (severities.length === 0) {
  console.log("Usage: receive_logs_direct.mjs [info] [warning] [error]");
  process.exit(1);
}

const connection = new Connection(url);

const exchange = connection.declareExchange("direct_logs", "direct", { durable: false });
const queue = connection.declareQueue("", { exclusive: true });

// connect the queue to the exchange for each severity
await Promise.all(severities.map((severity) => queue.bind(exchange, severity)));

await queue.activateConsumer(
  (message) => {
    const content = message.content.toString();
    const routingKey = message.fields.routingKey;
    console.log(" [x] " + routingKey + " : '" + content + "'");
  },
  { rawMessage: true, noAck: true },
);
console.log(" [*] Waiting for logs. To exit press CTRL+C");
