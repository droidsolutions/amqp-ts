/* eslint-disable no-console */
/**
 * Integration tests for AmqpSimple
 * Created by Ab on 2015-10-21.
 */
import { expect } from "chai";
import { Connection } from "../src/Connection/Connection.js";
import { Message } from "../src/Message.js";
import { restartBroker } from "./helpers/broker.js";

/**
 * Test using a local rabbitmq instance
 */
// define test defaults
const ConnectionUrl = process.env.AMQPTEST_CONNECTION_URL || "amqp://localhost";
const UnitTestLongTimeout = process.env.AMQPTEST_LONG_TIMEOUT || 60000;

/* istanbul ignore next */
describe("AMQP Connection class automatic reconnection", function () {
  // cleanup function for the AMQP connection, also tests the Connection.deleteConfiguration method
  function cleanup(connection: Connection, done: (err?: unknown) => void, error?: Error) {
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

  this.timeout(UnitTestLongTimeout); // define long timeout for rabbitmq service restart

  it("should reconnect a queue when detecting a broken connection because of a server restart", function (done) {
    // initialize
    const connection = new Connection(ConnectionUrl);

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
        done(err);
      });
  });

  // eslint-disable-next-line max-len
  it("should reconnect and rebuild a complete configuration when detecting a broken connection because of a server restart", function (done) {
    // initialize
    const connection = new Connection(ConnectionUrl);

    // test code
    const exchange1 = connection.declareExchange("TestExchange1");
    const exchange2 = connection.declareExchange("TestExchange2");
    const queue = connection.declareQueue("TestQueue");
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
      .then(() => {
        return restartBroker().then(() => {
          queue.send(new Message("Test"));
        });
      })
      .catch((err) => {
        console.log("Consumer intialization FAILED!!!");
        done(err);
      });
  });
});
