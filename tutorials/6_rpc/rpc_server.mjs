import { Connection } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

const queue = connection.declareQueue("rpc_queue", { durable: false });

// compute the fibonacci number
function fibonacci(n) {
  if (n === 0 || n === 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// The value returned by the consumer is sent automatically to the queue in the replyTo property of the
// request, with the correlationId of the request. If the request has no replyTo, nothing is sent back.
// This keeps running until the program is halted or is stopped with queue.stopConsumer()
await queue.activateConsumer(
  (message) => {
    const n = parseInt(message.getContent(), 10);
    console.log(" [.] fib(" + n + ")");

    return fibonacci(n);
  },
  { noAck: true },
);
console.log(" [x] Awaiting RPC requests. To exit press CTRL+C");
