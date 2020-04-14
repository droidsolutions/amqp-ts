/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Integration tests for AmqpSimple
 * Created by Ab on 2015-10-21.
 */
import * as Chai from "chai";
const expect = Chai.expect;
 
import { Connection } from "../src/Connection/Connection";
import { Message } from "../src/Message";
import * as pino from "pino";

/**
 * Test using a local rabbitmq instance
 */
// define test defaults
const ConnectionUrl = process.env.AMQPTEST_CONNECTION_URL || "amqp://localhost";
const UnitTestLongTimeout = process.env.AMQPTEST_LONG_TIMEOUT || 60000;
const LogLevel = process.env.AMQPTEST_LOGLEVEL || "silent";

// needed for server restart tests
const os = require("os");
const isWin = os.platform().startsWith("win");
const cp = require("child_process");

const logger = pino({
  name: "amqp-ts integration-test",
  level: LogLevel,
  formatters: {
    level: (label, _number) => {
      return { level: label };
    },
  },
  prettyPrint: { ignore: "hostname" },
  redact: [],
  serializers: { err: pino.stdSerializers.err },
});

/* istanbul ignore next */
function restartAmqpServer() {
  "use strict";
  // windows only code
  console.log("shutdown and restart rabbitmq");
  if (isWin) {
    try {
      cp.execSync("net stop rabbitmq");
      cp.exec("net start rabbitmq");
    } catch (err) {
      logger.error(
        {err},
        "Unable to shutdown and restart RabbitMQ, possible solution: use elevated permissions (start an admin shell)",
      );
      throw new Error("Unable to restart rabbitmq, error:\n" + err.message);
    }
  } else {
    try {
      cp.execSync("./tools/restart-rabbit.sh");
    } catch (err) {
      logger.error({err}, "Unable to shutdown and restart RabbitMQ");
      throw new Error("Unable to restart rabbitmq, error:\n" + err.message);
    }
  }
}

/* istanbul ignore next */
describe("AMQP Connection class automatic reconnection", function () {
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
            cleanup(connection, done, err);
          }
        },
        { noAck: true },
      )
      .then(() => {
        restartAmqpServer();
        setTimeout(() => {
          const msg = new Message("Test");
          queue.send(msg);
        }, 1000);
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
            cleanup(connection, done, err);
          }
        },
        { noAck: true },
      )
      .then(() => {
        restartAmqpServer();
        setTimeout(() => {
          const msg = new Message("Test");
          queue.send(msg);
        }, 1000);
      })
      .catch((err) => {
        console.log("Consumer intialization FAILED!!!");
        done(err);
      });
  });
});
