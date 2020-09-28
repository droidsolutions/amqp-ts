//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

const args = process.argv.slice(2);

const severity = args[0];
if (!severity) {
  console.log("Usage: receive_logs_topic.js <facility>.<severity>");
  // eslint-disable-next-line no-process-exit
  process.exit(1);
}

// create a new connection (async)
const connection = new amqp.Connection();

// declare a new exchange, it will be created if it does not already exist (async)
const exchange = connection.declareExchange("topic_logs", "topic", {durable: false});

// declare a new queue, it will be created if it does not already exist (async)
const queue = connection.declareQueue("", {exclusive: true});

// connect the queue to the exchange for each key pattern
args.forEach(function(key) {
  queue.bind(exchange, key);
});

// create a consumer function for the queue
// this will keep running until the program is halted or is stopped with queue.stopConsumer()
queue.activateConsumer(function(message) {
  const content = message.content.toString();
  const routingKey = message.fields.routingKey;
  console.log(" [x] " + routingKey + " : '" + content + "'");
}, {rawMessage: true, noAck: true});
