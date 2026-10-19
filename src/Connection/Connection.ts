import { connect, type ChannelModel, type RecoveringChannelModel, type SocketOptions } from "amqplib";
import { EventEmitter } from "node:events";
import { Binding } from "../Binding.js";
import { Deferred } from "../Deferred.js";
import { DeclarationOptions as ExchangeDeclarationOptions } from "../Exchange/DeclarationOptions.js";
import { Exchange } from "../Exchange/Exchange.js";
import { ExchangeType } from "../Exchange/ExchangeType.js";
import { errorMessage } from "../errorMessage.js";
import { EmtpyLogger, LoggerFactory, SimpleLogger } from "../LoggerFactory.js";
import { DeclarationOptions as QueueDeclarationOptions } from "../Queue/DeclarationOptions.js";
import { Queue } from "../Queue/Queue.js";
import { ConnectionMetrics } from "./ConnectionMetrics.js";
import { RecoveryOptions } from "./RecoveryOptions.js";
import { Topology } from "./Topology.js";

export class Connection extends EventEmitter {
  /**
   * Resolves once the connection is established and the declared topology is initialized. It is replaced by a pending
   * promise when the connection is lost and resolves again after the next successful reconnect. It rejects when
   * recovery gives up or the connection is closed before it was established.
   */
  public initialized: Promise<void>;
  public isConnected = false;
  /**
   * The current underlying amqplib model, `undefined` while disconnected.
   * @internal
   */
  public _model: ChannelModel | undefined;
  /**
   * Identifies the current underlying model. Changes on each successful connect, so entities can tell whether they
   * are initialized on the current connection.
   * @internal
   */
  public _generation = 0;
  /** @internal */
  public _exchanges: {
    [id: string]: Exchange;
  };
  /** @internal */
  public _queues: {
    [id: string]: Queue;
  };
  /** @internal */
  public _bindings: {
    [id: string]: Binding;
  };

  private _deferred: Deferred<void>;
  private _recovering: Promise<RecoveringChannelModel>;
  /** Counter for connect attempts that reach `setup`; each of them gets its own generation. */
  private _lastGeneration = 0;
  /** The model `setup` is currently running for, and its generation. */
  private _setupModel: ChannelModel | undefined;
  private _setupGeneration = 0;
  private _closedModels = new WeakSet<ChannelModel>();
  private _connectedBefore = false;
  private _isClosing = false;
  private _closing: Promise<void> | undefined;
  /** Why recovery is over, set by {@link close} or when recovery gave up. Nothing is initialized after that. */
  private _stopError: Error | undefined;
  private log: SimpleLogger;
  private _sentMessagesCounter = 0;
  private _receivedMessagesCounter = 0;

  /**
   *
   * @param url The url to RabbitMQ
   * @param socketOptions Socket options are passed to amqplib's `connect`.
   * @param recovery Options for the automatic reconnect, passed to amqplib's connection recovery. By default it retries
   * forever with exponential backoff.
   * @param loggerFactory A factory function that returns a logger.
   */
  constructor(
    url = "amqp://localhost",
    socketOptions: SocketOptions = {},
    recovery: RecoveryOptions = {},
    public loggerFactory?: LoggerFactory,
  ) {
    super();
    if (!this.loggerFactory) {
      this.loggerFactory = (_, __): SimpleLogger => new EmtpyLogger();
    }
    this.log = this.loggerFactory(this.constructor, { module: "amqp-ts" });

    this._exchanges = {};
    this._queues = {};
    this._bindings = {};
    this._deferred = new Deferred<void>();
    this.initialized = this._deferred.promise;

    // waitForConnect: false resolves right away and defers the first attempt, so the listeners are attached in time
    this._recovering = connect(url, {
      ...socketOptions,
      recovery: { ...recovery, waitForConnect: false, setup: (model: ChannelModel) => this._setup(model) },
    });
    this._recovering.then(
      (recovering) => this._listen(recovering),
      /* istanbul ignore next */ (err: Error) => this._giveUp(err),
    );
  }

  public close(): Promise<void> {
    if (this._closing === undefined) {
      this._isClosing = true;
      // buffered sends and anyone awaiting initialized must not wait for a connection that never comes
      this._stop(new Error("Connection closed"));
      this._closing = this._close();
    }
    return this._closing;
  }

  /**
   * A new deferred for an entity's promise. Once the connection was closed or recovery gave up nothing would
   * ever settle it, so it is rejected right away.
   * @internal
   */
  public _createDeferred<T>(): Deferred<T> {
    const deferred = new Deferred<T>();
    if (this._stopError !== undefined) {
      deferred.reject(this._stopError);
    }
    return deferred;
  }

  /**
   * An exchange, queue or binding failed on its own, not because the connection was lost: it is no longer
   * declared and its {@link initialized} is rejected.
   *
   * The bindings of a failed exchange or queue can never be created any more, so they are rejected and removed as
   * well. The failure is emitted as `error_connection`, see {@link _reportFailure}.
   * @internal
   */
  public _onEntityFailed(entity: Exchange | Queue | Binding, err: Error): void {
    if (!(entity instanceof Binding)) {
      for (const [id, binding] of Object.entries(this._bindings)) {
        if (binding._source === entity || binding._destination === entity) {
          delete this._bindings[id];
          binding._rejectPending(err);
        }
      }
    }
    this._reportFailure(err);
  }

  /**
   * Emits `error_connection` for an exchange, queue, binding or consumer that failed on its own, whether it was
   * declared for the first time or again during recovery. Nobody has to await the entity's promise, for example after
   * a `declareQueue` nobody awaits or during recovery, so this is the one signal that always arrives.
   * @internal
   */
  public _reportFailure(err: Error): void {
    this._emitSafely("error_connection", err);
  }

  /**
   * The model entities are initialized on right now: the current one, or while `setup` runs the one it runs for.
   * `undefined` while disconnected.
   * @internal
   */
  public get _activeModel(): ChannelModel | undefined {
    return this._model ?? this._setupModel;
  }

  /**
   * Whether the given model has closed.
   * @internal
   */
  public _isModelClosed(model: ChannelModel): boolean {
    return this._closedModels.has(model);
  }

  /**
   * Whether a channel of the given model may be re-created after it closed: the model is open, and it is
   * either the current one or the one `setup` is running for.
   * @internal
   */
  public _isModelUsable(model: ChannelModel): boolean {
    return !this._isClosing && !this._closedModels.has(model) && (model === this._model || model === this._setupModel);
  }

  private async _close(): Promise<void> {
    const recovering = await this._recovering.catch((): undefined => undefined);
    if (recovering) {
      await recovering.close();
    }
    this._model = undefined;
    this.isConnected = false;
    this.log.info("AMQP Connection closed.");
    this._emitSafely("close_connection");
  }

  /**
   * Recovery is over, because of {@link close} or because it gave up: rejects every promise that is still pending,
   * the connection's and the entities', since nothing settles them any more.
   */
  private _stop(err: Error): void {
    this._stopError ??= err;
    if (!this._deferred.settled) {
      this._deferred.reject(err);
    }
    for (const exchange of Object.values(this._exchanges)) {
      exchange._rejectPending(err);
    }
    for (const queue of Object.values(this._queues)) {
      queue._rejectPending(err);
    }
    for (const binding of Object.values(this._bindings)) {
      binding._rejectPending(err);
    }
  }

  /**
   * Emits an event to the user's listeners. Most events are emitted from within amqplib's recovery, where a throwing
   * listener would stop the reconnect from being scheduled, or from a promise chain, where it would be an unhandled
   * rejection. So a listener's error is logged instead, and the listeners after it still get the event. The order is
   * that of `emit`, and `once` listeners remove themselves as usual.
   */
  private _emitSafely(event: string, ...args: unknown[]): void {
    for (const listener of this.rawListeners(event) as ((...args: unknown[]) => unknown)[]) {
      try {
        listener.apply(this, args);
      } catch (err) {
        this.log.error({ err }, "A listener for '%s' threw: %s", event, errorMessage(err));
      }
    }
  }

  private _listen(recovering: RecoveringChannelModel): void {
    recovering.on("connect", (model: ChannelModel) => this._onConnect(model));
    recovering.on("disconnect", (err: Error) => this._onDisconnect(err));
    recovering.on("connect-failed", (err: Error) => {
      this.log.warn({ err }, "Connection failed.");
    });
    recovering.on("reconnect-scheduled", ({ attempt, delay }: { attempt: number; delay: number }) => {
      this.log.warn("Connection retry %d in %d ms", attempt, delay);
      this._emitSafely("trying_connect");
    });
    recovering.on("reconnect-failed", (err: Error) => this._giveUp(err));
    recovering.on("error", (err: Error) => {
      this.log.warn({ err }, "Connection error: %s", err.message);
    });
    recovering.on("handler-error", (err: Error, event: string) => {
      this.log.error({ err }, "A listener for '%s' threw: %s", event, err.message);
    });
    recovering.on("blocked", (reason: string) => {
      this.log.warn("Connection blocked by the broker: %s", reason);
    });
    recovering.on("unblocked", () => {
      this.log.info("Connection unblocked by the broker.");
    });
  }

  /**
   * Runs after every successful (re)connect, before amqplib installs the model: rebuilds the topology on fresh
   * channels. It only throws when the model itself closed meanwhile, which makes amqplib schedule another reconnect.
   */
  private async _setup(model: ChannelModel): Promise<void> {
    const generation = ++this._lastGeneration;
    this._setupModel = model;
    this._setupGeneration = generation;
    // until amqplib installs the model it has no listeners on it, and an "error" without a listener would throw
    model.on("error", (err: Error) => {
      this.log.debug({ err }, "Connection error during setup: %s", err.message);
    });
    model.on("close", () => {
      this._closedModels.add(model);
    });

    this.log.debug("Initializing the topology on a new connection.");
    await this._declareEntities(model, generation);
    if (this._closedModels.has(model)) {
      throw new Error("Connection closed while the topology was initialized");
    }
  }

  /**
   * Initializes every entity that is not initialized on the given generation yet: exchanges, then queues, then
   * bindings, then queue consumers. Entity failures are handled by the entities themselves.
   *
   * A binding whose source exchange belongs to another connection waits for that connection, so it is not awaited:
   * an outage of the other connection must not hold up this one's recovery.
   */
  private async _declareEntities(model: ChannelModel, generation: number): Promise<void> {
    const settle = async (promises: Promise<void>[]): Promise<void> => {
      await Promise.allSettled(promises);
    };
    await settle(Object.values(this._exchanges).map((exchange) => exchange._initialize(model, generation)));
    await settle(Object.values(this._queues).map((queue) => queue._initialize(model, generation)));
    await settle(
      Object.values(this._bindings).flatMap((binding) => {
        const initializing = binding._initialize(model, generation);
        if (binding._isCrossConnection) {
          initializing.catch(() => {});
          return [];
        }
        return [initializing];
      }),
    );
    await settle(Object.values(this._queues).map((queue) => queue._initializeConsumer()));
  }

  private _onConnect(model: ChannelModel): void {
    const generation = this._setupGeneration;
    this._setupModel = undefined;
    this._model = model;
    this._generation = generation;
    this.isConnected = true;

    // entities declared while setup was running were not part of it
    void this._declareEntities(model, generation).then(() => {
      if (this._isClosing || this._model !== model) {
        return;
      }
      this._deferred.resolve();
      if (this._connectedBefore) {
        this.log.info("AMQP Connection re-established");
        this._emitSafely("re_established_connection");
      } else {
        this._connectedBefore = true;
        this.log.info("AQMP Connection established.");
        this._emitSafely("open_connection");
      }
    });
  }

  private _onDisconnect(err: Error): void {
    this._model = undefined;
    this.isConnected = false;
    for (const exchange of Object.values(this._exchanges)) {
      exchange._invalidate();
    }
    for (const queue of Object.values(this._queues)) {
      queue._invalidate();
    }
    for (const binding of Object.values(this._bindings)) {
      binding._invalidate();
    }
    this._invalidate();
    if (!this._isClosing) {
      this.log.warn({ err }, "Connection lost: %s", err.message);
      this._emitSafely("lost_connection");
    }
  }

  /** Recovery gave up: no further reconnect is attempted. */
  private _giveUp(err: Error): void {
    this._model = undefined;
    this.isConnected = false;
    this._invalidate();
    this._stop(err);
    this.log.warn({ err }, "Connection failed, giving up: %s", errorMessage(err));
    this._emitSafely("error_connection", err);
  }

  /** Replaces a settled {@link initialized} with a pending one. */
  private _invalidate(): void {
    if (this._deferred.settled) {
      this._deferred = new Deferred<void>();
      this.initialized = this._deferred.promise;
    }
  }

  /**
   * Make sure the whole defined connection topology is configured. Goes through each exchange, queue and binding and
   * waits until all of them are initialized.
   *
   * @return A promise that fulfills after all defined exchanges, queues and bindings are initialized.
   */
  public completeConfiguration(): Promise<any> {
    const promises: Promise<any>[] = [];
    for (const exchangeId in this._exchanges) {
      const exchange: Exchange = this._exchanges[exchangeId];
      promises.push(exchange.initialized);
    }
    for (const queueId in this._queues) {
      const queue: Queue = this._queues[queueId];
      promises.push(queue.initialized);
      if (queue._consumerInitialized !== undefined) {
        promises.push(queue._consumerInitialized);
      }
    }
    for (const bindingId in this._bindings) {
      const binding: Binding = this._bindings[bindingId];
      promises.push(binding.initialized);
    }
    return Promise.all(promises);
  }

  /**
   * Deletes the whole defined topology in phases: first the bindings, then the queues together with their consumers,
   * then the exchanges. Deleting a queue or an exchange deletes its bindings as well, so running the phases one after
   * the other unbinds every binding only once. A phase that fails does not stop the next one.
   *
   * @return A promise that fulfills after all defined exchanges, queues and bindings have been removed, and rejects
   * with the first failure otherwise.
   */
  public async deleteConfiguration(): Promise<any> {
    const failures: unknown[] = [];
    const phase = async (deletions: Promise<unknown>[]): Promise<void> => {
      for (const result of await Promise.allSettled(deletions)) {
        if (result.status === "rejected") {
          failures.push(result.reason);
        }
      }
    };
    await phase(Object.values(this._bindings).map((binding) => binding.delete()));
    // deleting a queue stops its consumer first
    await phase(Object.values(this._queues).map((queue) => queue.delete()));
    await phase(Object.values(this._exchanges).map((exchange) => exchange.delete()));
    if (failures.length > 0) {
      throw failures[0];
    }
  }

  /**
   * Declares a new exchange. Dependent on the options it auto creates the exchange if it does not already exists.
   *
   * @param name The name of the exchange.
   * @param type The type
   * @param options Options that are passed to assertExchange in amqp-lib.
   * @returns The declared queue. You need to await the initialization of the queue.
   */
  public declareExchange(name: string, type?: ExchangeType, options?: ExchangeDeclarationOptions): Exchange {
    let exchange = this._exchanges[name];
    if (exchange === undefined) {
      exchange = new Exchange(this, name, type, options);
    }

    return exchange;
  }

  /**
   * Declares an exchange and waits until it is initialized.
   *
   * @param name The name of the exchange.
   * @param type The exchange type.
   * @param options Any declaration options.
   * @returns A promise that resolves when the exchange is declared and initialized.
   */
  public async declareExchangeAsync(
    name: string,
    type?: ExchangeType,
    options?: ExchangeDeclarationOptions,
  ): Promise<Exchange> {
    const exchange = this.declareExchange(name, type, options);
    await exchange.initialized;

    return exchange;
  }

  /**
   * Declares a new queue.
   *
   * @param name The name of the queue.
   * @param options Any options for the queue declaration.
   * @returns The queue.
   */
  public declareQueue(name: string, options?: QueueDeclarationOptions): Queue {
    let queue = this._queues[name];
    if (queue === undefined) {
      queue = new Queue(this, name, options);
    }
    return queue;
  }

  /**
   * Declares a new queue and waits until it is intitialized.
   *
   * @param name The name of the queue.
   * @param options Any options for the queue declaration.
   * @returns A promise that resolves when the queue is declared and initialized.
   */
  public async declareQueueAsync(name: string, options?: QueueDeclarationOptions): Promise<Queue> {
    const queue = this.declareQueue(name, options);
    await queue.initialized;

    return queue;
  }

  public declareTopology(topology: Topology): Promise<any> {
    const promises: Promise<any>[] = [];
    let i: number;
    let len: number;
    if (topology.exchanges !== undefined) {
      for (i = 0, len = topology.exchanges.length; i < len; i++) {
        const exchange = topology.exchanges[i];
        promises.push(
          this.declareExchange(exchange.name, exchange.type, exchange.options as ExchangeDeclarationOptions)
            .initialized,
        );
      }
    }
    if (topology.queues !== undefined) {
      for (i = 0, len = topology.queues.length; i < len; i++) {
        const queue = topology.queues[i];
        promises.push(this.declareQueue(queue.name, queue.options as QueueDeclarationOptions).initialized);
      }
    }
    if (topology.bindings !== undefined) {
      for (i = 0, len = topology.bindings.length; i < len; i++) {
        const binding = topology.bindings[i];
        const source = this.declareExchange(binding.source);
        let destination: Queue | Exchange;
        if (binding.exchange !== undefined) {
          destination = this.declareExchange(binding.exchange);
        } else {
          destination = this.declareQueue(binding.queue);
        }
        promises.push(destination.bind(source, binding.pattern, binding.args));
      }
    }
    return Promise.all(promises);
  }

  /** The current underlying amqplib model, `undefined` while disconnected. */
  public get getConnection(): ChannelModel | undefined {
    return this._model;
  }

  /**
   * Returns an object with metrics about the connection.
   * @returns An object containing metrics about the connection.
   */
  public getMetrics(): ConnectionMetrics {
    return {
      receivedMessagesCounter: this._receivedMessagesCounter,
      sentMessagesCounter: this._sentMessagesCounter,
    };
  }

  /**
   * Increments an internal counter.
   * @param counter The counter to increase.
   * @param value The increment, default is 1.
   * @internal
   */
  public _increaseCounter(counter: "receivedMessages" | "sentMessages", value = 1): void {
    switch (counter) {
      case "receivedMessages":
        this._receivedMessagesCounter += value;
        break;
      case "sentMessages":
        this._sentMessagesCounter += value;
        break;
    }
  }
}
