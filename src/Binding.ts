import type { Channel, ChannelModel } from "amqplib";
import type { Deferred } from "./Deferred.js";
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
   * created again after a lost connection. It rejects when the binding or one of its ends fails on its own, or when
   * the connection is closed or recovery gives up while it is pending.
   */
  public initialized: Promise<Binding>;
  /** @internal */
  public _source: Exchange;
  /** @internal */
  public _destination: Exchange | Queue;
  private log: SimpleLogger;
  private _deferred: Deferred<Binding>;
  /** The generation of the last initialization, and that initialization. */
  private _generation: number | undefined;
  private _initializing: Promise<void> = Promise.resolve();
  /** Changes with every initialization, so a superseded one can tell. */
  private _attempt = 0;
  /** The creation of the binding on the broker that is in flight, if any. Never rejects. */
  private _creating: Promise<void> = Promise.resolve();
  /** Set once {@link delete} was called, after which nothing creates the binding again. */
  private _deleting: Promise<void> | undefined;

  constructor(
    destination: Exchange | Queue,
    source: Exchange,
    private pattern = "",
    private args: any = {},
  ) {
    this.log = destination.connection.loggerFactory(this.constructor);
    this._source = source;
    this._destination = destination;
    const connection = this._destination.connection;
    this._deferred = connection._createDeferred<Binding>();
    this.initialized = this._deferred.promise;
    connection._bindings[Binding.id(this._destination, this._source, this.pattern)] = this;
    // while disconnected the next connect initializes it
    if (connection._model) {
      this._initialize(connection._model, connection._generation).catch(() => {});
    }
  }

  /**
   * Creates the binding on a short-lived channel of the given model once source and destination are initialized on
   * the given generation, then settles {@link initialized}. Does nothing if the binding was already initialized for the
   * given generation. A source on another connection is only waited for, its own connection initializes it.
   * @internal
   */
  public _initialize(model: ChannelModel, generation: number): Promise<void> {
    if (this._deleting !== undefined) {
      return this._initializing;
    }
    if (this._generation !== generation) {
      this._generation = generation;
      this._initializing = this._bind(model, generation, ++this._attempt);
    }
    return this._initializing;
  }

  /**
   * Creates every binding from or to the given entity again. Used after the entity's channel closed and the entity
   * was declared again, because a broker-side delete of an exchange or queue removes its bindings as well. Never
   * rejects, every binding handles its own failure. Only the bindings kept by the entity's own connection are created
   * again, so the given model is always that of their destination's connection.
   * @internal
   */
  public static async _rebindContaining(connectionPoint: Exchange | Queue, model: ChannelModel): Promise<void> {
    const bindings = Object.values(connectionPoint.connection._bindings).filter(
      (binding) => binding._source === connectionPoint || binding._destination === connectionPoint,
    );
    await Promise.allSettled(bindings.map((binding) => binding._rebind(model)));
  }

  /**
   * Creates the binding again on a short-lived channel of the given model, then resolves {@link initialized}. Unlike
   * {@link _initialize} it does not wait for source and destination.
   *
   * A failure is never final. The other end may be gone at this moment (for example an autoDelete exchange the broker
   * removed together with the queue), so the binding stays declared and {@link initialized} stays pending until the
   * other end re-initializes, which re-binds, or the next connect does. It also does not supersede a running
   * {@link _initialize}, which may still be waiting for a freshly declared end.
   *
   * A binding that was deleted or replaced by binding the same pair again meanwhile is settled right away, since
   * nothing would create it again.
   * @internal
   */
  public async _rebind(model: ChannelModel): Promise<void> {
    const destination = this._destination;
    const source = this._source;
    const connection = destination.connection;
    if (this._deleting !== undefined) {
      return;
    }
    this._invalidate();
    try {
      await this._create(model);
      if (!connection._isModelClosed(model)) {
        this._deferred.resolve(this);
      } else if (!this._isDeclared) {
        this._deferred.reject(new Error("Connection closed while the binding was created"));
      }
    } catch (err) {
      if (!this._isDeclared) {
        this._deferred.reject(err as Error);
        return;
      }
      if (connection._isModelClosed(model)) {
        // the next connect initializes it again, until then initialized stays pending
        return;
      }
      this.log.warn(
        { err },
        "Cannot re-create binding (%s->%s) yet, retrying when either end is declared again or on the next connect.",
        source.name,
        destination.name,
      );
    }
  }

  private get id(): string {
    return Binding.id(this._destination, this._source, this.pattern);
  }

  /** Whether this binding is still declared, i.e. neither deleted, replaced nor removed together with a failed end. */
  private get _isDeclared(): boolean {
    return this._destination.connection._bindings[this.id] === this;
  }

  /**
   * Replaces a settled {@link initialized} with a pending one, until the binding is created again.
   * @internal
   */
  public _invalidate(): void {
    if (this._deferred.settled) {
      this._deferred = this._destination.connection._createDeferred<Binding>();
      this.initialized = this._deferred.promise;
    }
  }

  /**
   * Rejects {@link initialized} if it is still pending. Used when the connection is closed, recovery gave up or an end
   * of the binding failed.
   * @internal
   */
  public _rejectPending(err: Error): void {
    if (!this._deferred.settled) {
      this._deferred.reject(err);
    }
  }

  /**
   * Whether the source exchange belongs to another connection than the destination. The binding belongs to the
   * destination's connection, while the source is initialized and recovered by its own connection only.
   * @internal
   */
  public get _isCrossConnection(): boolean {
    return this._source.connection !== this._destination.connection;
  }

  /**
   * Creates the binding on a short-lived channel of the given model. The creation is tracked, so {@link delete} can
   * wait for it instead of unbinding before it.
   */
  private _create(model: ChannelModel): Promise<void> {
    const destination = this._destination;
    const source = this._source;
    const creating = this._onOwnChannel(model, "Binding", (channel) =>
      destination instanceof Queue
        ? channel.bindQueue(destination.name, source.name, this.pattern, this.args)
        : channel.bindExchange(destination.name, source.name, this.pattern, this.args),
    );
    this._creating = creating.then(
      () => {},
      () => {},
    );
    return creating;
  }

  /**
   * Runs a bind or unbind on a short-lived channel of the given model. A failing bind or unbind closes the channel it
   * runs on, so it must not be the destination's channel, which would then re-initialize, nor one shared with other
   * bindings, which would then fail as well.
   */
  private async _onOwnChannel(
    model: ChannelModel,
    operation: string,
    run: (channel: Channel) => Promise<unknown>,
  ): Promise<void> {
    let channel: Channel | undefined;
    try {
      channel = await model.createChannel();
      channel.on("error", (err: Error) => {
        this.log.debug(
          { err },
          "%s %s->%s failed: %s",
          operation,
          this._source.name,
          this._destination.name,
          err.message,
        );
      });
      await run(channel);
    } finally {
      channel?.close().catch(() => {});
    }
  }

  private async _bind(model: ChannelModel, generation: number, attempt: number): Promise<void> {
    const destination = this._destination;
    const source = this._source;
    try {
      // both are initialized on this generation already, unless they were declared after it started. A source on
      // another connection is only waited for, as in 3.x: initializing it here would move it onto this connection
      await Promise.all([
        destination._initialize(model, generation),
        this._isCrossConnection ? source.initialized : source._initialize(model, generation),
      ]);
      if (attempt !== this._attempt) {
        return;
      }
      if (this._deleting !== undefined) {
        throw new Error(`Binding ${this.id} was deleted`);
      }
      await this._create(model);
      if (attempt !== this._attempt) {
        return;
      }
      if (destination.connection._isModelClosed(model)) {
        throw new Error("Connection closed while the binding was created");
      }
      this._deferred.resolve(this);
    } catch (err) {
      if (attempt !== this._attempt) {
        return;
      }
      if (!this._isDeclared) {
        // deleted, replaced or removed together with a failed end: nothing creates it again
        this._rejectPending(err as Error);
        throw err;
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
      destination.connection._onEntityFailed(this, err as Error, model, false);
      throw err;
    }
  }

  /**
   * Deletes this binding of either a queue or an exchange. It is no longer declared from then on, so nothing creates it
   * again, and an {@link initialized} that is still pending rejects. The unbind runs once the destination is
   * initialized, on a short-lived channel. Deleting it again returns the same promise, also after a failure.
   */
  public delete(): Promise<void> {
    this._deleting ??= this._delete();
    return this._deleting;
  }

  private async _delete(): Promise<void> {
    const destination = this._destination;
    const connection = destination.connection;
    if (this._isDeclared) {
      delete connection._bindings[this.id];
    }
    this._rejectPending(new Error(`Binding ${this.id} was deleted`));
    await destination.initialized;
    // a creation that is still in flight would create it again after the unbind
    await this._creating;
    const model = connection._activeModel;
    if (model === undefined) {
      throw new Error(`Connection lost while binding ${this.id} was deleted`);
    }
    await this._onOwnChannel(model, "Unbind", (channel) =>
      destination instanceof Queue
        ? channel.unbindQueue(destination.name, this._source.name, this.pattern, this.args)
        : channel.unbindExchange(destination.name, this._source.name, this.pattern, this.args),
    );
  }
}
