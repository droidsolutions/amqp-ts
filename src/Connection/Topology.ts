import { ExchangeType } from "../Exchange/ExchangeType.js";

export interface Topology {
  exchanges: {
    name: string;
    type?: ExchangeType;
    options?: any;
  }[];
  queues: {
    name: string;
    options?: any;
  }[];
  bindings: {
    source: string;
    queue?: string;
    exchange?: string;
    pattern?: string;
    args?: any;
  }[];
}
