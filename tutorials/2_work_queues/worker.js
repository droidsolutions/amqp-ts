//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

// create a new connection (async)
const connection = new amqp.Connection();

// declare a new queue, it will be created if it does not already exist (async)
const queue = connection.declareQueue("task_queue", {durable: true});

// create a consumer function for the queue
// this will keep running until the program is halted or is stopped with queue.stopConsumer()
queue.activateConsumer(function(message) {
  // fake a second of work for every dot in the message
  const content = message.getContent();
  const seconds = content.split(".").length - 1;
  console.log(" [x] received message: " + content);
  setTimeout(function() {
    console.log(" [x] Done");
    message.ack(); // acknowledge that the message has been received (and processed)
  }, seconds * 1000);
}, {noAck: false});
