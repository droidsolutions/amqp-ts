RabbitMQ Tutorials
==================

This contains amqp-ts version of the [RabbitMQ tutorials](https://www.rabbitmq.com/getstarted.html).

The examples are provided as ES modules (`.mjs`) and import from `@droidsolutions-oss/amqp-ts`. Inside this repository that name resolves to the package itself, so run `npm run build` once and then start an example, for example `node tutorials/1_hello_world/send.mjs`. They need Node.js 22.13 or newer.

The examples connect to `amqp://localhost`. Set the `AMQP_URL` environment variable to use another broker, for example `AMQP_URL=amqp://user:pass@host:5672 node tutorials/1_hello_world/receive.mjs`.

The `6_rpc` tutorial shows request/response with the `replyTo` and `correlationId` properties; the server's return value is sent back to the `replyTo` queue automatically.
