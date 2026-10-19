/* eslint-disable no-console */
/**
 * Integration tests for AmqpSimple
 * Created by Ab on 2015-10-21.
 */
import { expect } from "chai";
import { once } from "node:events";
import { Connection } from "../src/Connection/Connection.js";
import { Message } from "../src/Message.js";
import { restartBroker } from "./helpers/broker.js";

/**
 * Test using a local rabbitmq instance
 */
// define test defaults
const ConnectionUrl = process.env.AMQPTEST_CONNECTION_URL || "amqp://localhost";
const UnitTestLongTimeout = process.env.AMQPTEST_LONG_TIMEOUT || 60000;
const CleanupTimeout = 5000;

/* istanbul ignore next */
describe("AMQP Connection class automatic reconnection", function () {
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
  // closed even when deleting the topology fails or hangs, so it cannot keep recovering and hang the run.
  function cleanup(connection: Connection, done: (err?: unknown) => void, error?: Error) {
    within(connection.deleteConfiguration(), CleanupTimeout, "deleteConfiguration")
      .finally(() => within(connection.close(), CleanupTimeout, "close"))
      .then(
        () => {
          done(error);
        },
        (err) => {
          done(error ?? err);
        },
      );
  }

  // a test that fails by timing out never reaches cleanup, so close every connection it created afterwards
  const connections: Connection[] = [];
  function newConnection(): Connection {
    const connection = new Connection(ConnectionUrl);
    connections.push(connection);
    return connection;
  }

  afterEach(async function () {
    this.timeout(2 * CleanupTimeout);
    const closing = connections.splice(0).map((connection) => within(connection.close(), CleanupTimeout, "close"));
    await Promise.allSettled(closing);
  });

  this.timeout(UnitTestLongTimeout); // define long timeout for rabbitmq service restart

  it("should reconnect a queue when detecting a broken connection because of a server restart", function (done) {
    // initialize
    const connection = newConnection();

    // test code
    const queue = connection.declareQueue("TestQueue");
    queue
      .activateConsumer(
        (message) => {
          try {
            expect(message.getContent()).equals("Test");
            cleanup(connection, done);
          } catch (err) {
            cleanup(connection, done, err as Error);
          }
        },
        { noAck: true },
      )
      .then(() => {
        return restartBroker().then(() => {
          queue.send(new Message("Test"));
        });
      })
      .catch((err) => {
        console.log("Consumer intialization FAILED!!!");
        cleanup(connection, done, err as Error);
      });
  });

  // eslint-disable-next-line max-len
  it("should reconnect and rebuild a complete configuration when detecting a broken connection because of a server restart", function (done) {
    // initialize
    const connection = newConnection();

    // test code: transient entities do not survive the restart, so only a rebuild can route the message
    const exchange1 = connection.declareExchange("TestTransientExchange1", "fanout", { durable: false });
    const exchange2 = connection.declareExchange("TestTransientExchange2", "fanout", { durable: false });
    const queue = connection.declareQueue("TestTransientQueue", { durable: false });
    exchange2.bind(exchange1);
    queue.bind(exchange2);
    queue
      .activateConsumer(
        (message) => {
          try {
            expect(message.getContent()).equals("Test");
            cleanup(connection, done);
          } catch (err) {
            cleanup(connection, done, err as Error);
          }
        },
        { noAck: true },
      )
      .then(() => connection.completeConfiguration())
      .then(() => {
        // send once the whole topology is back: a message buffered during the outage goes out as soon as exchange1
        // is declared again, which can be before its bindings are
        const reestablished = once(connection, "re_established_connection");
        return restartBroker()
          .then(() => reestablished)
          .then(() => {
            exchange1.send(new Message("Test"));
          });
      })
      .catch((err) => {
        console.log("Consumer intialization FAILED!!!");
        cleanup(connection, done, err as Error);
      });
  });
});
