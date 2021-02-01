import { Exchange } from "./Exchange/Exchange";
import { SimpleLogger } from "./LoggerFactory";
import { Queue } from "./Queue/Queue";

export class Binding {
  public static id(destination: Exchange | Queue, source: Exchange, pattern?: string): string {
    pattern = pattern || "";
    return (
      "[" +
      source.name +
      "]to" +
      (destination instanceof Queue ? "Queue" : "Exchange") +
      "[" +
      destination.name +
      "]" +
      pattern
    );
  }

  public static removeBindingsContaining(connectionPoint: Exchange | Queue): Promise<any> {
    const connection = connectionPoint.connection;
    const promises: Promise<void>[] = [];
    for (const bindingId in connection._bindings) {
      const binding: Binding = connection._bindings[bindingId];
      if (binding._source === connectionPoint || binding._destination === connectionPoint) {
        promises.push(binding.delete());
      }
    }
    return Promise.all(promises);
  }

  public initialized: Promise<Binding>;
  public _source: Exchange;
  public _destination: Exchange | Queue;
  private log: SimpleLogger;

  constructor(destination: Exchange | Queue, source: Exchange, private pattern = "", private args: any = {}) {
    this.log = destination.connection.loggerFactory(this.constructor);
    this._source = source;
    this._destination = destination;
    this._destination.connection._bindings[Binding.id(this._destination, this._source, this.pattern)] = this;
    this._initialize();
  }

  public _initialize(): void {
    this.initialized = new Promise<Binding>((resolve, reject) => {
      if (this._destination instanceof Queue) {
        const queue = this._destination;
        queue.initialized.then(() => {
          queue._channel.bindQueue(
            this._destination.name,
            this._source.name,
            this.pattern,
            this.args,
            (err: Error, _ok) => {
              /* istanbul ignore if */
              if (err) {
                this.log.error(
                  { err },
                  "Failed to create queue binding (%s->%s)",
                  this._source.name,
                  this._destination.name,
                );
                delete this._destination.connection._bindings[
                  Binding.id(this._destination, this._source, this.pattern)
                ];
                reject(err);
              } else {
                resolve(this);
              }
            },
          );
        });
      } else {
        const exchange = this._destination;
        exchange.initialized.then(() => {
          exchange._channel.bindExchange(
            this._destination.name,
            this._source.name,
            this.pattern,
            this.args,
            (err: Error, _ok) => {
              /* istanbul ignore if */
              if (err) {
                this.log.error(
                  { err },
                  "Failed to create exchange binding (%s->%s)",
                  this._source.name,
                  this._destination.name,
                );
                delete this._destination.connection._bindings[
                  Binding.id(this._destination, this._source, this.pattern)
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

  /**
   * Deletes this binding of either a queue or an exchange.
   */
  public delete(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._destination instanceof Queue) {
        const queue = this._destination;
        queue.initialized.then(() => {
          queue._channel.unbindQueue(this._destination.name, this._source.name, this.pattern, this.args, (err, _ok) => {
            /* istanbul ignore if */
            if (err) {
              reject(err);
            } else {
              delete this._destination.connection._bindings[Binding.id(this._destination, this._source, this.pattern)];
              resolve(null);
            }
          });
        });
      } else {
        const exchange = this._destination;
        exchange.initialized.then(() => {
          exchange._channel.unbindExchange(
            this._destination.name,
            this._source.name,
            this.pattern,
            this.args,
            (err, _ok) => {
              /* istanbul ignore if */
              if (err) {
                reject(err);
              } else {
                delete this._destination.connection._bindings[
                  Binding.id(this._destination, this._source, this.pattern)
                ];
                resolve(null);
              }
            },
          );
        });
      }
    });
  }
}
