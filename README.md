# DroidSolutions amqp-ts (AMQP TypeScript)

[![Main](https://github.com/droidsolutions/amqp-ts/actions/workflows/main.yml/badge.svg)](https://github.com/droidsolutions/amqp-ts/actions/workflows/main.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![npm (scoped)](https://img.shields.io/npm/v/@droidsolutions-oss/amqp-ts)](https://www.npmjs.com/package/@droidsolutions-oss/amqp-ts)

This is a fork of [amqp-ts](https://github.com/abreits/amqp-ts).

# Table of Contents

- [Overview](#overview)
- [Usage](#usage)
- [Migrating from 3.x](#migrating)

# Overview <a name="overview"></a>

Amqp-ts is a library for nodejs that simplifies communication with AMQP message busses written in Typescript. It has been tested on RabbitMQ. It uses the [amqplib](http://www.squaremobius.net/amqp.node/) library by [Michael Bridgen (squaremo)](https://github.com/squaremo).

## Difference to the original library

Changes to the [original amqp-ts](https://github.com/abreits/amqp-ts) package:

- using up-to-date [amqplib](http://www.squaremobius.net/amqp.node/) (unfortunately the original package uses a four year old version that only support outdated NodeJS version)
- dropped support for outdated NodeJS versions, version 4 needs Node.js 22.13 or newer and is published as an ES module.
- dropped winston as dependency, instead a factory can be provided to the connection constructor which returns any logger.
- the deprecated methods like `Exchange.publish`, `Exchange.startConsumer`, `Queue.publish` and `Queue.startConsumer` are removed from this library, since their replacements like `Exchange.send` and `Exchange.activateConsumer` already existed.
- fixes for https://github.com/abreits/amqp-ts/pull/46 and https://github.com/abreits/amqp-ts/issues/20 have been implemented
- add basic metrics

## Defining Features

- [High level non opinioned library], no need to worry about channels etc.
- ['Lazy' initialization](#initialization), async AMQP dependencies are resolved automatically
- [Automatic reconnection](#reconnect), when the connection with the AMQP server fails, the whole connection and configuration is rebuilt automatically (using the connection recovery of amqplib 2)
- Written in typescript.

## Current status

The library is considered production ready.

It does depend on the following npm libraries:

- [amqplib](http://www.squaremobius.net/amqp.node/)

## Lazy Initialization <a name="initialization"></a>

No need to nest functionality, just create a connection, declare your exchanges, queues and
bindings and send and receive messages. The library takes care of any direct dependencies.

If you define an exchange and a queue and bind the queue to the exchange and want to make sure that the queue is connected to the exchange before you send a message to the exchange you can call the `connection.completeConfiguration()` method and act on the promise it returns.

# Usage <a name="usage"></a>

Install the package (it needs Node.js `>=22.13.0` and brings its own typings, no `@types/amqplib` required):

```sh
npm install @droidsolutions-oss/amqp-ts
```

The package is an ES module. All examples below use `import` and top-level `await`, so run them as ES modules (`.mjs` files, or `"type": "module"` in your `package.json`). Everything is exported from the package root; see [Migrating from 3.x](#migrating) if you use CommonJS.

There are multiple ways to declare your exchanges, queues and bindings. Each of those has an `initialized` property which is a promise that resolves when initialization is complete. You can either await it yourself or call `completeConfiguration` on the connection like explained in [Lazy initialization](#initialization).

## Async Typescript Example

```ts
import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const connection = new Connection("amqp://localhost");

// publish
const exchange = await connection.declareExchangeAsync("ExchangeName");

const msg = new Message("Test");
exchange.send(msg);

// subscribe/consume
const queue = await connection.declareQueueAsync("QueueName");
await queue.bind(exchange);
await queue.activateConsumer((message: Message) => {
  console.log("Message received: " + message.getContent());
});
```

## Lazy Typescript Example

```ts
import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const connection = new Connection("amqp://localhost");
const exchange = connection.declareExchange("ExchangeName");
const queue = connection.declareQueue("QueueName");
void queue.bind(exchange);
void queue.activateConsumer((message: Message) => {
  console.log("Message received: " + message.getContent());
});

// it is possible that the following message is not received because
// it can be sent before the queue, binding or consumer exist
const msg = new Message("Test");
exchange.send(msg);

// This waits until all exchanges/queues/bindings are initialized
await connection.completeConfiguration();
// the following message will be received because
// everything you defined earlier for this connection now exists
const msg2 = new Message("Test2");
exchange.send(msg2);
```

More examples can be found in the [tutorials directory](https://github.com/droidsolutions/amqp-ts/tree/master/tutorials).

## Messages

A message consists of the content (the data you want to send) and some optional properties that are defined by AMQP. This metadata offers some ways for consumers and providers to know how to process a message. For example when you provide an object as content then it is converted to a JSON string and the `contentType` property is set to `application/json`. This way the consumer knows, that the message should be parsed from json. For a detailed guide on the properties, you can refer to [the RabbitMQ documentation](https://www.rabbitmq.com/consumers.html#message-properties).

Properties that are set by this library are:

- contentType - when you give anything but Buffers and strings to the Message constructor
- contentEncoding - when you give anything but Buffers and strings to the Message constructor (currently always `utf-8`)
- timestamp - if not set by you it will be set to the current timestamp in UTC
- correlationId - if it is specified by the incoming message it will be set to the automatic reply (see below)

## Logging

The last argument of the `Connection` constructor takes a logger factory function. If you specify it, the function should return a logger that matches the `SimpleLogger` interface. This type is heavily inspired by the style of [Pino](https://github.com/pinojs/pino), but you can write a wrapper for any logger you like. It should support `%s`, `%d` and `%o` string interpolation, as they are used for internal log messages.

If you do not specify a logger factory, no logs are emitted. This includes errors thrown by your own event listeners, which are caught and logged at error level (see [Events](#events)), and messages that have to be dropped (see [Sending messages](#sending)). So pass a logger factory in production, otherwise these problems are invisible.

Example usage with Pino:

```ts
const logger = pino({
  name: "amqp-ts-using-app",
  level: "info",
  formatters: {
    level: (label, _number) => {
      return { level: label };
    },
  },
  redact: [],
  serializers: { err: pino.stdSerializers.err },
});

loggerFactory = (context, meta) => {
  if (!meta) {
    meta = {};
  }
  const className = typeof context === "string" ? context : context.name;
  meta.context = className;

  return logger.child(context, meta);
};

const connection = new Connection("amqp://localhost", {}, {}, loggerFactory);
```

The above example would result in log messages like these:

```json
{
  "level": "info",
  "time": 1586871242321,
  "pid": 80174,
  "hostname": "some-machine",
  "name": "amqp-ts-using-app",
  "module": "amqp-ts",
  "context": "Connection",
  "msg": "Connection established."
}
```

```json
{
  "level": "error",
  "time": 1586871243860,
  "pid": 80174,
  "hostname": "some-machine",
  "name": "amqp-ts-using-app",
  "exchange": "TestExchange_33",
  "context": "Exchange",
  "err": {
    "type": "Error",
    "message": "Operation failed: ExchangeDeclare; 404 (NOT-FOUND) with message \"NOT_FOUND - no exchange 'TestExchange_33' in vhost '/'\"",
    "stack": "Error: Operation failed: ExchangeDeclare; 404 (NOT-FOUND) with message \"NOT_FOUND - no exchange 'TestExchange_33' in vhost '/'\"\n    at reply ...",
    "code": 404,
    "classId": 40,
    "methodId": 10
  },
  "msg": "Failed to create exchange 'TestExchange_33'."
}
```

Note: for errors to appear in the log, you must use a serializer for Pino like the given `pino.stdSerializers.err` used above.

The advantage of this approach is, you'll see exactly who throws the error as well as additional context, like which exchange could not be declared. Of couse you can also use another logger like `winston`:

```ts
const logger = new winston.Logger({
  transports: [
    new winston.transports.Console({
      level: process.env.AMQPTS_LOGLEVEL || "error",
      format: winston.format.combine(
        winston.format.splat(), // needed for string interpolation
        // ... any additional formats
      ),
    }),
  ],
});

const loggerFactory = (context, meta) => {
  return {
    info(metaOrMsg: object | string, msg?: string, ...args: any[]): void {
      if (typeof metaOrMsg === "string") {
        logger.info(metaOrMsg, ...args);
      } else {
        logger.info(msg, ...args);
        logger.info("additional meta %o", metaOrMsg);
      }
    },
    /// implement other methods like this ...
  };
};
```

## Connection Status

To know the status of the connection: `connection.isConnected`. Returns true if the connection exists and false, otherwise.

`connection.getConnection` returns the current [amqplib](https://amqp-node.github.io/amqplib/) `ChannelModel`, or `undefined` while the connection is down (before the first connect, during a reconnect and after `close()`). It is replaced on every reconnect, so do not keep a reference to it. Messaging should go through the exchanges and queues of this library, which survive reconnects.

`connection.initialized` is a promise that resolves once the connection is established and the declared topology exists. While the connection is down it is replaced by a pending promise that resolves after the next successful reconnect. It rejects when `close()` is called or recovery gives up before that. The same is true for the `initialized` promises of exchanges, queues, bindings and the consumer of a queue (`activateConsumer`): they reject on `close()` and when recovery gives up, and reading `initialized` of an entity after `close()` returns a rejected promise.

## Sending messages <a name="sending"></a>

`exchange.send(message, routingKey)` and `queue.send(message)` return `void`. A message sent before the connection or the exchange/queue is ready is buffered and sent as soon as it is. A message that can no longer be sent, because recovery gave up, `close()` was called or the exchange/queue was closed or deleted, is logged at warn level and dropped. (In 3.x, sending to a closed entity threw a `TypeError`.) If you need to know that a message left, await `connection.completeConfiguration()` or the `initialized` promise of the target before sending.

## Events <a name="events"></a>

The `Connection` is an `EventEmitter`. It emits these events:

| Event                       | Emitted when                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_connection`           | The first connection is established and the declared topology (exchanges, queues, bindings, consumers) is initialized.                                                    |
| `re_established_connection` | A later connection, after `lost_connection`, is established and the topology is restored.                                                                                |
| `lost_connection`           | The connection was lost unexpectedly (not after `close()`), before reconnecting is attempted.                                                                             |
| `trying_connect`            | A (re)connect attempt was scheduled, once per attempt.                                                                                                                    |
| `close_connection`          | The connection was closed after you called `close()`.                                                                                                                     |
| `error_connection(err)`     | Recovery gave up (see `maxRetries`), or a single exchange, queue, binding or consumer could not be declared or registered again during recovery. `err` is the cause.     |

```ts
connection.on("open_connection", () => console.log("connected"));
connection.on("lost_connection", () => console.log("connection lost, reconnecting"));
connection.on("re_established_connection", () => console.log("connected again"));
connection.on("error_connection", (err) => console.error("connection problem", err));
```

Notes:

- `error_connection` is not by itself a "the connection is dead" signal. While recovery runs it also fires when only one entity could not be restored (for example a queue whose declaration now conflicts with an existing one, a consumer the broker refuses, or one it cancels again right after it was registered again), although the connection itself is fine. After recovery gave up (finite `maxRetries`) it fires with the give-up error and no more reconnects happen.
- Exceptions thrown by your listeners are caught and logged at error level instead of propagating, and the listeners after the failing one still run. With the default (empty) logger such errors are invisible, so pass a [logger factory](#logging).

## Automatic Reconnection <a name="reconnect"></a>

When the library detects that the connection with the AMQP server is lost, it reconnects automatically and rebuilds the whole topology (exchanges, queues, bindings and consumers). This uses the connection recovery of amqplib 2. The third argument of the `Connection` constructor takes the `RecoveryOptions`:

| Option              | Default    | Meaning                                                                                                   |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `initialDelay`      | `100`      | Delay before the first retry, in milliseconds.                                                            |
| `maxDelay`          | `30000`    | Upper bound of the delay, in milliseconds.                                                                |
| `factor`            | `2`        | The delay is multiplied by this factor after every attempt (exponential backoff).                         |
| `jitter`            | `0.2`      | Fraction (0 to 1) by which each delay randomly varies up or down, so not all clients reconnect at once. The delay never exceeds `maxDelay`. |
| `maxRetries`        | `Infinity` | Number of reconnect attempts before giving up. Also bounds the first connect unless `initialMaxRetries` is set. |
| `initialMaxRetries` | `maxRetries` | Number of attempts before the first successful connect only. Afterwards `maxRetries` applies.           |
| `calculateDelay`    | -          | `(attempt: number) => number`, your own delay in milliseconds (attempts start at 1) instead of the backoff. |

By default it retries forever. Example that fails fast when the broker is unreachable at startup, but keeps retrying once it was connected:

```ts
import { Connection, type RecoveryOptions } from "@droidsolutions-oss/amqp-ts";

const recovery: RecoveryOptions = { initialMaxRetries: 3, initialDelay: 500, maxDelay: 10000 };
const connection = new Connection("amqp://localhost", {}, recovery);
connection.on("error_connection", (err) => {
  // only fired at startup (after 3 failed attempts), or when a single entity could not be restored
  console.error("connection problem", err);
});

await connection.initialized; // rejects if the broker is still unreachable after 3 retries
```

`RecoveryOptions` is amqplib's type without `setup` and `waitForConnect`, which amqp-ts uses itself.

### What happens on connection loss

- On `lost_connection` the connection and all exchanges, queues, bindings and consumers become "not initialized" and their `initialized` promises are replaced by pending ones. Messages you send meanwhile are buffered.
- After each reconnect the topology is declared again in dependency order (exchanges, queues, bindings, consumers) before `re_established_connection` (or `open_connection` for the first connect) is emitted and the pending promises resolve. A binding to an exchange of another `Connection` is the exception: it waits for that connection to have the exchange initialized, so it may be created later.
- If recovery gives up (finite `maxRetries`), `error_connection` fires with the give-up error, every pending `initialized` rejects, and buffered messages are dropped with a warn log.
- Without a reconnect: when the broker closes the channel of a single exchange or queue (for example error 406 on a double ack, or 404 when publishing to a deleted exchange), only that entity gets a new channel, including its bindings and consumer. A consumer cancelled by the broker (for example because its queue was deleted) is registered again. If the broker cancels it again within a second of that, it stays cancelled until the next reconnect and `error_connection` is emitted.

## Automatic JSON content

If your message content is not a string and not a buffer it is converted automatically to a JSON string. The `contentType` is set to `application/json` and the `contentEncoding` is set to `utf-8`. Vice versa if you call `getContent()` on the message and the `contentType` is set to `application/json` the string will be parsed and the parsed result will be returned. If you want to avoid the `any` type you can use `getJsonContent<T>()` instead. This method throws an error, if the `contentType` is not set to `application/json`.

## Automatic ReplyTo and RPC <a name="rpc"></a>

If your message consumer returns a value and the `replyTo` property is set in the message property, the value is sent to the queue given in the `replyTo` field. The correlationId is set to the response message if it is set in the request. If you want to set other properties you can specify them when calling `activateConsumer` in the options. If you don't return any value (a.k.a return `undefined`) no automatic reply is sent. You have to manage this yourself then.

This is how you implement request/response (RPC) with this library: the requester sends a message with `replyTo` (and a `correlationId` to match the answer) and consumes its reply queue, the consumer simply returns the result.

Examples:

Provider/Publisher side:

```ts
import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const connection = new Connection("amqp://localhost");
const exchange = await connection.declareExchangeAsync("ExchangeName");
const queue = await connection.declareQueueAsync("rpc_reply");
await queue.activateConsumer((message: Message) => {
  console.log("RPC reply Message received: " + message.properties.correlationId); // should log the ID you set in the message below

  const content = message.getJsonContent<{ my: string }>();
  console.log("Result is ", content.my); // "Result is result"
});

// sending the message
const msg = new Message(
  { some: "value" },
  {
    correlationId: "jC7oTFEeWIfmn_c8Z5Aa",
    replyTo: "rpc_reply",
    appId: "app:my-app component:rpc-client",
  },
);
exchange.send(msg, "rpc_queue");
```

The consumer of the reply queue is a normal consumer and is registered again after a reconnect. Replies that arrive while it is down stay in the queue.

Consumer/Subscriber side:

```ts
import { Connection, Message } from "@droidsolutions-oss/amqp-ts";

const connection = new Connection("amqp://localhost");
const exchange = await connection.declareExchangeAsync("ExchangeName");
const queue = await connection.declareQueueAsync("rpc_queue");
await queue.bind(exchange);
await queue.activateConsumer((message: Message) => {
  console.log(`Message from ${message.properties.appId} received: ${message.properties.correlationId}`); // "Message from app:my-app component:rpc-client received: jC7oTFEeWIfmn_c8Z5Aa

  const content = message.getJsonContent<{ some: string }>();
  console.log("Content is ", content.some); // "Content is value"
  // process message content

  return { my: "result" };
});
```

## Metrics

The connection instance offers a method that returns basic metrics of the connection. For the metrics there is a TypeScript interface `ConnectionMetrics` that contains possible metrics of the connection.

To receive them you can call `getMetrics()` on the connection instance.

## Migrating from 3.x <a name="migrating"></a>

Version 4.0 is a major release. This section lists everything you have to change, and the behaviour changes you may notice.

### Breaking changes

- **ESM only.** The package is an ES module. In ESM code import from the package root as before (`import { Connection } from "@droidsolutions-oss/amqp-ts"`). In CommonJS code you can still load it with `require()` on Node `>=22.13.0` (which can `require()` ES modules without a flag):

  ```js
  const { Connection, Message } = require("@droidsolutions-oss/amqp-ts");
  ```

  In TypeScript, set `"module": "node20"` or `"nodenext"` (with a matching `moduleResolution`) so that `require` of an ES module is understood. `module: "commonjs"` will not resolve the new package.
- **Node.js `>=22.13.0`.** Older versions are not supported (the `engines` field says so).
- **No deep imports.** Only the package root is exported. `import { Message } from "@droidsolutions-oss/amqp-ts/lib/Message"` (and every other `lib/...` path) fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. All public classes and types are exported from the root: `Connection`, `Exchange`, `Queue`, `Binding`, `Message`, `ApplicationName` and the types `AmqpProperties`, `ConnectionMetrics`, `RecoveryOptions`, `Topology`, `LoggerFactory`, `SimpleLogger`, `ExchangeType`, `ExchangeDeclarationOptions`, `QueueDeclarationOptions`, `ExchangeInitializeResult`, `QueueInitializeResult`, `DeleteResult`, `StartConsumerResult`.
- **`RecoveryOptions` replace `ReconnectStrategy`.** The third `Connection` argument is now amqplib's [`RecoveryOptions`](#reconnect). The fixed interval is replaced by exponential backoff with jitter.

  ```ts
  // 3.x
  new Connection(url, {}, { retries: 0, interval: 1500 }); // retry forever, every 1.5 s
  new Connection(url, {}, { retries: 5, interval: 1500 }); // give up after 5 attempts

  // 4.x
  new Connection(url); // the default retries forever (maxRetries: Infinity) with backoff
  new Connection(url, {}, { maxRetries: 5 }); // give up after 5 attempts
  new Connection(url, {}, { initialDelay: 1500, maxDelay: 1500, factor: 1, jitter: 0 }); // fixed delay, if you really want it
  ```

  `{ retries: 0 }` (forever) becomes the default, `{ retries: n }` becomes `{ maxRetries: n }`, and the `interval` becomes `initialDelay`/`maxDelay`/`factor`/`jitter`. New is `initialMaxRetries`, which lets startup fail fast while later recovery retries forever. The `ReconnectStrategy` type is gone.
- **`heartbeat=0` disables heartbeats.** amqplib reads the heartbeat from the query of the connection URL (`amqp://localhost?heartbeat=0`), not from the socket options. amqplib 2 treats `heartbeat=0` as "no heartbeats" instead of "use the server's value". If your URL contains `heartbeat=0` to get the server's value, remove the parameter instead.
- **`Exchange.rpc` and `Queue.rpc` are removed.** `rpc` only resolved the first call with its reply and lost its reply consumer after a reconnect. Send a message with `replyTo` and `correlationId` and consume the reply queue instead; the consumer's return value is sent back automatically. See [Automatic ReplyTo and RPC](#rpc):

  ```ts
  // 3.x
  const result = await queue.rpc(21);
  console.log(result.getContent());

  // 4.x
  const replies = await connection.declareQueueAsync("my_replies", { exclusive: true });
  await replies.activateConsumer((reply) => console.log(reply.getContent()), { noAck: true });
  queue.send(new Message(21, { replyTo: "my_replies", correlationId: "some-unique-id" }));
  ```

  Match replies to requests by `correlationId` if you have more than one call in flight.
- **`getConnection` and `connection`.** `connection.getConnection` now returns the current amqplib `ChannelModel` (or `undefined` while disconnected) instead of the amqplib `Connection`, and the public `connection` field is gone. Use `getConnection` and check for `undefined`.
- **`tryToConnect` is removed.** The connection is established and re-established automatically, there is nothing to call. Use the [events](#events) and `connection.initialized` to react to its state.
- **Typings.** `@types/amqplib` is no longer needed (amqplib ships its own types), remove it from your dependencies. Underscore-prefixed members (`_channel`, `_exchanges`, `_queues`, ...) are internal and no longer in the typings.

### Behaviour changes

- **`error_connection` is broader.** Besides "recovery gave up" (finite `maxRetries`, with the give-up error) it also fires when a single exchange, queue or binding cannot be declared again, or a consumer cannot be registered again, during recovery. The connection itself is fine then, so do not treat the event as "connection dead".
- **Pending `initialized` promises reject.** Every pending `initialized` (connection, exchanges, queues, bindings and consumers) rejects when you call `close()` and when recovery gives up. Reading the `initialized` of an entity after `close()` returns a rejected promise. Add error handling where you await them without one.
- **Unsendable messages are dropped.** `send()` still returns `void`. Messages that can no longer be sent (recovery gave up, `close()` was called, the exchange or queue was closed or deleted) are logged at warn level and dropped. In 3.x a send to a closed entity threw a `TypeError`.
- **Listener exceptions are logged.** Exceptions thrown by your event listeners are caught and logged at error level instead of propagating. With the default (empty) logger they are invisible, so pass a `loggerFactory`.
- **Bindings wait for their source exchange.** A binding is created once its source exchange is initialized through this library, and fails if that exchange cannot be declared. In 3.x a queue binding was created as soon as the queue was ready, whenever the exchange happened to exist on the broker. Declare the source exchange on the same connection (`connection.declareExchange(...)`) before binding to it.
- **`activateConsumer` rejects if the queue declaration fails.** The returned promise rejects with the declaration error.
- **Reconnect timing.** The default is exponential backoff with jitter (100 ms initial delay, 30 s maximum, factor 2, jitter 0.2) retrying forever, instead of a fixed 1.5 s interval.
- **Broker-side channel and consumer failures are repaired.** A channel the broker closes (for example on a double ack) is re-created for that exchange or queue only, and a consumer cancelled by the broker is registered again, see [What happens on connection loss](#reconnect).
