# DroidSolutions amqp-ts (AMQP TypeScript)

![Main](https://github.com/droidsolutions/amqp-ts/workflows/Main/badge.svg)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

This is a fork of [amqp-ts](https://github.com/abreits/amqp-ts.

## Table of Contents

- [Overview](#overview)

## Overview <a name="overview"></a>

Amqp-ts is a library for nodejs that simplifies communication with AMQP message busses written in Typescript. It has been tested on RabbitMQ. It uses the [amqplib](http://www.squaremobius.net/amqp.node/) library by [Michael Bridgen (squaremo)](https://github.com/squaremo).

### Difference to the original library

Changes to the [original amqp-ts](https://github.com/abreits/amqp-ts) package:

- using up-to-date [amqplib](http://www.squaremobius.net/amqp.node/) (unfortunately the original package uses a four year old version the only support outdated NodeJS version)
- dropped support for outdated NodeJS versions (Compile target in tsconfig is ES2018 which is fully supported by Node 10).

### Defining Features

- [High level non opinioned library], no need to worry about channels etc.
- ['Lazy' initialization](#initialization), async AMQP dependencies are resolved automatically
- [Automatic reconnection](#reconnect), when the connection with the AMQP server fails, the whole connection and configuration is rebuilt automatically
- Written in typescript.

### Current status

The library is considered production ready.

It does depend on the following npm libraries:

- [amqplib](http://www.squaremobius.net/amqp.node/)
- [winston](https://github.com/winstonjs/winston)

### Lazy Initialization <a name="initialization"></a>

No need to nest functionality, just create a connection, declare your exchanges, queues and
bindings and send and receive messages. The library takes care of any direct dependencies.

If you define an exchange and a queue and bind the queue to the exchange and want to make
sure that the queue is connected to the exchange before you send a message to the exchange you can call the `connection.completeConfiguration()` method and act on the promise it returns.

##### Typescript Example

```TypeScript
import { Connection, Message } from "amqp-ts";

var connection = new Connection("amqp://localhost");
var exchange = connection.declareExchange("ExchangeName");
var queue = connection.declareQueue("QueueName");
queue.bind(exchange);
queue.activateConsumer((message) => {
    console.log("Message received: " + message.getContent());
});

// it is possible that the following message is not received because
// it can be sent before the queue, binding or consumer exist
var msg = new Message("Test");
exchange.send(msg);

connection.completeConfiguration().then(() => {
    // the following message will be received because
    // everything you defined earlier for this connection now exists
    var msg2 = new Message("Test2");
    exchange.send(msg2);
});
```

More examples can be found in the [tutorials directory](https://github.com/abreits/amqp-ts/tree/master/tutorials).

### Connection Status

To know the status of the connection: `connection.isConnected`. Returns true if the connection exists and false, otherwise.

### Events

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

### Automatic Reconnection <a name="reconnect"></a>

When the library detects that the connection with the AMQP server is lost, it tries to automatically reconnect to the server.
