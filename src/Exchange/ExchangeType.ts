/**
 * Possible values for exchange types.
 * 
 * @see https://www.rabbitmq.com/tutorials/amqp-concepts.html#exchanges for more info.
 */
export type ExchangeType = "direct" | "fanout" | "topic" | "headers";
