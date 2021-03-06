//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

// create a new connection (async)
const connection = new amqp.Connection();

// declare a new exchange, it will be created if it does not already exist (async)
const exchange = connection.declareExchange("logs", "fanout", {durable: false});

// declare a new queue, it will be created if it does not already exist (async)
const queue = connection.declareQueue("", {exclusive: true});

// connect the queue to the exchange
queue.bind(exchange);

// create a consumer function for the queue
// this will keep running until the program is halted or is stopped with queue.stopConsumer()
queue.activateConsumer(function(message) {
  console.log(" [x] " + message.getContent());
});
