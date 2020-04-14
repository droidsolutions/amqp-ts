/* eslint-disable no-console */
/**
 * Tests for amqp-ts
 * Created by Ab on 2015-09-16.
 */
import * as AmqpLib from "amqplib";
import * as Chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import { Connection } from "../src/Connection/Connection";
import { Topology } from "../src/Connection/Topology";
import { Message } from "../src/Message";
import { LoggerFactory } from "../src/LoggerFactory";
import * as pino from "pino";

/**
 * Until we get a good mock for amqplib we will test using a local rabbitmq instance
 */
// define test defaults
const expect = Chai.expect;
const ConnectionUrl = process.env.AMQPTEST_CONNECTION_URL || "amqp://localhost";
const UnitTestTimeout = process.env.AMQPTEST_TIMEOUT || 1500;
const LogLevel = process.env.AMQPTEST_LOGLEVEL || "silent";
const testExchangeNamePrefix = process.env.AMQPTEST_EXCHANGE_PREFIX || "TestExchange_";
const testQueueNamePrefix = process.env.AMQPTEST_QUEUE_PREFIX || "TestQueue_";

/* istanbul ignore next */
describe("Test amqp-ts module", function () {
  let loggerFactory: LoggerFactory;
  this.timeout(UnitTestTimeout); // define default timeout

  // create unique queues and exchanges for each test so they do not interfere with each other
  let testExchangeNumber = 0;
  function nextExchangeName(): string {
    testExchangeNumber++;
    return testExchangeNamePrefix + testExchangeNumber;
  }
  let testQueueNumber = 0;
  function nextQueueName(): string {
    testQueueNumber++;
    return testQueueNamePrefix + testQueueNumber;
  }

  // keep track of the created connections for cleanup
  const connections: Connection[] = [];
  function getAmqpConnection() {
    const conn = new Connection(ConnectionUrl, {}, { retries: 5, interval: 1500 }, loggerFactory);
    connections.push(conn);
    return conn;
  }

  // cleanup function for the AMQP connection, also tests the Connection.deleteConfiguration method
  function cleanup(connection, done, error?) {
    connection
      .deleteConfiguration()
      .then(() => {
        return connection.close();
      })
      .then(
        () => {
          done(error);
        },
        (err) => {
          done(err);
        },
      );
  }

  let currentConnection: Connection;
  let callbackResolve: (value?: any) => void;

  before(function () {
    Chai.use(chaiAsPromised);

    if (LogLevel !== "silent") {
      const logger = pino({
        name: "amqp-ts unit-test",
        level: LogLevel,
        formatters: {
          level: (label, _number) => {
            return { level: label };
          },
        },
        // prettyPrint: { ignore: "hostname" },
        redact: [],
        serializers: { err: pino.stdSerializers.err },
      });

      loggerFactory = (context, meta = {}) => {
        const className = typeof context === "string" ? context : context.name;
        meta.context = className;

        return logger.child(meta);
      };
    }
  });

  beforeEach(function () {
    currentConnection = getAmqpConnection();
  });

  afterEach(function () {
    cleanup(currentConnection, () => {});
  });

  // cleanup failed tests
  // unfortunately does still not execute after encountering an error in mocha, perhaps in future versions
  after(function (done) {
    const processAll: Promise<any>[] = [];
    console.log("cleanup phase!");
    for (let i = 0, l = connections.length; i < l; i++) {
      processAll.push(connections[i].deleteConfiguration());
    }
    Promise.all(processAll)
      .then(() => {
        done();
      })
      .catch((err) => {
        done(err);
      });
  });

  describe("AMQP Connection class initialization", function () {
    it("should create a RabbitMQ connection", function (done) {
      // check result
      currentConnection.initialized
        .then(() => {
          // successfully create the AMQP connection
          currentConnection.close().then(() => {
            // successfully close the AMQP connection
            done();
          });
        })
        .catch(() => {
          // failed to create the AMQP connection
          done(new Error("Failed to create a new AMQP Connection."));
        });
    });
  });

  describe("AMQP Deprecated usage tests", function () {
    it("should create a Queue and send and receive simple string messages", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.startConsumer((message) => {
        callbackResolve(message);
      });
      await currentConnection.completeConfiguration();

      queue.publish("Test");
      await expect(testPromise).to.eventually.equal("Test");
    });

    it("should create a Queue and send and receive simple string objects", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testObj = {
        text: "Test",
      };
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.startConsumer((message) => {
        callbackResolve(message);
      });
      await currentConnection.completeConfiguration();
      queue.publish(testObj);
      await expect(testPromise).to.eventually.eql(testObj);
    });

    it("should create a Queue, send a simple string message and receive the raw message", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      const rawConsumer = (message: AmqpLib.Message, channel: AmqpLib.Channel) => {
        callbackResolve(message.content.toString());
        channel.ack(message);
      };

      await queue.startConsumer(rawConsumer, { rawMessage: true });
      await currentConnection.completeConfiguration();
      queue.publish("Test");
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should create a Queue, send a simple string message and receive the raw message 2", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      const rawConsumer = (message: AmqpLib.Message, channel: AmqpLib.Channel) => {
        callbackResolve(message.content.toString());
        channel.ack(message);
      };

      await queue.startConsumer(rawConsumer, { rawMessage: true });
      await currentConnection.completeConfiguration();
      queue.publish("Test");
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should reconnect when sending a message to an Exchange after a broken connection", async function () {
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const exchange2 = currentConnection.declareExchange(nextExchangeName());
      await exchange2.bind(exchange1);
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.bind(exchange1);

      await queue.startConsumer((message) => {
        callbackResolve(message);
      });

      await currentConnection.completeConfiguration();
      // break currentConnection
      await new Promise((resolve, reject) => {
        currentConnection.connection.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
            // it should auto reconnect and send the message
          }
        });
      });

      queue.publish("Test");
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should reconnect when sending a message to a Queue after a broken connection", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.startConsumer((message) => {
        callbackResolve(message);
      });
      await currentConnection.completeConfiguration();

      await new Promise((resolve, reject) => {
        currentConnection.connection.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
            // it should auto reconnect and send the message
          }
        });
      });

      queue.publish("Test");
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should not start 2 consumers for the same queue", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.bind(exchange1);
      await queue.startConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });

      await expect(
        queue.startConsumer((_message) => {
          // cleanup(currentConnection, done, new Error("Received unexpected message"));
        }),
      ).to.be.rejectedWith("amqp-ts Queue.startConsumer error: consumer already defined");
    });

    it("should not start 2 consumers for the same exchange", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await expect(
        exchange1.activateConsumer((_message) => {
          // cleanup(currentConnection, done, new Error("Received unexpected message"));
        }),
      ).to.be.rejectedWith("amqp-ts Exchange.activateConsumer error: consumer already defined");
    });

    it("should stop an Exchange consumer", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await exchange1.stopConsumer();

      // ToDo check if consumer is really stopped
      expect(true).to.equal(true);
    });

    it("should not generate an error when stopping a non existing Exchange consumer", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await exchange1.stopConsumer();
      await expect(exchange1.stopConsumer()).to.eventually.be.undefined;
    });

    it("should not generate an error when stopping a non existing Queue consumer", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.startConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await queue.stopConsumer();
      await expect(queue.stopConsumer()).to.eventually.be.undefined;
    });
  });

  describe("AMQP usage", function () {
    /**
     * normal practice is to test each feature isolated.
     * This is however not very practical in this situation, because we would have to test the same features over and
     * over. We will however try to identify test failures as specific as possible
     */

    it("should create a Queue with specified name", async function () {
      // test code
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();
      expect(queue.name).equals(queueName);
    });

    it("should create an Exchange with specified name and type", async function () {
      // test code
      const exchangeName = nextExchangeName();
      const exchange = currentConnection.declareExchange(exchangeName, "fanout");

      await currentConnection.completeConfiguration();

      expect(exchange.name).equals(exchangeName);
      expect(exchange.type).equals("fanout");
    });

    it("should create a Queue and send and receive a simple text Message", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();

      const msg = new Message("Test");
      queue.send(msg);

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should create a Queue and send and receive a simple text Message with ack", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.activateConsumer((message) => {
        callbackResolve(message.getContent());
        message.ack();
      });

      await currentConnection.completeConfiguration();

      const msg = new Message("Test");
      queue.send(msg);

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should create a Queue and send and receive a simple text Message with nack", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      let nacked = false;
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.activateConsumer((message) => {
        callbackResolve(message.getContent());
        if (nacked) {
          message.ack();
        } else {
          message.nack();
          nacked = true;
        }
      });

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      queue.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should create not resend a nack(false) message", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      let nacked = false;
      const testPromiseNacked = new Promise((resolve) => {
        callbackResolve = resolve;
      });
      let callbackResolveUnnacked: (value?: any) => void;
      const testPromiseUnnacked = new Promise((resolve) => {
        callbackResolveUnnacked = resolve;
      });

      await queue.activateConsumer((message) => {
        if (nacked) {
          message.ack();
          callbackResolve(message.getContent());
        } else {
          callbackResolveUnnacked(message.getContent());
          message.nack(false, false);
          nacked = true;
          const msg = new Message("Test Finished");
          queue.send(msg);
        }
      });

      await currentConnection.completeConfiguration();

      const msg = new Message("Test");
      queue.send(msg);
      await expect(testPromiseUnnacked).to.eventually.equals("Test");
      await expect(testPromiseNacked).to.eventually.equals("Test Finished");
    });

    it("should create a Queue and send and receive a simple text Message with reject", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.activateConsumer((message) => {
        message.reject(false);
        callbackResolve(message.getContent());
      });

      await currentConnection.completeConfiguration();

      const msg = new Message("Test");
      queue.send(msg);

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should create a Queue and send and receive a Message with a structure", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testObj = {
        text: "Test",
      };
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();

      const msg = new Message(testObj);
      queue.send(msg);
      await expect(testPromise).to.eventually.eql(testObj);
    });

    it("should return the same Queue instance after calling connection.declareQueue multiple times", async function () {
      // test code
      const queueName = nextQueueName();
      const queue1 = currentConnection.declareQueue(queueName);
      const queue2 = currentConnection.declareQueue(queueName);

      expect(queue1).equal(queue2);

      await currentConnection.completeConfiguration();
    });

    // eslint-disable-next-line max-len
    it("should return the same Exchange instance after calling connection.declareExchange multiple times", async function () {
      // test code
      const exchangeName = nextExchangeName();
      currentConnection.declareQueue(exchangeName);
      const exchange2 = currentConnection.declareQueue(exchangeName);

      expect(exchange2).equal(exchange2);

      await currentConnection.completeConfiguration();
    });

    it("should create an Exchange, Queue and binding and send and receive a simple string Message", async function () {
      // test code
      const exchange = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });
      await queue.bind(exchange);
      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      exchange.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    // eslint-disable-next-line max-len
    it("should create an Exchange, Queue and binding and send and receive a Message with structures", async function () {
      // test code
      const exchange = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());
      const testObj = {
        text: "Test",
      };
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await queue.bind(exchange);
      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();

      const msg = new Message(testObj);
      exchange.send(msg);
      await expect(testPromise).to.eventually.eql(testObj);
    });

    it("should create an Exchange and send and receive a simple string Message", async function () {
      // test code
      const exchange = currentConnection.declareExchange(nextExchangeName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await exchange.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      exchange.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should bind Exchanges", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const exchange2 = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await exchange2.bind(exchange1);
      await queue.bind(exchange2);
      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      exchange1.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should reconnect when sending a Message to an Exchange after a broken connection", async function () {
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const exchange2 = currentConnection.declareExchange(nextExchangeName());
      await exchange2.bind(exchange1);
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.bind(exchange2);
      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();

      await new Promise((resolve, reject) => {
        currentConnection.connection.close((err) => {
          if (err) {
            reject(err);
          } else {
            // it should auto reconnect and send the message
            const msg = new Message("Test");
            exchange1.send(msg);
            resolve();
          }
        });
      });

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should reconnect when sending a message to a Queue after a broken connection", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });
      queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();

      await new Promise((resolve, reject) => {
        // break connection
        currentConnection.connection.close((err) => {
          if (err) {
            reject(err);
          } else {
            // it should auto reconnect and send the message
            const msg = new Message("Test");
            queue.send(msg);
            resolve();
          }
        });
      });

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should unbind Exchanges and Queues", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const exchange2 = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await exchange2.bind(exchange1);
      await queue.bind(exchange2);
      await queue.activateConsumer(
        async (message) => {
          await exchange2.unbind(exchange1);
          await queue.unbind(exchange2);
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      queue.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should delete Exchanges and Queues", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const exchange2 = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await exchange2.bind(exchange1);
      await queue.bind(exchange2);
      await queue.activateConsumer(
        async (message) => {
          await exchange2.delete();
          await queue.delete();
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await currentConnection.completeConfiguration();
      const msg = new Message("Test");
      queue.send(msg);

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should not start 2 consumers for the same queue", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.bind(exchange1);
      await queue.activateConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await expect(
        queue.activateConsumer(
          (_message) => {
            // cleanup(currentConnection, done, new Error("Received unexpected message"));
          },
          { noAck: true },
        ),
      ).to.be.rejectedWith("amqp-ts Queue.activateConsumer error: consumer already defined");
    });

    it("should not start 2 consumers for the same exchange", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer((_message) => {
        // cleanup(currentConnection, done, new Error("Received unexpected message"));
      });
      await expect(
        exchange1.activateConsumer(
          (_message) => {
            // cleanup(currentConnection, done, new Error("Received unexpected message"));
          },
          { noAck: true },
        ),
      ).to.be.rejectedWith("amqp-ts Exchange.activateConsumer error: consumer already defined");
    });

    it("should stop an Exchange consumer", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer(
        (_message) => {
          // cleanup(currentConnection, done, new Error("Received unexpected message"));
        },
        { noAck: true },
      );
      await exchange1.stopConsumer();
      // ToDo expect that exchange consumer is actually stopped
    });

    it("should not generate an error when stopping a non existing Exchange consumer", async function () {
      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName());

      await exchange1.activateConsumer(
        (_message) => {
          // cleanup(currentConnection, done, new Error("Received unexpected message"));
        },
        { noAck: true },
      );
      await exchange1.stopConsumer();
      await exchange1.stopConsumer();
      // second stop did not throw any error
      expect(true).to.equal(true);
    });

    it("should not generate an error when stopping a non existing Queue consumer", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.activateConsumer(
        (_message) => {
          // cleanup(currentConnection, done, new Error("Received unexpected message"));
        },
        { noAck: true },
      );
      await queue.stopConsumer();
      await queue.stopConsumer();
      // second stop did not throw any error
      expect(true).to.equal(true);
    });

    it("should send a message to a queue before the queue is explicitely initialized", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());
      const msg = new Message("Test");
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      queue.send(msg);

      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should accept optional parameters", async function () {
      let messagesReceived = 0;
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      // test code
      const exchange1 = currentConnection.declareExchange(nextExchangeName(), "topic", { durable: true });
      const exchange2 = currentConnection.declareExchange(nextExchangeName(), "topic", { durable: true });
      const queue = currentConnection.declareQueue(nextQueueName(), { durable: true });
      queue.bind(exchange1, "*.*", {});
      await exchange1.bind(exchange2, "*.test", {});

      await currentConnection.completeConfiguration();
      const msg = new Message("ParameterTest", {});
      exchange2.send(msg, "topic.test");
      exchange1.send(msg, "topic.test2");
      queue.send(msg);

      await queue.activateConsumer(
        (message) => {
          messagesReceived++;
          //expect three messages
          if (messagesReceived === 3) {
            callbackResolve(message.getContent());
          }
        },
        { noAck: true },
      );

      await expect(testPromise).to.eventually.equals("ParameterTest");
      expect(messagesReceived).to.equal(3);
    });

    it("should close an exchange and a queue", async function () {
      // test code
      const exchangeName = nextExchangeName();
      const queueName = nextQueueName();

      let exchange = currentConnection.declareExchange(exchangeName);
      let queue = currentConnection.declareQueue(queueName);
      await queue.bind(exchange);

      await currentConnection.completeConfiguration();
      exchange.publish("InQueueTest");
      await exchange.close();
      await queue.close();

      queue = currentConnection.declareQueue(queueName);
      await queue.initialized;

      exchange = currentConnection.declareExchange(exchangeName);
      const result = await queue.initialized;

      expect(result.messageCount).equals(1);
    });

    it("should delete an exchange and a queue", async function () {
      // test code
      const exchangeName = nextExchangeName();
      const queueName = nextQueueName();

      const exchange = currentConnection.declareExchange(exchangeName);
      let queue = currentConnection.declareQueue(queueName);
      await queue.bind(exchange);

      await currentConnection.completeConfiguration();
      exchange.publish("InQueueTest");
      await exchange.delete();
      await queue.delete();
      queue = currentConnection.declareQueue(queueName);
      const result = await queue.initialized;

      expect(result.messageCount).equals(0);
    });

    it("should process a queue rpc", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.activateConsumer((message) => {
        return message.getContent().reply;
      });

      await currentConnection.completeConfiguration();

      const result = await queue.rpc({ reply: "TestRpc" });

      expect(result.getContent()).equals("TestRpc");
    });

    it("should process an unresolved queue rpc, consumer returning Message", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.activateConsumer((message) => {
        return new Message(message.getContent().reply);
      });

      const result = await queue.rpc({ reply: "TestRpc" });

      expect(result.getContent()).equals("TestRpc");
    });

    it("should process a queue rpc, consumer returning Promise", async function () {
      // test code
      const queue = currentConnection.declareQueue(nextQueueName());

      await queue.activateConsumer((message) => {
        return new Promise((resolve, _reject) => {
          setTimeout(() => {
            resolve(message.getContent().reply);
          }, 10);
        });
      });

      await currentConnection.completeConfiguration();
      const result = await queue.rpc({ reply: "TestRpc" });

      expect(result.getContent()).equals("TestRpc");
    });

    // skip until we know why it is hanging
    it("should process an exchange rpc", async function () {
      // test code
      const exchange = currentConnection.declareExchange(nextExchangeName());

      await exchange.activateConsumer((message) => {
        return message.getContent().reply;
      });

      await currentConnection.completeConfiguration();
      const result = await exchange.rpc({ reply: "TestRpc" });

      expect(result.getContent()).equals("TestRpc");
    });

    it("should create a topology and send and receive a Message", async function () {
      // test code
      const exchangeName1 = nextExchangeName();
      const exchangeName2 = nextExchangeName();
      const queueName1 = nextQueueName();
      const topology: Topology = {
        exchanges: [{ name: exchangeName1 }, { name: exchangeName2 }],
        queues: [{ name: queueName1 }],
        bindings: [
          { source: exchangeName1, exchange: exchangeName2 },
          { source: exchangeName2, queue: queueName1 },
        ],
      };
      const testPromise = new Promise((resolve) => {
        callbackResolve = resolve;
      });

      await currentConnection.declareTopology(topology);

      const queue = currentConnection.declareQueue(queueName1);
      await queue.activateConsumer(
        (message) => {
          callbackResolve(message.getContent());
        },
        { noAck: true },
      );

      const exchange = currentConnection.declareExchange(exchangeName1);
      const msg = new Message("Test");
      exchange.send(msg);
      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should close a queue multiple times without generating errors", async function () {
      // test code
      const queueName = nextQueueName();
      let queue = currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();

      await queue.close();
      await queue.close();
      // redeclare queue for correct cleanup
      queue = currentConnection.declareQueue(queueName);
      await queue.initialized;
    });

    it("should delete a queue multiple times without generating errors", async function () {
      // test code
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();

      await queue.delete();
      await queue.delete();
    });

    it("should close an exchange multiple times without generating errors", async function () {
      // test code
      const exchangeName = nextExchangeName();
      let exchange = currentConnection.declareExchange(exchangeName);

      await currentConnection.completeConfiguration();

      await exchange.close();
      await exchange.close();

      // redeclare exchange for correct cleanup
      exchange = currentConnection.declareExchange(exchangeName);
      await exchange.initialized;
    });

    it("should delete an exchange multiple times without generating errors", async function () {
      // test code
      const exchangeName = nextExchangeName();
      const exchange = currentConnection.declareExchange(exchangeName);

      await currentConnection.completeConfiguration();
      await exchange.delete();
      await exchange.delete();
    });

    it("should set a prefetch count to a queue", async function () {
      // test code
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();
      // todo: create a ral test that checks if the function works
      queue.prefetch(3);
    });

    it("should recover to a queue", async function () {
      // test code
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();

      // todo: create a real test that checks if the function works
      await queue.recover();
    });

    it("should not connect to a nonexisiting queue with 'noCreate: true'", async function () {
      // test code
      const queueName = nextQueueName();
      currentConnection.declareQueue(queueName, { noCreate: true });

      await expect(currentConnection.completeConfiguration()).to.be.rejectedWith("NOT-FOUND");
    });

    it("should connect to an exisiting queue with 'noCreate: true'", async function () {
      // test code
      const queueName = nextQueueName();
      currentConnection.declareQueue(queueName);

      await currentConnection.completeConfiguration();
      const queue = currentConnection.declareQueue(queueName, { noCreate: true });
      await queue.initialized;
    });

    it("should not connect to a nonexisiting exchange with 'noCreate: true'", async function () {
      // test code
      const exchangeName = nextExchangeName();
      currentConnection.declareExchange(exchangeName, "", { noCreate: true });

      await expect(currentConnection.completeConfiguration()).to.be.rejectedWith("NOT-FOUND");
    });

    it("should connect to an exisiting exchange with 'noCreate: true'", async function () {
      const exchangeName = nextExchangeName();
      const con = await AmqpLib.connect(ConnectionUrl);

      const ch = await con.createChannel();
      await ch.assertExchange(exchangeName, "fanout");

      const exchange = currentConnection.declareExchange(exchangeName, "", { noCreate: true });
      await exchange.initialized;
      await con.close();
    });
  });
});
