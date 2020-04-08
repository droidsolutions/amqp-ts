//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

const args = process.argv.slice(2);

const severity = args[0];
if (!severity) {
  console.log("Usage: receive_logs_direct.js [info] [warning] [error]");
  process.exit(1);
}

// create a new connection (async)
const connection = new amqp.Connection();

// declare a new exchange, it will be created if it does not already exist (async)
const exchange = connection.declareExchange("direct_logs", "direct", {durable: false});

// declare a new queue, it will be created if it does not already exist (async)
const queue = connection.declareQueue("", {exclusive: true});

// connect the queue to the exchange for each severity
args.forEach(function(severity) {
  queue.bind(exchange, severity);
});

// create a consumer function for the queue
// this will keep running until the program is halted or is stopped with queue.stopConsumer()
queue.activateConsumer(function(message) {
  const content = message.content.toString();
  const routingKey = message.fields.routingKey;
  console.log(" [x] " + routingKey + " : '" + content + "'");
}, {rawMessage: true, noAck: true});
