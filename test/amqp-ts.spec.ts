/**
 * Tests for amqp-ts
 * Created by Ab on 2015-09-16.
 */
import * as AmqpLib from "amqplib";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { once } from "node:events";
import { pino } from "pino";
import type { Binding } from "../src/Binding.js";
import { Connection } from "../src/Connection/Connection.js";
import { Topology } from "../src/Connection/Topology.js";
import { LoggerFactory, SimpleLogger } from "../src/LoggerFactory.js";
import { Exchange } from "../src/Exchange/Exchange.js";
import { Message } from "../src/Message.js";
import { Queue } from "../src/Queue/Queue.js";
import { killConnections, uniqueConnectionName, waitForConsumerTags } from "./helpers/broker.js";

/**
 * Until we get a good mock for amqplib we will test using a local rabbitmq instance
 */
// define test defaults
const ConnectionUrl = process.env.AMQPTEST_CONNECTION_URL || "amqp://localhost";
const UnitTestTimeout = process.env.AMQPTEST_TIMEOUT || 1500;
const ReconnectTimeout = Number(process.env.AMQPTEST_RECONNECT_TIMEOUT || 20000);
const LogLevel = process.env.AMQPTEST_LOGLEVEL || "silent";
const testExchangeNamePrefix = process.env.AMQPTEST_EXCHANGE_PREFIX || "TestExchange_";
const testQueueNamePrefix = process.env.AMQPTEST_QUEUE_PREFIX || "TestQueue_";
const CleanupTimeout = 5000;

/* istanbul ignore next */
describe("Test amqp-ts module", function () {
  let loggerFactory: LoggerFactory;
  this.timeout(UnitTestTimeout); // define default timeout

  // create unique queues and exchanges for each test so they do not interfere with each other
  let testExchangeNumber = 0;
  function nextExchangeName(): string {
    testExchangeNumber++;
    return testExchangeNamePrefix + testExchangeNumber.toString();
  }
  let testQueueNumber = 0;
  function nextQueueName(): string {
    testQueueNumber++;
    return testQueueNamePrefix + testQueueNumber.toString();
  }

  let currentConnectionName: string;
  function getAmqpConnection() {
    // name the connection on the broker so tests can kill it through the management API
    currentConnectionName = uniqueConnectionName();
    const conn = new Connection(
      ConnectionUrl,
      { clientProperties: { connection_name: currentConnectionName } },
      { maxRetries: 5, initialDelay: 100 },
      loggerFactory,
    );
    return conn;
  }

  /** Rejects after `ms`, so a step that hangs cannot keep mocha alive. The timer does not keep the process alive. */
  function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms).unref();
      }),
    ]);
  }

  // cleanup function for the AMQP connection, also tests the Connection.deleteConfiguration method. The connection is
  // closed even when deleting the topology fails or hangs, so a failing test cannot keep mocha alive.
  async function cleanup(connection: Connection): Promise<void> {
    try {
      await within(connection.deleteConfiguration(), CleanupTimeout, "deleteConfiguration");
    } finally {
      await within(connection.close(), CleanupTimeout, "close");
    }
  }

  let currentConnection: Connection;
  let callbackResolve: (value?: any) => void;

  before(function () {
    use(chaiAsPromised);

    if (LogLevel !== "silent") {
      const logger = pino({
        name: "amqp-ts unit-test",
        level: LogLevel,
        formatters: {
          level: (label, _number): Record<string, unknown> => {
            return { level: label };
          },
        },
        transport: { target: "pino-pretty", options: { ignore: "hostname" } },
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

  afterEach(async function () {
    this.timeout(3 * CleanupTimeout);
    // a test may leave its topology in a state that cannot be deleted any more, which must not fail the next test
    await cleanup(currentConnection).catch(() => {});
  });

  function nextMessage(
    queue: Queue,
    options: AmqpLib.Options.Consume = { noAck: true },
    onMessage?: (message: Message) => void,
  ) {
    const received: string[] = [];
    let notify: (() => void) | undefined;
    const consumer = queue.activateConsumer((message: Message) => {
      received.push(message.getContent() as string);
      onMessage?.(message);
      notify?.();
    }, options);
    const waitFor = async (content: string): Promise<void> => {
      while (!received.includes(content)) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    };

    return { consumer, waitFor, received };
  }

  /** Waits until `current()` no longer returns `previous`, i.e. the entity started re-initializing. */
  async function replaced(current: () => Promise<unknown>, previous: Promise<unknown>, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (current() === previous) {
      if (Date.now() > deadline) {
        throw new Error("the entity was never re-initialized");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await current();
  }

  /** Deletes an exchange or a queue behind the library's back, through a separate connection. */
  async function deleteOnBroker(kind: "exchange" | "queue", name: string) {
    const raw = await AmqpLib.connect(ConnectionUrl);
    try {
      const rawChannel = await raw.createChannel();
      rawChannel.on("error", () => {});
      if (kind === "exchange") {
        await rawChannel.deleteExchange(name);
      } else {
        await rawChannel.deleteQueue(name);
      }
    } finally {
      await raw.close();
    }
  }

  /** Creates an exchange or a queue behind the library's back, so it can be declared with `noCreate`. */
  async function createOnBroker(kind: "exchange" | "queue", name: string) {
    const raw = await AmqpLib.connect(ConnectionUrl);
    try {
      const rawChannel = await raw.createChannel();
      if (kind === "exchange") {
        await rawChannel.assertExchange(name, "fanout");
      } else {
        await rawChannel.assertQueue(name);
      }
    } finally {
      await raw.close();
    }
  }

  /** A logger factory whose loggers record level and message template of every entry. */
  function recordingLoggerFactory() {
    const entries: { level: string; msg: string; args: unknown[] }[] = [];
    const record =
      (level: string) =>
      (objOrMsg: Record<string, unknown> | string, ...rest: unknown[]): void => {
        if (typeof objOrMsg === "string") {
          entries.push({ level, msg: objOrMsg, args: rest });
        } else {
          const [msg = "", ...args] = rest;
          entries.push({ level, msg: typeof msg === "string" ? msg : "", args });
        }
      };
    const logger: SimpleLogger = {
      trace: record("trace"),
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      fatal: record("fatal"),
    };
    const factory: LoggerFactory = () => logger;

    return { factory, entries };
  }

  /** Collects unhandled rejections until the returned function is called, which removes the listener again. */
  function collectUnhandledRejections() {
    const reasons: unknown[] = [];
    const listener = (reason: unknown): void => {
      reasons.push(reason);
    };
    process.on("unhandledRejection", listener);

    return {
      reasons,
      stop: () => {
        process.off("unhandledRejection", listener);
      },
    };
  }

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

    it("accepts amqplib RecoveryOptions", async function () {
      const connection = new Connection("amqp://localhost:1", {}, { maxRetries: 0, initialDelay: 10 }, loggerFactory);
      let errors = 0;
      connection.on("error_connection", () => {
        errors++;
      });

      await expect(connection.initialized).to.be.rejected;
      // leave room for a duplicate event before counting
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(errors).to.equal(1);
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
      const queue = currentConnection.declareQueue(nextQueueName());
      let nacked = false;

      let callbackResolveAcked: (value?: any) => void;
      const testPromiseAcked = new Promise((resolve) => {
        callbackResolveAcked = resolve;
      });
      let callbackResolveNacked: (value?: any) => void;
      const testPromiseNacked = new Promise((resolve2) => {
        callbackResolveNacked = resolve2;
      });

      await queue.activateConsumer((message: Message) => {
        const content = message.getContent();
        if (nacked) {
          // expect(content).to.equal("Test Finished", "Content of acked message inside message handler does not
          // match");
          message.ack();
          callbackResolveAcked(content);
        } else {
          // expect(content).to.equal("Test", "Content of nacked message inside message handler does not match");
          callbackResolveNacked(content);
          message.nack(false, false);
          nacked = true;
          const msg = new Message("Test Finished");
          queue.send(msg);
        }
      });

      await currentConnection.completeConfiguration();

      const msg = new Message("Test");
      queue.send(msg);

      const nackedContent = await testPromiseNacked;
      expect(nackedContent).to.equal("Test");
      const ackedContent = await testPromiseAcked;
      expect(ackedContent).to.equal("Test Finished");
    });

    it("should create a Queue and send and receive a simple text Message with reject", async function () {
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
      this.timeout(ReconnectTimeout);
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

      // break the connection, it should auto reconnect and send the message
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      exchange1.send(new Message("Test"));

      await expect(testPromise).to.eventually.equals("Test");
    });

    it("should reconnect when sending a message to a Queue after a broken connection", async function () {
      this.timeout(ReconnectTimeout);
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

      // break the connection, it should auto reconnect and send the message
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      queue.send(new Message("Test"));

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

      const exchange = currentConnection.declareExchange(exchangeName);
      let queue = currentConnection.declareQueue(queueName);
      await queue.bind(exchange);

      await currentConnection.completeConfiguration();
      // exchange.publish("InQueueTest");
      exchange.send(new Message("InQueueTest"));
      await exchange.close();
      await queue.close();

      queue = currentConnection.declareQueue(queueName);
      await queue.initialized;

      currentConnection.declareExchange(exchangeName);
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
      // exchange.publish("InQueueTest");
      exchange.send(new Message("InQueueTest"));
      await exchange.delete();
      await queue.delete();
      queue = currentConnection.declareQueue(queueName);
      const result = await queue.initialized;

      expect(result.messageCount).equals(0);
    });

    /** Declares a reply queue and resolves with the first message it receives. */
    async function replyTo(): Promise<{ name: string; reply: Promise<Message> }> {
      const replyQueue = currentConnection.declareQueue(nextQueueName());
      const reply = new Promise<Message>((resolve) => {
        void replyQueue.activateConsumer(
          (message: Message) => {
            resolve(message);
          },
          { noAck: true },
        );
      });
      await replyQueue.initialized;
      return { name: replyQueue.name, reply };
    }

    it("should reply automatically with a plain value from the consumer", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.activateConsumer((message: Message) => {
        return (message.getContent() as Record<string, unknown>).reply;
      });
      const { name, reply } = await replyTo();
      await currentConnection.completeConfiguration();

      queue.send(new Message({ reply: "TestRpc" }, { replyTo: name, correlationId: "plain-1" }));
      const result = await reply;

      expect(result.getContent()).equals("TestRpc");
      expect(result.properties.correlationId).equals("plain-1");
    });

    it("should reply automatically with a Message returned by the consumer", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.activateConsumer((message: Message) => {
        return new Message((message.getContent() as Record<string, unknown>).reply);
      });
      const { name, reply } = await replyTo();
      await currentConnection.completeConfiguration();

      queue.send(new Message({ reply: "TestRpc" }, { replyTo: name, correlationId: "message-1" }));
      const result = await reply;

      expect(result.getContent()).equals("TestRpc");
      expect(result.properties.correlationId).equals("message-1");
    });

    it("should reply automatically with the value a consumer's Promise resolves to", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.activateConsumer((message: Message) => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve((message.getContent() as Record<string, unknown>).reply);
          }, 10);
        });
      });
      const { name, reply } = await replyTo();
      await currentConnection.completeConfiguration();

      queue.send(new Message({ reply: "TestRpc" }, { replyTo: name, correlationId: "promise-1" }));
      const result = await reply;

      expect(result.getContent()).equals("TestRpc");
      expect(result.properties.correlationId).equals("promise-1");
    });

    it("should reply automatically for a consumer on an exchange", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName());
      await exchange.activateConsumer((message: Message) => {
        return (message.getContent() as Record<string, unknown>).reply;
      });
      const { name, reply } = await replyTo();
      await currentConnection.completeConfiguration();

      exchange.send(new Message({ reply: "TestRpc" }, { replyTo: name, correlationId: "exchange-1" }));
      const result = await reply;

      expect(result.getContent()).equals("TestRpc");
      expect(result.properties.correlationId).equals("exchange-1");
    });

    it("exposes no rpc method", function () {
      expect("rpc" in Exchange.prototype).to.equal(false);
      expect("rpc" in Queue.prototype).to.equal(false);
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
      // todo: create a real test that checks if the function works
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
      currentConnection.declareExchange(exchangeName, undefined, { noCreate: true });

      await expect(currentConnection.completeConfiguration()).to.be.rejectedWith("NOT-FOUND");
    });

    it("should connect to an exisiting exchange with 'noCreate: true'", async function () {
      const exchangeName = nextExchangeName();
      const con = await AmqpLib.connect(ConnectionUrl);

      const ch = await con.createChannel();
      await ch.assertExchange(exchangeName, "fanout");

      const exchange = currentConnection.declareExchange(exchangeName, undefined, { noCreate: true });
      await exchange.initialized;
      await con.close();
    });
  });

  describe("reconnect behaviour", function () {
    this.timeout(ReconnectTimeout);

    it("consumer resumes after the broker kills the connection", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      const reestablished = once(currentConnection, "re_established_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      await reestablished;

      queue.send(new Message("after-kill"));
      await waitFor("after-kill");
    });

    it("message sent while disconnected is delivered after recovery", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      let reestablished = false;
      currentConnection.once("re_established_connection", () => {
        reestablished = true;
      });
      const lost = once(currentConnection, "lost_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      // the client has seen the close, but the connection is not back yet
      await lost;
      expect(reestablished, "connection must still be down when sending").to.equal(false);
      queue.send(new Message("while-disconnected"));
      await waitFor("while-disconnected");
    });

    it("rebuilds exchange to exchange to queue topology after a kill", async function () {
      // the broker removes all of it with the connection: the exclusive queue goes with its connection, then each
      // autoDelete exchange with its last binding, so only a rebuild can route the message
      const exchange1 = currentConnection.declareExchange(nextExchangeName(), "fanout", { autoDelete: true });
      const exchange2 = currentConnection.declareExchange(nextExchangeName(), "fanout", { autoDelete: true });
      const queue = currentConnection.declareQueue(nextQueueName(), { exclusive: true });
      await exchange2.bind(exchange1);
      await queue.bind(exchange2);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      const reestablished = once(currentConnection, "re_established_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      await reestablished;

      exchange1.send(new Message("through-topology"));
      await waitFor("through-topology");
    });

    it("emits lost_connection before re_established_connection", async function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      await currentConnection.completeConfiguration();

      const events: string[] = [];
      currentConnection.on("lost_connection", () => events.push("lost_connection"));
      currentConnection.on("re_established_connection", () => events.push("re_established_connection"));
      const reestablished = once(currentConnection, "re_established_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      await reestablished;

      expect(events).to.eql(["lost_connection", "re_established_connection"]);
      await queue.initialized;
    });

    it("consumer resumes after its channel is closed by a double ack", async function () {
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      let first = true;
      const { consumer, waitFor } = nextMessage(queue, { noAck: false }, (message) => {
        message.ack();
        if (first) {
          first = false;
          // acking the same delivery twice makes the broker close this channel with 406 PRECONDITION_FAILED
          message.ack();
        }
      });
      await consumer;
      await currentConnection.completeConfiguration();

      const tagsBefore = await waitForConsumerTags(queueName, (tags) => tags.length > 0);

      queue.send(new Message("first"));
      await waitFor("first");

      // the consumer is re-registered under a new tag only if its channel was closed and recovered
      await waitForConsumerTags(queueName, (tags) => tags.length > 0 && tags.every((t) => !tagsBefore.includes(t)));

      queue.send(new Message("second"));
      await waitFor("second");
    });

    it("getConnection returns the current model and changes after a kill", async function () {
      await currentConnection.initialized;
      const before = currentConnection.getConnection;
      // a promise-API ChannelModel: createChannel returns a promise
      const opening = before.createChannel();
      expect(opening).to.be.instanceOf(Promise);
      await (await opening).close();

      const reestablished = once(currentConnection, "re_established_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      await reestablished;

      const after = currentConnection.getConnection;
      expect(after).to.not.equal(undefined);
      expect(after).to.not.equal(before);
    });

    it("declares an entity created while disconnected after the next connect", async function () {
      await currentConnection.initialized;
      const queueName = nextQueueName();

      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      const queue = currentConnection.declareQueue(queueName);

      const result = await queue.initialized;
      expect(result.queue).to.equal(queueName);
    });

    it("survives a channel error event without a user listener", async function () {
      const exchangeName = nextExchangeName();
      const exchange = currentConnection.declareExchange(exchangeName, "fanout");
      await exchange.initialized;

      const raw = await AmqpLib.connect(ConnectionUrl);
      try {
        const rawChannel = await raw.createChannel();
        rawChannel.on("error", () => {});
        await rawChannel.deleteExchange(exchangeName);

        // publishing to the deleted exchange makes the broker close the exchange's channel with 404; an "error"
        // event without a listener would be an uncaught exception, which fails this test
        const first = exchange.initialized;
        const model = currentConnection.getConnection;
        exchange.send(new Message("into the void"));

        const deadline = Date.now() + 10_000;
        while (exchange.initialized === first) {
          if (Date.now() > deadline) {
            throw new Error("the exchange was never re-initialized after its channel closed");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await exchange.initialized;

        // the re-initialization declared the exchange again, on the same connection
        await rawChannel.checkExchange(exchangeName);
        expect(currentConnection.getConnection, "no reconnect of the whole connection").to.equal(model);
      } finally {
        await raw.close();
      }
    });

    it("restores the bindings of an exchange that is declared again after a broker-side delete", async function () {
      const exchangeName = nextExchangeName();
      const exchange = currentConnection.declareExchange(exchangeName, "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.bind(exchange);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      await deleteOnBroker("exchange", exchangeName);
      // this one hits the 404 that closes the exchange's channel and is lost, as in 3.x
      const first = exchange.initialized;
      exchange.send(new Message("into the void"));
      await replaced(() => exchange.initialized, first);

      exchange.send(new Message("after-redeclare"));
      await waitFor("after-redeclare");
    });

    it("consumer resumes after its queue is deleted on the broker", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      await queue.bind(exchange);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // the broker cancels the consumer, which must re-declare the queue, its binding and the consumer
      const first = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, first);

      exchange.send(new Message("after-queue-delete"));
      await waitFor("after-queue-delete");
    });

    it("keeps a binding whose other end is gone during a re-bind and restores it later", async function () {
      // the broker deletes an autoDelete exchange together with the last queue bound to it
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout", { autoDelete: true });
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      await queue.bind(exchange);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // the queue re-initializes after the consumer cancel, but cannot re-bind: the exchange is gone as well
      const firstQueue = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, firstQueue);

      // this one hits the 404 that makes the exchange re-initialize, which re-binds
      const firstExchange = exchange.initialized;
      exchange.send(new Message("into the void"));
      await replaced(() => exchange.initialized, firstExchange);

      exchange.send(new Message("after-both-deleted"));
      await waitFor("after-both-deleted");
    });

    it("fails a noCreate queue whose consumer is cancelled because the queue is gone", async function () {
      const queueName = nextQueueName();
      const raw = await AmqpLib.connect(ConnectionUrl);
      try {
        await (await raw.createChannel()).assertQueue(queueName);
      } finally {
        await raw.close();
      }
      const queue = currentConnection.declareQueue(queueName, { noCreate: true });
      const model = currentConnection.getConnection;
      const { consumer } = nextMessage(queue);
      await consumer;

      const first = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await expect(replaced(() => queue.initialized, first)).to.be.rejectedWith("NOT-FOUND");
      expect(currentConnection._queues[queueName], "the failed queue is no longer declared").to.equal(undefined);
      expect(currentConnection.getConnection, "no reconnect of the whole connection").to.equal(model);
    });

    it("does not re-initialize again on a cancel right after the consumer was registered again", async function () {
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      const { consumer } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      const errors: Error[] = [];
      currentConnection.on("error_connection", (err: Error) => errors.push(err));
      const raw = await AmqpLib.connect(ConnectionUrl);
      try {
        const rawChannel = await raw.createChannel();
        rawChannel.on("error", () => {});

        const first = queue.initialized;
        await rawChannel.deleteQueue(queueName);
        await replaced(() => queue.initialized, first);
        await queue._consumerInitialized;
        expect(errors, "a cancel that is recovered is not reported").to.eql([]);

        // a second cancel within the loop window is left to the next reconnect
        const recovered = queue.initialized;
        await rawChannel.deleteQueue(queueName);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(queue.initialized, "no second re-initialization").to.equal(recovered);
        // the consumer is gone until then, which must not go unnoticed
        expect(errors, "one error_connection for the lost consumer").to.have.length(1);
        expect(errors[0].message).to.contain(queueName);
      } finally {
        await raw.close();
      }
    });

    it("isolates a failing entity during setup", async function () {
      const failingName = nextQueueName();
      await createOnBroker("queue", failingName);
      const failing = currentConnection.declareQueue(failingName, { noCreate: true });
      const healthy = currentConnection.declareQueue(nextQueueName());
      const { consumer, waitFor } = nextMessage(healthy);
      await consumer;
      await currentConnection.completeConfiguration();

      const errors: Error[] = [];
      currentConnection.on("error_connection", (err: Error) => errors.push(err));
      let lost = 0;
      currentConnection.on("lost_connection", () => lost++);
      await deleteOnBroker("queue", failingName);
      const reestablished = once(currentConnection, "re_established_connection");
      expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
      await reestablished;
      let retries = 0;
      currentConnection.on("trying_connect", () => retries++);

      expect(errors, "one error_connection for the failing queue").to.have.length(1);
      expect(errors[0].message).to.contain("404");
      await expect(failing.initialized).to.be.rejectedWith("NOT-FOUND");

      healthy.send(new Message("after-setup-failure"));
      await waitFor("after-setup-failure");

      // a setup that threw for the failing queue would reconnect again and again
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(lost, "no reconnect loop").to.equal(1);
      expect(retries, "no failed setup that is retried").to.equal(0);
    });

    it("drops buffered sends when recovery gives up", async function () {
      const { factory, entries } = recordingLoggerFactory();
      const connection = new Connection("amqp://localhost:1", {}, { maxRetries: 1, initialDelay: 10 }, factory);
      try {
        const queue = connection.declareQueue(nextQueueName());
        const failed = once(connection, "error_connection");
        expect(() => queue.send(new Message("x"))).to.not.throw();
        await failed;

        // the send is dropped once the queue's initialized rejects, give it a moment
        await new Promise((resolve) => setTimeout(resolve, 100));
        const dropped = entries.filter((entry) => entry.level === "warn" && entry.msg.startsWith("Dropping message"));
        expect(dropped, "one warn entry for the dropped message").to.have.length(1);
        // the give-up error can be an AggregateError without a message of its own
        const reason = dropped[0].args[1];
        expect(reason, "the reason for dropping it").to.be.a("string").and.not.equal("");
      } finally {
        await connection.close();
      }
    });

    it("close during a scheduled reconnect stops recovery", async function () {
      const connection = new Connection("amqp://localhost:1", {}, {}, loggerFactory);
      let closed = 0;
      connection.on("close_connection", () => closed++);
      await once(connection, "trying_connect");

      let trying = 0;
      connection.on("trying_connect", () => trying++);
      await connection.close();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(closed, "a single close_connection").to.equal(1);
      expect(trying, "no further trying_connect").to.equal(0);
    });

    it("does not crash on unhandled rejections when recovery gives up", async function () {
      const unhandled = collectUnhandledRejections();
      const connection = new Connection("amqp://localhost:1", {}, { maxRetries: 1, initialDelay: 10 }, loggerFactory);
      try {
        // nobody awaits any of these
        const exchange = connection.declareExchange(nextExchangeName(), "fanout");
        const queue = connection.declareQueue(nextQueueName());
        void queue.bind(exchange);
        void queue.activateConsumer(() => {});
        queue.prefetch(1);
        queue.send(new Message("to the queue"));
        exchange.send(new Message("to the exchange"));
        const pending: Promise<unknown>[] = [
          connection.initialized,
          exchange.initialized,
          queue.initialized,
          queue._consumerInitialized,
          ...Object.values(connection._bindings).map((binding) => binding.initialized),
        ];

        const [failure] = (await once(connection, "error_connection")) as [Error];
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(unhandled.reasons).to.eql([]);
        expect(pending).to.have.length(5);
        for (const promise of pending) {
          await expect(within(promise, 1000, "a pending initialized")).to.be.rejectedWith(failure);
        }
      } finally {
        unhandled.stop();
        await connection.close();
      }
    });

    it("rejects every pending initialized when closed during an outage", async function () {
      const exchangeName = nextExchangeName();
      const queueName = nextQueueName();
      const exchange = currentConnection.declareExchange(exchangeName, "fanout");
      const queue = currentConnection.declareQueue(queueName);
      try {
        const binding = await queue.bind(exchange);
        const { consumer } = nextMessage(queue);
        await consumer;
        await currentConnection.completeConfiguration();

        const lost = once(currentConnection, "lost_connection");
        expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
        await lost;
        const pending: Promise<unknown>[] = [
          currentConnection.initialized,
          exchange.initialized,
          queue.initialized,
          queue._consumerInitialized,
          binding.initialized,
        ];
        await currentConnection.close();

        for (const promise of pending) {
          await expect(within(promise, 1000, "a pending initialized")).to.be.rejectedWith("Connection closed");
        }
      } finally {
        // the closed connection cannot delete its topology any more
        await deleteOnBroker("exchange", exchangeName);
        await deleteOnBroker("queue", queueName);
      }
    });

    it("rejects a pending binding when its other end fails for good", async function () {
      const exchangeName = nextExchangeName();
      await createOnBroker("exchange", exchangeName);
      const exchange = currentConnection.declareExchange(exchangeName, "fanout", { noCreate: true });
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      const binding = await queue.bind(exchange);
      const { consumer } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();
      const errors: Error[] = [];
      currentConnection.on("error_connection", (err: Error) => errors.push(err));

      // the queue re-initializes after the consumer cancel, but cannot re-bind: the exchange is gone as well
      await deleteOnBroker("exchange", exchangeName);
      const firstQueue = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, firstQueue);
      const pendingBinding = binding.initialized;

      // the 404 makes the noCreate exchange re-initialize, which fails for good
      const firstExchange = exchange.initialized;
      exchange.send(new Message("into the void"));
      await expect(replaced(() => exchange.initialized, firstExchange)).to.be.rejectedWith("NOT-FOUND");

      await expect(within(pendingBinding, 2000, "the binding")).to.be.rejectedWith("NOT-FOUND");
      expect(Object.keys(currentConnection._bindings), "the binding is no longer declared").to.eql([]);
      await within(currentConnection.completeConfiguration(), 2000, "completeConfiguration");
      expect(errors, "one error_connection for the exchange").to.have.length(1);
    });

    it("settles a binding that is replaced while it is created again", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      const binding = await queue.bind(exchange);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // bind the same pair again while the queue's re-initialization re-creates the binding
      const rebind = binding._rebind.bind(binding) as (model: AmqpLib.ChannelModel) => Promise<void>;
      let replacement: Promise<Binding> | undefined;
      let rebinding: Promise<Binding> | undefined;
      binding._rebind = (model: AmqpLib.ChannelModel): Promise<void> => {
        const running = rebind(model);
        rebinding = binding.initialized;
        replacement = queue.bind(exchange);
        return running;
      };
      const first = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, first);

      expect(rebinding, "the binding was re-created").to.not.equal(undefined);
      await within(rebinding, 2000, "the replaced binding");
      expect(await replacement).to.not.equal(binding);
      exchange.send(new Message("after-replace"));
      await waitFor("after-replace");
    });

    it("reports a consumer that cannot be registered again during setup", async function () {
      const queueName = nextQueueName();
      // another connection holds an exclusive consumer, so the broker refuses ours with 403
      const raw = await AmqpLib.connect(ConnectionUrl);
      try {
        const rawChannel = await raw.createChannel();
        await rawChannel.assertQueue(queueName);
        await rawChannel.consume(queueName, () => {}, { exclusive: true });

        const queue = currentConnection.declareQueue(queueName);
        // the first registration only rejects the consumer promise, its caller handles that
        await expect(queue.activateConsumer(() => {})).to.be.rejectedWith("403");
        await new Promise((resolve) => setTimeout(resolve, 200));
        await queue.initialized;

        const errors: Error[] = [];
        currentConnection.on("error_connection", (err: Error) => errors.push(err));
        const lost = once(currentConnection, "lost_connection");
        const reestablished = once(currentConnection, "re_established_connection");
        expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);
        await lost;
        const consumer = queue._consumerInitialized;
        await reestablished;

        await expect(within(consumer, 2000, "the consumer promise")).to.be.rejectedWith("403");
        // it is not registered again until the next reconnect
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(errors, "one error_connection for the consumer").to.have.length(1);
        expect(errors[0].message).to.contain("403");
      } finally {
        await raw.close();
        // it was created on the raw connection, so do not rely on the cleanup
        await deleteOnBroker("queue", queueName);
      }
    });

    it("keeps recovering when a connection event listener throws", async function () {
      await currentConnection.completeConfiguration();
      const unhandled = collectUnhandledRejections();
      try {
        const thrower = (): never => {
          throw new Error("listener failure");
        };
        currentConnection.on("lost_connection", thrower);
        currentConnection.on("trying_connect", thrower);
        currentConnection.on("re_established_connection", thrower);
        // listeners registered after a throwing one still get the events
        const lost = once(currentConnection, "lost_connection");
        const reestablished = once(currentConnection, "re_established_connection");
        expect(await killConnections(currentConnectionName)).to.be.greaterThan(0);

        await within(lost, 10_000, "lost_connection");
        await within(reestablished, 10_000, "re_established_connection");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(unhandled.reasons).to.eql([]);
      } finally {
        unhandled.stop();
        currentConnection.removeAllListeners("lost_connection");
        currentConnection.removeAllListeners("trying_connect");
        currentConnection.removeAllListeners("re_established_connection");
      }
    });

    it("keeps the source exchange of a binding across connections on its own connection", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout");
      await currentConnection.initialized;
      await exchange.initialized;
      const ownConnection = currentConnection.getConnection.connection;
      const otherName = uniqueConnectionName();
      const other = new Connection(
        ConnectionUrl,
        { clientProperties: { connection_name: otherName } },
        { maxRetries: 5, initialDelay: 100 },
        loggerFactory,
      );
      const queueName = nextQueueName();
      try {
        const queue = other.declareQueue(queueName);
        await queue.bind(exchange);
        const { consumer, waitFor } = nextMessage(queue);
        await consumer;
        await other.completeConfiguration();

        const lost = once(other, "lost_connection");
        const reestablished = once(other, "re_established_connection");
        expect(await killConnections(otherName)).to.be.greaterThan(0);
        await lost;
        // the exchange's connection is not affected by the outage of the queue's connection
        exchange.send(new Message("during-outage"));
        await reestablished;
        expect(exchange._channel.connection, "the exchange stays on its own connection").to.equal(ownConnection);
        await within(waitFor("during-outage"), 5000, "the message sent during the outage");

        exchange.send(new Message("after-recovery"));
        await within(waitFor("after-recovery"), 5000, "the message sent after recovery");

        // closing the queue's connection leaves the exchange alone
        await other.close();
        await within(exchange.initialized, 2000, "the exchange's initialized");
        expect(exchange._channel.connection).to.equal(ownConnection);
        const probe = currentConnection.declareQueue(nextQueueName());
        await probe.bind(exchange);
        const probed = nextMessage(probe);
        await probed.consumer;
        exchange.send(new Message("after-close"));
        await within(probed.waitFor("after-close"), 5000, "the message sent after the other connection closed");
      } finally {
        await within(other.close(), CleanupTimeout, "close");
        await deleteOnBroker("queue", queueName);
      }
    });

    it("delivers a message sent while a broker-cancelled consumer's channel is closing", async function () {
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // send right after the cancel handling started to close the channel, before the broker confirmed the close
      const channel = queue._channel;
      const close = channel.close.bind(channel) as () => Promise<void>;
      channel.close = (): Promise<void> => {
        const closing = close();
        queue.send(new Message("while-closing"));
        return closing;
      };
      const first = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, first);

      await within(waitFor("while-closing"), 5000, "the message sent while the channel was closing");
    });

    it("fails a bad binding on its own without taking down a sibling binding", async function () {
      const headers = currentConnection.declareExchange(nextExchangeName(), "headers");
      const fanout = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      // created together, so both binds run at the same time
      const bad = queue.bind(headers, "", { "x-match": "bogus" });
      const good = queue.bind(fanout);

      await expect(bad).to.be.rejectedWith("x-match");
      await within(good, 2000, "the good binding");
      expect(Object.keys(currentConnection._bindings), "only the good binding is declared").to.eql([
        `[${fanout.name}]toQueue[${queue.name}]`,
      ]);

      const { consumer, waitFor } = nextMessage(queue);
      await consumer;
      fanout.send(new Message("through-the-good-binding"));
      await within(waitFor("through-the-good-binding"), 5000, "the message through the good binding");
    });

    it("stops and deletes a queue whose consumer was refused", async function () {
      const queueName = nextQueueName();
      // another connection holds an exclusive consumer, so the broker refuses ours with 403
      const raw = await AmqpLib.connect(ConnectionUrl);
      try {
        const rawChannel = await raw.createChannel();
        await rawChannel.assertQueue(queueName);
        await rawChannel.consume(queueName, () => {}, { exclusive: true });

        const queue = currentConnection.declareQueue(queueName);
        await expect(queue.activateConsumer(() => {})).to.be.rejectedWith("403");
        await new Promise((resolve) => setTimeout(resolve, 200));
        await queue.initialized;

        // nothing to cancel, so stopping resolves and clears the consumer
        await within(queue.stopConsumer(), 2000, "stopConsumer");
        expect(queue._consumerInitialized, "the consumer is cleared").to.equal(undefined);
        await within(queue.delete(), 2000, "delete");
        expect(currentConnection._queues[queueName], "the queue is deleted").to.equal(undefined);
      } finally {
        await raw.close();
        await deleteOnBroker("queue", queueName);
      }
    });
  });

  describe("topology deletion and failure reporting", function () {
    this.timeout(ReconnectTimeout);

    /** Opens a raw channel on a separate connection, for looking at the broker behind the library's back. */
    async function rawChannel(): Promise<{ channel: AmqpLib.Channel; close: () => Promise<void> }> {
      const raw = await AmqpLib.connect(ConnectionUrl);
      const channel = await raw.createChannel();
      channel.on("error", () => {});
      return { channel, close: () => raw.close() };
    }

    /** Whether an exchange or a queue exists on the broker. */
    async function existsOnBroker(kind: "exchange" | "queue", name: string): Promise<boolean> {
      const raw = await rawChannel();
      try {
        await (kind === "exchange" ? raw.channel.checkExchange(name) : raw.channel.checkQueue(name));
        return true;
      } catch {
        return false;
      } finally {
        await raw.close();
      }
    }

    function sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    it("settles a pending binding when it is deleted", async function () {
      // the broker deletes an autoDelete exchange together with the last queue bound to it
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout", { autoDelete: true });
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      const binding = await queue.bind(exchange);
      const { consumer } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // the queue re-initializes after the consumer cancel, but cannot re-bind: the exchange is gone as well
      const firstQueue = queue.initialized;
      await deleteOnBroker("queue", queueName);
      await replaced(() => queue.initialized, firstQueue);
      const pending = binding.initialized;
      const channel = queue._channel;
      const ready = queue.initialized;

      const deleting = binding.delete();
      await expect(within(pending, 2000, "the pending binding")).to.be.rejectedWith("deleted");
      // the exchange is gone and the binding with it, so there is nothing left to delete
      await within(deleting, 2000, "delete");
      expect(Object.keys(currentConnection._bindings), "the binding is no longer declared").to.eql([]);
      await sleep(300);
      expect(queue._channel, "the queue's channel is left alone").to.equal(channel);
      expect(queue.initialized, "the queue is not re-initialized").to.equal(ready);
    });

    it("unbinds on a channel of its own, so a failing unbind leaves the queue alone", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      await queue.bind(exchange);
      await currentConnection.completeConfiguration();
      const channel = queue._channel;
      const ready = queue.initialized;

      // the broker refuses any unbind from the default exchange with 403, which closes the channel it runs on
      const prototype = Object.getPrototypeOf(channel) as AmqpLib.Channel;
      const { unbindQueue } = prototype;
      prototype.unbindQueue = function (
        this: AmqpLib.Channel,
        queueName: string,
        _source: string,
        pattern: string,
        args?: unknown,
      ) {
        return unbindQueue.call(this, queueName, "", pattern, args) as ReturnType<AmqpLib.Channel["unbindQueue"]>;
      };
      try {
        await expect(within(queue.unbind(exchange), 2000, "unbind")).to.be.rejectedWith("403");
      } finally {
        prototype.unbindQueue = unbindQueue;
      }
      await sleep(300);
      expect(queue._channel, "the queue's channel is left alone").to.equal(channel);
      expect(queue.initialized, "the queue is not re-initialized").to.equal(ready);
      expect(Object.keys(currentConnection._bindings), "the binding is not created again").to.eql([]);
    });

    it("deletes a binding only once when it is deleted repeatedly", async function () {
      const exchange = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      const binding = await queue.bind(exchange);

      const first = binding.delete();
      expect(binding.delete(), "the same promise").to.equal(first);
      await within(first, 2000, "delete");
      await within(binding.delete(), 2000, "a later delete");
    });

    it("resolves unbind of a binding that does not exist", async function () {
      const exchange1 = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const exchange2 = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      await currentConnection.completeConfiguration();

      let unbinding: Promise<void> | undefined;
      expect(() => (unbinding = queue.unbind(exchange1)), "queue.unbind does not throw").to.not.throw();
      await within(unbinding, 2000, "queue.unbind");
      expect(() => (unbinding = exchange2.unbind(exchange1)), "exchange.unbind does not throw").to.not.throw();
      await within(unbinding, 2000, "exchange.unbind");

      // nor does unbinding a second time
      await queue.bind(exchange1);
      await exchange2.bind(exchange1);
      await queue.unbind(exchange1);
      await exchange2.unbind(exchange1);
      await within(queue.unbind(exchange1), 2000, "the second queue.unbind");
      await within(exchange2.unbind(exchange1), 2000, "the second exchange.unbind");
    });

    it("deletes the configuration in phases, unbinding every binding once", async function () {
      const exchange1 = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const exchange2 = currentConnection.declareExchange(nextExchangeName(), "fanout");
      const queue = currentConnection.declareQueue(nextQueueName());
      await exchange2.bind(exchange1);
      await queue.bind(exchange2);
      const { consumer } = nextMessage(queue);
      await consumer;
      await currentConnection.completeConfiguration();

      // record the broker operations in the order they are started
      const prototype = Object.getPrototypeOf(queue._channel) as Record<string, (...args: unknown[]) => unknown>;
      const operations = ["unbindQueue", "unbindExchange", "deleteQueue", "deleteExchange"];
      const originals = operations.map((operation) => prototype[operation]);
      const calls: string[] = [];
      operations.forEach((operation, i) => {
        prototype[operation] = function (this: AmqpLib.Channel, ...args: unknown[]) {
          calls.push(operation.startsWith("unbind") ? "unbind" : operation);
          return originals[i].apply(this, args);
        };
      });
      try {
        await within(currentConnection.deleteConfiguration(), CleanupTimeout, "deleteConfiguration");
      } finally {
        operations.forEach((operation, i) => {
          prototype[operation] = originals[i];
        });
      }

      // bindings first, then queues, then exchanges, each binding once
      expect(calls).to.eql(["unbind", "unbind", "deleteQueue", "deleteExchange", "deleteExchange"]);
      expect(await existsOnBroker("exchange", exchange1.name), exchange1.name).to.equal(false);
      expect(await existsOnBroker("exchange", exchange2.name), exchange2.name).to.equal(false);
      expect(await existsOnBroker("queue", queue.name), queue.name).to.equal(false);
    });

    it("stops a consumer while it is registered again after a channel repair", async function () {
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      let first = true;
      const { consumer, waitFor } = nextMessage(queue, { noAck: false }, (message) => {
        message.ack();
        if (first) {
          first = false;
          // acking the same delivery twice makes the broker close this channel with 406 PRECONDITION_FAILED
          message.ack();
        }
      });
      await consumer;
      await currentConnection.completeConfiguration();

      queue.send(new Message("first"));
      await waitFor("first");
      // the broker closes the channel meanwhile, and the queue registers its consumer again
      await within(queue.stopConsumer(), 5000, "stopConsumer");
      expect(queue._consumerInitialized, "the consumer is cleared").to.equal(undefined);

      await within(queue.initialized, 5000, "the queue's initialized");
      await sleep(300);
      const raw = await rawChannel();
      try {
        expect((await raw.channel.checkQueue(queueName)).consumerCount, "no consumer is left").to.equal(0);
      } finally {
        await raw.close();
      }
    });

    it("cancels a consumer registration that completes after stopConsumer", async function () {
      const queueName = nextQueueName();
      const queue = currentConnection.declareQueue(queueName);
      await queue.initialized;
      const internals = queue as unknown as { _consumerDeferred?: { reject(err: Error): void } };

      // stopConsumer finishes while a registration is in flight, as it did when the consumer promise was already
      // rejected by an earlier refusal
      const channel = queue._channel;
      const consume = channel.consume.bind(channel) as AmqpLib.Channel["consume"];
      let registering: Promise<AmqpLib.Replies.Consume> | undefined;
      let stopping: Promise<void> | undefined;
      channel.consume = (...args: Parameters<AmqpLib.Channel["consume"]>) => {
        registering = consume(...args);
        internals._consumerDeferred?.reject(new Error("refused before"));
        stopping = queue.stopConsumer();
        return registering;
      };
      void queue.activateConsumer(() => {});
      while (registering === undefined) {
        await sleep(10);
      }
      await within(stopping, 2000, "stopConsumer");
      await within(registering, 2000, "the registration");
      await sleep(300);

      const raw = await rawChannel();
      try {
        expect((await raw.channel.checkQueue(queueName)).consumerCount, "no orphaned consumer").to.equal(0);
      } finally {
        await raw.close();
      }
    });

    it("requeues a message delivered to a consumer that was stopped meanwhile", function () {
      const queue = currentConnection.declareQueue(nextQueueName());
      const requeued: boolean[] = [];
      const channel = {
        nack: (_message: unknown, _allUpTo: boolean, requeue: boolean) => requeued.push(requeue),
      };
      const internals = queue as unknown as {
        _createConsumerWrapper(channel: unknown, noAck: boolean): (msg: unknown) => void;
      };
      const message = { content: Buffer.from("late"), properties: {}, fields: { consumerTag: "tag" } };

      expect(() => internals._createConsumerWrapper(channel, false)(message)).to.not.throw();
      expect(requeued, "nacked with requeue").to.eql([true]);
      // without acknowledgements there is nothing to give back
      internals._createConsumerWrapper(channel, true)(message);
      expect(requeued).to.eql([true]);
    });
  });
});
