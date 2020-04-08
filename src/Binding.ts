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
  _initialize(): void {
    this.initialized = new Promise<Binding>((resolve, reject) => {
      if (this._destination instanceof Queue) {
        var queue = <Queue>this._destination;
        queue.initialized.then(() => {
          queue._channel.bindQueue(
            this._destination._name,
            this._source._name,
            this._pattern,
            this._args,
            (err, ok) => {
              /* istanbul ignore if */
              if (err) {
                log.log(
                  "error",
                  "Failed to create queue binding (" + this._source._name + "->" + this._destination._name + ")",
                  { module: "amqp-ts" },
                );
                delete this._destination._connection._bindings[
                  Binding.id(this._destination, this._source, this._pattern)
                ];
                reject(err);
              } else {
                resolve(this);
              }
            },
          );
        });
      } else {
        var exchange = <Exchange>this._destination;
        exchange.initialized.then(() => {
          exchange._channel.bindExchange(
            this._destination._name,
            this._source._name,
            this._pattern,
            this._args,
            (err, ok) => {
              /* istanbul ignore if */
              if (err) {
                log.log(
                  "error",
                  "Failed to create exchange binding (" + this._source._name + "->" + this._destination._name + ")",
                  { module: "amqp-ts" },
                );
                delete this._destination._connection._bindings[
                  Binding.id(this._destination, this._source, this._pattern)
                ];
                reject(err);
              } else {
                resolve(this);
              }
            },
          );
        });
      }
    });
  }
  delete(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._destination instanceof Queue) {
        var queue = <Queue>this._destination;
        queue.initialized.then(() => {
          queue._channel.unbindQueue(
            this._destination._name,
            this._source._name,
            this._pattern,
            this._args,
            (err, ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this._destination._connection._bindings[
                  Binding.id(this._destination, this._source, this._pattern)
                ];
                resolve(null);
              }
            },
          );
        });
      } else {
        var exchange = <Exchange>this._destination;
        exchange.initialized.then(() => {
          exchange._channel.unbindExchange(
            this._destination._name,
            this._source._name,
            this._pattern,
            this._args,
            (err, ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this._destination._connection._bindings[
                  Binding.id(this._destination, this._source, this._pattern)
                ];
                resolve(null);
              }
            },
          );
        });
      }
    });
  }
  static id(destination: Exchange | Queue, source: Exchange, pattern?: string): string {
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
  static removeBindingsContaining(connectionPoint: Exchange | Queue): Promise<any> {
    var connection = connectionPoint._connection;
    var promises: Promise<void>[] = [];
    for (var bindingId in connection._bindings) {
      var binding: Binding = connection._bindings[bindingId];
      if (binding._source === connectionPoint || binding._destination === connectionPoint) {
        promises.push(binding.delete());
      }
    }
    return Promise.all(promises);
  }
}
