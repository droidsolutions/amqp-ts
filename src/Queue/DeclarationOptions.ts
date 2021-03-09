/** Options for declaring queues. */
export interface DeclarationOptions {
  exclusive?: boolean;
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: any;
  messageTtl?: number;
  expires?: number;
  deadLetterExchange?: string;
  maxLength?: number;
  /** Tells the server to not give more than this amount of messages at the same time to this queue. */
  prefetch?: number;
  /**
   * If true, checkQueue is called instead of assertQueue. See
   * {@link http://www.squaremobius.net/amqp.node/channel_api.html#channel_checkQueue} for more info.
   */
  noCreate?: boolean;
}
