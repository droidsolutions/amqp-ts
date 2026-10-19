/**
 * Options for the automatic reconnect, passed through to amqplib's connection recovery: `initialDelay`, `maxDelay`,
 * `factor`, `jitter`, `maxRetries`, `initialMaxRetries` and `calculateDelay`. `setup` and `waitForConnect` are owned
 * by amqp-ts.
 */
export type RecoveryOptions = Omit<import("amqplib").RecoveryOptions, "setup" | "waitForConnect">;
