//const amqp = require("amqp-ts"); // normal use
const amqp = require("../../lib/amqp-ts"); // for use inside this package

// create a new connection (async)
const connection = new amqp.Connection();

// declare the rpc_queue queue, it will be created if it does not already exist (async)
const queue = connection.declareQueue("rpc_queue", {durable: false});

// get the number for fibonacci from the command line
const args = process.argv.slice(2);
const num = parseInt(args[0]);

console.log(" [x] Requesting fib(%d)", num);

// easy optimized rpc for RabbitMQ
// send a rpc request, it will automatically be sent after the the queue declaration
// has finished successfully
queue.rpc(num).then(function(result) {
  console.log(" [.] Got ", result.getContent());
});

// or use the method explained in the tutorial
// todo: write the code!


// after half a second close the connection
setTimeout(function() {
  connection.close();
}, 500);
