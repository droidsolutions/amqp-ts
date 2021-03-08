/**
 * Options that will be used for for creating exchanges. For more info see
 * {@link https://www.squaremobius.net/amqp.node/channel_api.html#channel_assertExchange}.
 */
export interface DeclarationOptions {
  /** If true, the exchange will survive broker restarts. Defaults to true. */
  durable?: boolean;
  /** If true, messages cannot be published directly to the exchange. Defaults to false. */
  internal?: boolean;
  /** If true, the exchange will be destroyed once the number of bindings drops to zero. Defaults to false. */
  autoDelete?: boolean;
  /** An exchange to send messages to when the this exchange can't route to any queues. */
  alternateExchange?: string;
  /** Any additional arguments for the exchange. may be needed for some exchange types. */
  arguments?: any;
  /**
   * If true, exchange will not be created if it does not exist. Instead an error will be thrown on initialization. If
   * false exchange will be created if it does not already exist. */
  noCreate?: boolean;
}
