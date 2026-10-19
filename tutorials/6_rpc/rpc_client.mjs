import { randomUUID } from "node:crypto";
import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const url = process.env.AMQP_URL ?? "amqp://localhost";

const connection = new Connection(url);

// the queue the server sends its answers to, exclusive to this connection and deleted when it closes
// (use a name you choose, the library does not know the name the broker would generate for "")
const replyQueue = connection.declareQueue("rpc_reply_" + randomUUID(), { exclusive: true });
const requestQueue = connection.declareQueue("rpc_queue", { durable: false });

// get the number for fibonacci from the command line
const num = parseInt(process.argv[2], 10);
const correlationId = randomUUID();

console.log(" [x] Requesting fib(%d)", num);

// resolves with the reply that carries our correlationId
const reply = new Promise((resolve) => {
  replyQueue
    .activateConsumer(
      (message) => {
        if (message.properties.correlationId === correlationId) {
          resolve(message);
        }
      },
      { noAck: true },
    )
    .catch(() => {});
});

// wait until both queues exist, so the request is not sent before the reply queue can receive the answer
await connection.completeConfiguration();
requestQueue.send(new Message(num, { replyTo: replyQueue.name, correlationId }));

const result = await reply;
console.log(" [.] Got %s", result.getContent());
await connection.close();
