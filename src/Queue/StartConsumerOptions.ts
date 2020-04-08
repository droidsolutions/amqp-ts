export interface StartConsumerOptions {
  rawMessage?: boolean;
  consumerTag?: string;
  noLocal?: boolean;
  noAck?: boolean;
  manualAck?: boolean;
  exclusive?: boolean;
  priority?: number;
  arguments?: Object;
}
