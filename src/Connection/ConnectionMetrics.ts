/** Metrics of a connection. */
export interface ConnectionMetrics {
  /** The amount of messages send via this connection. */
  sentMessagesCounter: number;
  /** The amount of messages received on this connection. */
  receivedMessagesCounter: number;
}