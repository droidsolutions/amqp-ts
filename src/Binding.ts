import type { ChannelModel } from "amqplib";
import { Deferred } from "./Deferred.js";
import { Exchange } from "./Exchange/Exchange.js";
import { SimpleLogger } from "./LoggerFactory.js";
import { Queue } from "./Queue/Queue.js";

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

  /**
   * A promise that resolves once the binding is created. It is replaced by a pending promise while the binding is
   * created again after a lost connection.
   */
  public initialized: Promise<Binding>;
  public _source: Exchange;
  public _destination: Exchange | Queue;
  private log: SimpleLogger;
  private _deferred: Deferred<Binding>;
  /** The generation of the last initialization, and that initialization. */
  private _generation: number | undefined;
  private _initializing: Promise<void> = Promise.resolve();
  /** Changes with every initialization, so a superseded one can tell. */
  private _attempt = 0;

  constructor(destination: Exchange | Queue, source: Exchange, private pattern = "", private args: any = {}) {
    this.log = destination.connection.loggerFactory(this.constructor);
    this._source = source;
    this._destination = destination;
    this._deferred = new Deferred<Binding>();
    this.initialized = this._deferred.promise;
    const connection = this._destination.connection;
    connection._bindings[Binding.id(this._destination, this._source, this.pattern)] = this;
    // while disconnected the next connect initializes it
    if (connection._model) {
      this._initialize(connection._model, connection._generation).catch(() => {});
    }
  }

  /**
   * Creates the binding on the destination's channel once source and destination are initialized on the given
   * generation, then settles {@link initialized}. Does nothing if the binding was already initialized for the given
   * generation.
   * @internal
   */
  public _initialize(model: ChannelModel, generation: number): Promise<void> {
    if (this._generation !== generation) {
      this._generation = generation;
      this._initializing = this._bind(model, generation, ++this._attempt);
    }
    return this._initializing;
  }

  /**
   * Replaces a settled {@link initialized} with a pending one, until the binding is created again.
   * @internal
   */
  public _invalidate(): void {
    if (this._deferred.settled) {
      this._deferred = new Deferred<Binding>();
      this.initialized = this._deferred.promise;
    }
  }

  private async _bind(model: ChannelModel, generation: number, attempt: number): Promise<void> {
    const destination = this._destination;
    const source = this._source;
    try {
      // both are initialized on this generation already, unless they were declared after it started
      await Promise.all([destination._initialize(model, generation), source._initialize(model, generation)]);
      if (attempt !== this._attempt) {
        return;
      }
      if (destination instanceof Queue) {
        await destination._channel.bindQueue(destination.name, source.name, this.pattern, this.args);
      } else {
        await destination._channel.bindExchange(destination.name, source.name, this.pattern, this.args);
      }
      if (attempt !== this._attempt) {
        return;
      }
      this._deferred.resolve(this);
    } catch (err) {
      if (attempt !== this._attempt) {
        return;
      }
      if (destination.connection._isModelClosed(model)) {
        // the next connect initializes it again, until then initialized stays pending
        this.log.debug({ err }, "Connection lost while binding %s->%s.", source.name, destination.name);
        throw err;
      }
      this.log.error(
        { err },
        "Failed to create %s binding (%s->%s)",
        destination instanceof Queue ? "queue" : "exchange",
        source.name,
        destination.name,
      );
      delete destination.connection._bindings[Binding.id(destination, source, this.pattern)];
      this._deferred.reject(err as Error);
      throw err;
    }
  }

  /**
   * Deletes this binding of either a queue or an exchange.
   */
  public async delete(): Promise<void> {
    const destination = this._destination;
    await destination.initialized;
    if (destination instanceof Queue) {
      await destination._channel.unbindQueue(destination.name, this._source.name, this.pattern, this.args);
    } else {
      await destination._channel.unbindExchange(destination.name, this._source.name, this.pattern, this.args);
    }
    delete destination.connection._bindings[Binding.id(destination, this._source, this.pattern)];
  }
}
