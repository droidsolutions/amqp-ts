//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

// create a new connection (async)
const connection = new amqp.Connection();

// declare a new exchange, it will be created if it does not already exist (async)
const exchange = connection.declareExchange("direct_logs", "direct", {durable: false});

// get the severity and message from the command line
const args = process.argv.slice(2);
const message = new amqp.Message(args.slice(1).join(" ") || "Hello World!");
const severity = (args.length > 0) ? args[0] : "info";

// send a message, it will automatically be sent after the connection and the queue declaration
// have finished successfully
exchange.send(message, severity);

// not exactly true, but the message will be sent shortly
console.log(" [x] Sent " + severity + " '" + message.getContent() + "'");

// after half a second close the connection
setTimeout(function() {
  connection.close();
}, 500);
