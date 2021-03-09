import * as AmqpLib from "amqplib";

/**
 * Represents a set of optional properties that can be set when publishing messages via AMQP.
 *
 * @see https://www.rabbitmq.com/consumers.html#message-properties for more info.
 * Also @see http://www.squaremobius.net/amqp.node/channel_api.html#channel_publish for library defaults.
 */
export interface AmqpProperties extends AmqpLib.Options.Publish {
  /** The time to live until the message is considered dead in ms. @see https://www.rabbitmq.com/ttl.html */
  expiration?: string | number;
  /**
   * The ID of the AQMP user who published the message. If set it is validated and its value must be equal to the name
   * of the user used to open the connection. @see https://www.rabbitmq.com/validated-user-id.html
   */
  userId?: string;

  /**
   * An array of routing keys as string. Messages will be routed to these routing keys in addition to the given routing
   * key parameter.
   */
  CC?: string | string[];

  /** If true, the message will be returned if it is not routed to a queue. */
  mandatory?: boolean;
  /**
   * Sets the @see deliveryMode to 2. If true the message will survive broker restarts as long as the queue survives.
   *
   * @example true
   */
  persistent?: boolean;
  /**
   * The delivery mode, 2 or true means "persistent", 1 or false "transient". Used by RabbitMQ but not sent to
   * consumers.
   *
   * @example 2
   */
  deliveryMode?: boolean | number;

  /**
   * Like @see CC except that the headers will not be send in the message headers to the consumer.
   */
  BCC?: string | string[];

  /**
   * The content type of the message body, useful for consumer when parsing the message body.
   *
   * @example "application/json"
   */
  contentType?: string;

  /**
   * The encoding of the message body, useful for consumer when parsing the body.
   *
   * @example "utf-8"
   */
  contentEncoding?: string;

  /**
   * Any additional headers of the message. For content-type use @see contentType . Application specific and not used
   * by RabbitMQ.*/
  headers?: any;

  /**
   * A positive integer that sets the priority of the message. @see http://www.rabbitmq.com/priority.html
   */
  priority?: number;

  /** Useful to combine logs of sender and recipient by using a correlation ID. */
  correlationId?: string;

  /** The name of the response queue. */
  replyTo?: string;

  /** Arbitrary message ID. */
  messageId?: string;

  /** A timestamp of the message. */
  timestamp?: number;

  /**
   * Application specific message type. RabbitMQ does nothing with this field but it can help the consumer to know what
   * kind of message this is.
   *
   * @example "audit.log"
   */
  type?: string;

  /**
   * The name of the application.
   *
   * @example "app:audit component:event-consumer"
   */
  appId?: string;
}
