export interface ReconnectStrategy {
  retries: number; // number of retries, 0 is forever
  interval: number; // retry interval in ms
}
