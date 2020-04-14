import { Exchange } from "./Exchange/Exchange";
import { Queue } from "./Queue/Queue";
import { log } from "./amqp-ts";

export class Binding {
  initialized: Promise<Binding>;
  _source: Exchange;
  _destination: Exchange | Queue;
  _pattern: string;
  _args: any;
  constructor(destination: Exchange | Queue, source: Exchange, pattern = "", args: any = {}) {
    this._source = source;
    this._destination = destination;
    this._pattern = pattern;
    this._args = args;
    this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)] = this;
    this._initialize();
  }

  public _initialize(): void {
    this.initialized = new Promise<Binding>((resolve, reject) => {
      if (this._destination instanceof Queue) {
        const queue = this._destination;
        queue.initialized.then(() => {
          queue._channel
            .bindQueue(this._destination._name, this._source._name, this._pattern, this._args)
            .then(() => {
              resolve(this);
            })
            .catch((err: Error) => {
              log.log(
                "error",
                "Failed to create queue binding (" + this._source._name + "->" + this._destination._name + ")",
                { module: "amqp-ts" },
              );
              delete this._destination._connection._bindings[
                Binding.id(this._destination, this._source, this._pattern)
              ];

              reject(err);
            });
        });
      } else {
        const exchange = this._destination;
        exchange.initialized.then(() => {
          exchange._channel
            .bindExchange(this._destination._name, this._source._name, this._pattern, this._args)
            .then(() => {
              resolve(this);
            })
            .catch((err: Error) => {
              log.log(
                "error",
                "Failed to create exchange binding (" + this._source._name + "->" + this._destination._name + ")",
                { module: "amqp-ts" },
              );
              delete this._destination._connection._bindings[
                Binding.id(this._destination, this._source, this._pattern)
              ];
              reject(err);
            });
        });
      }
    });
  }

  public async delete(): Promise<void> {
    if (this._destination instanceof Queue) {
      const queue = this._destination;
      await queue.initialized;
      await queue._channel.unbindQueue(this._destination._name, this._source._name, this._pattern, this._args);

      delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
    } else {
      const exchange = this._destination;
      await exchange.initialized;
      await exchange._channel.unbindExchange(this._destination._name, this._source._name, this._pattern, this._args);
      delete this._destination._connection._bindings[Binding.id(this._destination, this._source, this._pattern)];
    }
  }

  public static id(destination: Exchange | Queue, source: Exchange, pattern?: string): string {
    pattern = pattern || "";
    return (
      "[" +
      source._name +
      "]to" +
      (destination instanceof Queue ? "Queue" : "Exchange") +
      "[" +
      destination._name +
      "]" +
      pattern
    );
  }

  public static removeBindingsContaining(connectionPoint: Exchange | Queue): Promise<any> {
    const connection = connectionPoint._connection;
    const promises: Promise<void>[] = [];
    for (const bindingId in connection._bindings) {
      const binding: Binding = connection._bindings[bindingId];
      if (binding._source === connectionPoint || binding._destination === connectionPoint) {
        promises.push(binding.delete());
      }
    }
    return Promise.all(promises);
  }
}
