# DroidSolutions amqp-ts (AMQP TypeScript)

[![Main](https://github.com/droidsolutions/amqp-ts/actions/workflows/main.yml/badge.svg)](https://github.com/droidsolutions/amqp-ts/actions/workflows/main.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![npm (scoped)](https://img.shields.io/npm/v/@droidsolutions-oss/amqp-ts)](https://www.npmjs.com/package/@droidsolutions-oss/amqp-ts)

This is a fork of [amqp-ts](https://github.com/abreits/amqp-ts).

# Table of Contents

- [Overview](#overview)
- [Usage](#usage)

# Overview <a name="overview"></a>

Amqp-ts is a library for nodejs that simplifies communication with AMQP message busses written in Typescript. It has been tested on RabbitMQ. It uses the [amqplib](http://www.squaremobius.net/amqp.node/) library by [Michael Bridgen (squaremo)](https://github.com/squaremo).

## Difference to the original library

Changes to the [original amqp-ts](https://github.com/abreits/amqp-ts) package:

- using up-to-date [amqplib](http://www.squaremobius.net/amqp.node/) (unfortunately the original package uses a four year old version that only support outdated NodeJS version)
- dropped support for outdated NodeJS versions (Compile target in tsconfig is ES2019 which is fully supported by Node 12).
- dropped winston as dependency, instead a factory can be provided to the connection constructor which returns any logger.
- the deprecated methods like `Exchange.publish`, `Exchange.startConsumer`, `Queue.publish` and `Queue.startConsumer` are removed from this library, since their replacements like `Exchange.send` and `Exchange.activateConsumer` already existed.
- fixes for https://github.com/abreits/amqp-ts/pull/46 and https://github.com/abreits/amqp-ts/issues/20 have been implemented
- add basic metrics

## Defining Features

- [High level non opinioned library], no need to worry about channels etc.
- ['Lazy' initialization](#initialization), async AMQP dependencies are resolved automatically
- [Automatic reconnection](#reconnect), when the connection with the AMQP server fails, the whole connection and configuration is rebuilt automatically
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

There are multiple ways to declare your exchanges, queues and bindings. Each of those has an `initialized` property which is a promise that resolves when initialization is complete. You can either await it yourself or call `completeConfiguration` on the connection like explained in [Lazy initialization](#initialization).

## Async Typescript Example

```ts
import { Connection, Message } from "amqp-ts";

var connection = new Connection("amqp://localhost");

// publish
var exchange = await connection.declareExchangeAsync("ExchangeName");

var msg = new Message("Test");
exchange.send(msg);

// subscribe/consume
var queue = await connection.declareQueueAsync("QueueName");
await queue.bind(exchange);
await queue.activateConsumer((message: Message) => {
  console.log("Message received: " + message.getContent());
});
```

## Lazy Typescript Example

```ts
import { Connection, Message } from "amqp-ts";

var connection = new Connection("amqp://localhost");
var exchange = connection.declareExchange("ExchangeName");
var queue = connection.declareQueue("QueueName");
void queue.bind(exchange);
void queue.activateConsumer((message: Message) => {
  console.log("Message received: " + message.getContent());
});

// it is possible that the following message is not received because
// it can be sent before the queue, binding or consumer exist
var msg = new Message("Test");
exchange.send(msg);

// This waits until all exchanges/queues/bindings are initialized
await connection.completeConfiguration();
// the following message will be received because
// everything you defined earlier for this connection now exists
var msg2 = new Message("Test2");
exchange.send(msg2);
```

More examples can be found in the [tutorials directory](https://github.com/abreits/amqp-ts/tree/master/tutorials).

## Messages

A message consists of the content (the data you want to send) and some optional properties that are defined by AMQP. This metadata offers some ways for consumers and providers to know how to process a message. For example when you provide an object as content then it is converted to a JSON string and the `contentType` property is set to `application/json`. This way the consumer knows, that the message should be parsed from json. For a detailed guide on the properties, you can refer to [the RabbitMQ documentation](https://www.rabbitmq.com/consumers.html#message-properties).

Properties that are set by this library are:

- contentType - when you give anything but Buffers and strings to the Message constructor
- contentEncoding - when you give anything but Buffers and strings to the Message constructor (currently always `utf-8`)
- timestamp - if not set by you it will be set to the current timestamp in UTC
- correlationId - if it is specified by the incoming message it will be set to the automatic reply (see below)

## Logging

The last argument of the `Connection` constructor takes a logger factory function. If you specify it, the function should return a logger that matches the `SimpleLogger` interface. This type is heavily inspired by the style of [Pino](https://github.com/pinojs/pino), but you can write a wrapper for any logger you like. It should support `%s`, `%d` and `%o` string interpolation, as they are used for internal log messages.

If you do not specify a logger factory, no logs are emitted.

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

const connection = new Connection("amqp://localhost", {}, { retries: 0, interval: 1500 }, loggerFactory);
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

## Events

    #on('open_connection', function() {...})

It's emitted when a connection is concretized and can publish/subscribe in Rabbit Bus.

    #on('close_connection', function() {...})

It's emitted when a connection is closed, after calling the close method.

    #on('lost_connection', function() {...})

It is emitted when the connection is lost and before attempting to re-establish the connection.

    #on('trying_connect', function() {...})

It is emitted during the time that try re-establish the connection.

    #on('re_established_connection', function() {...})

It is emitted when the connection is re-established.

    #on('error_connection', function(err) {...})

It's emitted when a error is registered during the connection.

## Automatic Reconnection <a name="reconnect"></a>

When the library detects that the connection with the AMQP server is lost, it tries to automatically reconnect to the server.

## Automatic JSON content

If your message content is not a string and not a buffer it is converted automatically to a JSON string. The `contentType` is set to `application/json` and the `contentEncoding` is set to `utf-8`. Vice versa if you call `getContent()` on the message and the `contentType` is set to `application/json` the string will be parsed and the parsed result will be returned. If you want to avoid the `any` type you can use `getJsonContent<T>()` instead. This method throws an error, if the `contentType` is not set to `application/json`.

## Automatic ReplyTo

If your message consumer returns a value and the `replyTo` property is set in the message property, the value is send to the queue given in the `replyTo` field. The correlationId is set to the response message if it is set in the request. If you want to set other properties you can specify them when calling `activateConsumer` i nthe options. If you don't return any value (a.k.a return `undefined`) no automatic reply is send. You have manage this by yourself then.

Examples:

Provider/Publisher side:

```ts
import { Connection, Message } from "amqp-ts";

var connection = new Connection("amqp://localhost");
var exchange = await connection.declareExchangeAsync("ExchangeName");
var queue = await connection.declareQueueAsync("rpc_reply");
await queue.activateConsumer((message: Message) => {
  console.log("RPC reply Message received: " + message.properties.correlationId); // should log the ID you set in the message below

  const content = message.getJsonContent<MyResultDto>();
  console.log("Result is ", content.my); // "Result is result"
});

// sending the message
var msg = new Message(
  { some: "value" },
  {
    correlationId: "jC7oTFEeWIfmn_c8Z5Aa",
    replyTo: "rpc_reply",
    appId: "app:my-app component:rpc-client",
  },
);
exchange.send(msg, "rpc_queue");
```

Consumer/Subscriber side:

```ts
import { Connection, Message } from "amqp-ts";

var connection = new Connection("amqp://localhost");
var exchange = await connection.declareExchangeAsync("ExchangeName");
var queue = await connection.declareQueueAsync("rpc_queue");
await queue.bind(exchange);
await queue.activateConsumer((message: Message) => {
  console.log(`Message from ${message.properties.appId} received: ${message.properties.correlationId}`); // "Message from app:my-app component:rpc-client received: jC7oTFEeWIfmn_c8Z5Aa

  const content = message.getJsonContent<MyDto>();
  console.log("Content is ", content.some); // "Content is value"
  // process message content

  return { my: "result" };
});
```

## Metrics

The connection instance offers a method that returns basic metrics of the connection. For the metrics there is a TypeScript interface `ConnectionMetrics` that contains possible metrics of the connection.

To receive them you can call `getMetrics()` on the connection instance.