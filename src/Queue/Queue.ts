/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import type { Channel, ChannelModel, ConsumeMessage, Options } from "amqplib";
import type { AmqpProperties } from "../AmqpProperties.js";
import { Binding } from "../Binding.js";
import { Connection } from "../Connection/Connection.js";
import type { Deferred } from "../Deferred.js";
import { Exchange } from "../Exchange/Exchange.js";
import { SimpleLogger } from "../LoggerFactory.js";
import { Message } from "../Message.js";
import { DeclarationOptions } from "./DeclarationOptions.js";
import { DeleteResult } from "./DeleteResult.js";
import { InitializeResult } from "./InitializeResult.js";
import { StartConsumerResult } from "./StartConsumerResult.js";

/** Represents an AQMP queue. */
export class Queue {
  /** A broker-side consumer cancel this soon after the consumer was registered again does not re-initialize. */
  private static readonly CancelLoopWindowMs = 1000;

  /**
   * A promise that resolves once the connection is initialized and the queue is declared on its channel. It is
   * replaced by a pending promise while the queue is re-initialized after a lost connection or a closed channel. It
   * rejects when the queue fails on its own, or when the connection is closed or recovery gives up while it is pending.
   */
  public initialized: Promise<InitializeResult>;
  /**
   * The AMQP channel.
   * @internal
   */
  public _channel: Channel;
  /**
   * A promise that resolves when a consumer handler is registered and initialized.
   * @internal
   */
  public _consumerInitialized: Promise<StartConsumerResult>;
  private _name: string;
  /** @internal */
  _consumer: (msg: any, channel?: Channel) => any;
  private _consumerOptions: Options.Consume & { properties?: AmqpProperties };
  private _consumerTag: string;
  private _consumerStopping: boolean;
  private _deleting: Promise<DeleteResult>;
  private _closing: Promise<void>;
  private log: SimpleLogger;
  private _deferred: Deferred<InitializeResult>;
  private _consumerDeferred: Deferred<StartConsumerResult> | undefined;
  /** The generation of the last initialization, and that initialization. */
  private _generation: number | undefined;
  private _initializing: Promise<void> = Promise.resolve();
  /** Changes with every initialization, so a superseded one can tell. */
  private _attempt = 0;
  /** The channel the queue was successfully declared on, and its model. */
  private _readyChannel: Channel | undefined;
  private _readyModel: ChannelModel | undefined;
  /** The channel the consumer is registered on, or being registered on. */
  private _consumerChannel: Channel | undefined;
  private _consuming: Promise<void> = Promise.resolve();
  /** The generation in which a broker-side consumer cancel made the queue re-initialize, until it re-consumed. */
  private _cancelReinitGeneration: number | undefined;
  /**
   * When the current consumer was registered by a re-initialization after a broker-side cancel. Another cancel within
   * {@link Queue.CancelLoopWindowMs} of that does not re-initialize again, which stops a cancel loop.
   */
  private _cancelRecoveredAt: number | undefined;
  /**
   * The generation in which the broker refused the consumer. Registering it again on the same connection would be
   * refused again, so it is only registered again after the next reconnect.
   */
  private _consumerRefusedIn: number | undefined;
  /** Why the queue failed on its own, after which it is no longer declared. */
  private _failure: Error | undefined;
  /** Counts deliveries; bound once so it can be removed again. */
  private readonly _onDelivery = (): void => {
    this.connection._increaseCounter("receivedMessages");
  };

  /** Returns the name of the queue. */
  public get name(): string {
    return this._name;
  }

  /**
   * Initializes a new instance of the @see Queue class.
   *
   * @summary Waits until the given connection is initialized, then creates a channel on it and declares a queue with
   * the given name.
   * @param connection The AMQP connection.
   * @param name The name of the queue.
   * @param options Any queue declaring options.
   * @constructor
   */
  constructor(
    public connection: Connection,
    name: string,
    private options: DeclarationOptions = {},
  ) {
    this.log = this.connection.loggerFactory(this.constructor, { queue: name });

    this._name = name;
    this._deferred = this.connection._createDeferred<InitializeResult>();
    this.initialized = this._deferred.promise;
    this.connection._queues[this._name] = this;
    // while disconnected the next connect initializes it
    if (this.connection._model) {
      this._initialize(this.connection._model, this.connection._generation).catch(() => {});
    }
  }

  /**
   * Creates a channel on the given model and declares the queue on it, then settles {@link initialized}. Does nothing
   * if the queue was already initialized for the given generation. The consumer is started by
   * {@link _initializeConsumer}.
   * @internal
   */
  public _initialize(model: ChannelModel, generation: number): Promise<void> {
    if (this.connection._queues[this._name] !== this) {
      // failed, closed or deleted: only a new declaration brings it back
      return Promise.reject(this._failure ?? new Error(`Queue '${this._name}' is no longer declared`));
    }
    if (this._generation !== generation) {
      this._generation = generation;
      this._initializing = this._declare(model, ++this._attempt);
    }
    return this._initializing;
  }

  /**
   * Replaces a settled {@link initialized} (and consumer promise) with a pending one, until the queue is initialized
   * again.
   * @internal
   */
  public _invalidate(): void {
    this._readyChannel = undefined;
    this._pendInitialized();
    if (this._consumerDeferred?.settled) {
      this._consumerDeferred = this.connection._createDeferred<StartConsumerResult>();
      this._consumerInitialized = this._consumerDeferred.promise;
    }
  }

  /** Replaces a settled {@link initialized} with a pending one. */
  private _pendInitialized(): void {
    if (this._deferred.settled) {
      this._deferred = this.connection._createDeferred<InitializeResult>();
      this.initialized = this._deferred.promise;
    }
  }

  /**
   * Rejects {@link initialized} and the consumer promise if they are still pending. Used when the connection is closed
   * or recovery gave up.
   * @internal
   */
  public _rejectPending(err: Error): void {
    if (!this._deferred.settled) {
      this._deferred.reject(err);
    }
    if (this._consumerDeferred?.settled === false) {
      this._consumerDeferred.reject(err);
    }
  }

  /**
   * Registers the consumer, if there is one, on the channel the queue is declared on, unless it already is
   * registered there or the broker refused it on this connection. The consumer promise is pending until the
   * registration is done.
   * @internal
   */
  public _initializeConsumer(): Promise<void> {
    const channel = this._readyChannel;
    if (
      this._consumer === undefined ||
      channel === undefined ||
      channel === this._consumerChannel ||
      this._consumerRefusedIn === this._generation
    ) {
      return this._consuming;
    }
    if (this._consumerDeferred.settled) {
      this._consumerDeferred = this.connection._createDeferred<StartConsumerResult>();
      this._consumerInitialized = this._consumerDeferred.promise;
    }
    this._consumerChannel = channel;
    this._consuming = this._consume(channel, this._readyModel);
    return this._consuming;
  }

  /**
   * Re-creates the channel after it closed while the connection stayed up, declares the queue again and restores its
   * bindings, which a broker-side delete removes as well. Only then {@link initialized} resolves. The caller registers
   * the consumer again.
   */
  private _reinitialize(model: ChannelModel, generation: number): Promise<void> {
    this._generation = generation;
    this._initializing = this._declare(model, ++this._attempt, true);
    return this._initializing;
  }

  private async _declare(model: ChannelModel, attempt: number, rebind = false): Promise<void> {
    try {
      const channel = await model.createChannel();
      channel.on("error", (err: Error) => {
        this.log.warn({ err }, "Channel of queue '%s' failed: %s", this._name, err.message);
      });
      channel.on("close", () => this._onChannelClose(channel, model));
      if (attempt !== this._attempt) {
        await channel.close().catch(() => {});
        return;
      }
      this._channel = channel;
      channel.on("delivery", this._onDelivery);

      const ok = this.options.noCreate
        ? await channel.checkQueue(this._name)
        : await channel.assertQueue(this._name, this.options);
      if (this.options.prefetch) {
        await channel.prefetch(this.options.prefetch);
      }
      if (attempt !== this._attempt) {
        await channel.close().catch(() => {});
        return;
      }
      this._readyChannel = channel;
      this._readyModel = model;
      if (rebind) {
        await Binding._rebindContaining(this, model);
        if (attempt !== this._attempt) {
          return;
        }
      }
      // a reply and the connection's close can arrive together: never resolve on a closed connection
      if (this.connection._isModelClosed(model)) {
        throw new Error("Connection closed while the queue was initialized");
      }
      this._deferred.resolve(ok);
    } catch (err) {
      if (attempt !== this._attempt) {
        return;
      }
      if (this.connection._isModelClosed(model)) {
        // the next connect initializes it again, until then initialized stays pending
        this.log.debug({ err }, "Connection lost while initializing queue '%s'.", this._name);
        throw err;
      }
      this.log.error({ err }, "Failed to create queue '%s'.", this._name);
      delete this.connection._queues[this._name];
      this._failure = err as Error;
      // the consumer cannot be registered on a queue that failed
      this._rejectPending(err as Error);
      this.connection._onEntityFailed(this, err as Error);
      throw err;
    }
  }

  /**
   * Registers the consumer on the given channel. A refusal (for example 403 because another connection holds an
   * exclusive consumer) is also reported through `error_connection`, since during recovery the consumer would
   * otherwise stop silently.
   */
  private async _consume(channel: Channel, model: ChannelModel): Promise<void> {
    const options = this._consumerOptions;
    try {
      const ok = await channel.consume(
        this._name,
        this._createConsumerWrapper(channel, options?.noAck === true),
        options,
      );
      if (channel !== this._consumerChannel) {
        // stopped or registered elsewhere meanwhile, but the broker registered it all the same
        this._cancelSuperseded(channel, ok.consumerTag);
        return;
      }
      if (this.connection._isModelClosed(model)) {
        throw new Error("Connection closed while the consumer was registered");
      }
      this._consumerTag = ok.consumerTag;
      const recovered = this._cancelReinitGeneration !== undefined && this._cancelReinitGeneration === this._generation;
      this._cancelRecoveredAt = recovered ? Date.now() : undefined;
      this._cancelReinitGeneration = undefined;
      this._consumerDeferred.resolve(ok);
    } catch (err) {
      if (channel !== this._consumerChannel || this.connection._isModelClosed(model)) {
        // superseded, or the next connect registers it again
        throw err;
      }
      this.log.error({ err }, "Failed to start the consumer of queue '%s'.", this._name);
      this._consumerRefusedIn = this._generation;
      this._consumerDeferred.reject(err as Error);
      this.connection._reportFailure(err as Error);
      throw err;
    }
  }

  /** Cancels a consumer registration that completed after it was superseded, so it does not keep receiving messages. */
  private _cancelSuperseded(channel: Channel, consumerTag: string): void {
    Promise.resolve()
      .then(() => channel.cancel(consumerTag))
      .catch((err: Error) => {
        this.log.debug({ err }, "Cancelling a superseded consumer of queue '%s' failed: %s", this._name, err.message);
      });
  }

  /**
   * A channel that closes while the connection stays up (for example after a double ack) is re-created, the queue
   * declared again and its consumer registered again. Closes during a failed declaration or consumer registration, on
   * a lost connection or caused by {@link close} or {@link delete} are left alone.
   */
  private _onChannelClose(channel: Channel, model: ChannelModel): void {
    if (channel !== this._readyChannel || this._closing !== undefined || this._deleting !== undefined) {
      return;
    }
    // a consumer registration that the broker refused closes the channel as well; retrying it would loop
    const consumeFailed = channel === this._consumerChannel && this._consumerDeferred?.settled === false;
    const generation = this._generation;
    this._invalidate();
    // the connection emits its own close right after closing its channels, so look at it once that happened
    queueMicrotask(() => {
      if (!this.connection._isModelUsable(model) || this._generation !== generation) {
        return;
      }
      this.log.warn("Channel of queue '%s' closed, re-initializing it.", this._name);
      this._reinitialize(model, generation)
        .then(() => (consumeFailed ? undefined : this._initializeConsumer()))
        .catch(() => {});
    });
  }

  /**
   * Directly sends a message to the underlying queue.
   *
   * @param message The AMQP message.
   */
  public send(message: Message): void {
    message.sendTo(this);
  }

  /**
   * Sets the prefetch of the current quere. This limits the amount of unacknowledged messages on a channel. If you
   * already specified this in the options in the constructor you don't need to set it here again.
   *
   * For more information see {@link https://www.rabbitmq.com/consumer-prefetch.html}.
   * @param count The maximum number of unacknowledged messages send to each listener of this queue.
   */
  prefetch(count: number): void {
    this.initialized.then(
      () => {
        this._channel.prefetch(count).catch((err: Error) => {
          this.log.warn({ err }, "Setting the prefetch of queue '%s' failed.", this._name);
        });
        this.options.prefetch = count;
      },
      (err: Error) => {
        this.log.warn({ err }, "Cannot set the prefetch of queue '%s', it failed to initialize.", this._name);
      },
    );
  }

  async recover(): Promise<void> {
    await this.initialized;
    await this._channel.recover();
  }

  /**
   * Actives a consumer by binding the given handler to this queue.
   *
   * @param onMessage The message handler that is executed when a new message arrives.
   * @param options Options for underlying amqplib. See
   * {@link https://www.squaremobius.net/amqp.node/channel_api.html#channel_consume} for more info. You can also
   * specify AMQP properties to set on reply messages that are fired when the given onMessage handler returns anything.
   * @throws {Error} Rejects when a consumer is already bound to this queue.
   * @returns A promise that resolves once the handler is bound to the queue.
   */
  public activateConsumer(
    onMessage: (msg: Message) => any,
    options: Options.Consume & { properties?: AmqpProperties } = {},
  ): Promise<StartConsumerResult> {
    if (this._consumerInitialized !== undefined) {
      return Promise.reject(new Error("amqp-ts Queue.activateConsumer error: consumer already defined"));
    }

    this._consumerOptions = options;
    this._consumer = onMessage;
    delete this._consumerRefusedIn;
    this._consumerDeferred = this.connection._createDeferred<StartConsumerResult>();
    this._consumerInitialized = this._consumerDeferred.promise;
    // registers right away if the queue is ready, otherwise once it is; a reconnect registers it as well
    this.initialized.then(
      () => this._initializeConsumer().catch(() => {}),
      (err: Error) => this._consumerDeferred?.reject(err),
    );

    return this._consumerInitialized;
  }

  /**
   * Wraps the consumer handler for messages delivered on the given channel. A message that arrives after the consumer
   * was stopped, before the broker confirmed the cancel, is given back to the queue for another consumer; one that
   * needs no acknowledgement cannot be given back.
   */
  private _createConsumerWrapper(channel: Channel, noAck: boolean): (msg: ConsumeMessage | null) => void {
    return (msg: ConsumeMessage | null): void => {
      if (msg === null) {
        this._onConsumerCancelled(channel);
        return;
      }
      if (this._consumer === undefined) {
        this.log.debug("Message for the stopped consumer of queue '%s', requeuing it.", this._name);
        if (!noAck) {
          try {
            channel.nack(msg, false, true);
          } catch (err) {
            // the channel closed meanwhile, which requeues it as well
            this.log.debug({ err }, "Requeuing a message of queue '%s' failed.", this._name);
          }
        }
        return;
      }
      try {
        const message = new Message(msg.content, msg.properties);
        message.fields = msg.fields;
        message._message = msg;
        message._channel = channel;
        const result = this._consumer(message);
        // convert the result to a promise if it isn't one already
        Promise.resolve(result)
          .then((resultValue) => {
            // check if there is a reply-to
            if (msg.properties.replyTo && resultValue) {
              if (!(resultValue instanceof Message)) {
                resultValue = new Message(resultValue, this._consumerOptions.properties ?? {});
              }
              resultValue.properties.correlationId = msg.properties.correlationId;

              this.log.debug("Replying directly to queue %s", msg.properties.replyTo);
              channel.sendToQueue(
                msg.properties.replyTo as string,
                resultValue.content as Buffer,
                resultValue.properties as Options.Publish,
              );
            }
          })
          .catch((err) => {
            this.log.error(
              { err, correlationId: msg.properties.correlationId, consumerTag: msg.fields.consumerTag },
              "Replying on message %s throw an error: %s",
              msg.properties.correlationId,
              err.message,
            );
          });
      } catch (err) {
        /* istanbul ignore next */
        this.log.error(
          { err, correlationId: msg.properties.correlationId, consumerTag: msg.fields.consumerTag },
          "Consuming the message %s returned error: %s",
          msg.properties.correlationId,
          err.message,
        );
      }
    };
  }

  /**
   * The broker cancelled the consumer, for example because the queue was deleted. The channel stays open, so nothing
   * else would notice: close it, which re-declares the queue, restores its bindings and registers the consumer again
   * through the channel close handling. A `noCreate` queue that is gone then fails like any failed declaration.
   */
  private _onConsumerCancelled(channel: Channel): void {
    if (
      channel !== this._consumerChannel ||
      channel !== this._readyChannel ||
      this._closing !== undefined ||
      this._deleting !== undefined
    ) {
      return;
    }
    if (this._cancelRecoveredAt !== undefined && Date.now() - this._cancelRecoveredAt < Queue.CancelLoopWindowMs) {
      const err = new Error(
        `The consumer of queue '${this._name}' was cancelled by the broker again right after it was registered ` +
          "again; it is registered again on the next reconnect.",
      );
      this.log.error({ err }, "%s", err.message);
      // the consumer is gone until then, nobody would notice otherwise
      this.connection._reportFailure(err);
      return;
    }
    this.log.warn("The consumer of queue '%s' was cancelled by the broker, re-initializing the queue.", this._name);
    this._cancelReinitGeneration = this._generation;
    // a publish fails until the broker confirmed the close, so sends must wait for the re-initialization instead of
    // taking the channel for closed on purpose; the close handling still needs the ready channel
    this._pendInitialized();
    channel.close().catch(() => {});
  }

  /**
   * Completely removes the consumer handler and cancels the consumer on the broker. A consumer the broker refused has
   * nothing to cancel, it is only removed. A consumer whose channel closes meanwhile is registered again on a new one,
   * so that registration is waited for and cancelled instead.
   */
  public async stopConsumer(): Promise<void> {
    if (this._consumerStopping || this._consumerInitialized == undefined) {
      return;
    }
    this._consumerStopping = true;
    try {
      for (;;) {
        const consumer = this._consumerInitialized;
        const registered = await consumer.then(
          () => true,
          () => false,
        );
        if (this._consumerInitialized !== consumer) {
          // invalidated meanwhile, a registration is under way again
          continue;
        }
        if (!registered) {
          break;
        }
        try {
          await this._consumerChannel.cancel(this._consumerTag);
          break;
        } catch (err) {
          if (this._consumerInitialized === consumer) {
            throw err;
          }
          // the channel closed while cancelling and the consumer is being registered again
        }
      }
    } finally {
      // a failed cancel can be retried
      delete this._consumerStopping;
    }
    delete this._consumerInitialized;
    delete this._consumerDeferred;
    delete this._consumer;
    delete this._consumerOptions;
    delete this._consumerChannel;
    delete this._consumerRefusedIn;
  }

  /**
   * Removes any bindings of this queue, the consumer handler and then deletes the queue.
   */
  delete(): Promise<DeleteResult> {
    if (this._deleting === undefined) {
      this._deleting = (async (): Promise<DeleteResult> => {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        await this.stopConsumer();
        const ok = await this._channel.deleteQueue(this._name, {});
        delete this.connection._queues[this._name]; // remove the queue from our administration
        this._channel.removeListener("delivery", this._onDelivery);
        await this._channel.close();
        return ok;
      })();
    }
    return this._deleting;
  }

  /**
   * Remoevs bindings of this queue as well as the consumer handler and then closes the AMQP channel.
   */
  close(): Promise<void> {
    if (this._closing === undefined) {
      this._closing = (async (): Promise<void> => {
        await this.initialized;
        await Binding.removeBindingsContaining(this);
        await this.stopConsumer();
        delete this.connection._queues[this._name]; // remove the queue from our administration
        this._channel.removeListener("delivery", this._onDelivery);
        await this._channel.close();
      })();
    }
    return this._closing;
  }

  /**
   * Binds the queue to the given exchange.
   *
   * @param source The exchange on which to bind the queue.
   * @param pattern The pattern to use.
   * @param args Any arguments.
   */
  public bind(source: Exchange, pattern = "", args: any = {}): Promise<Binding> {
    const binding = new Binding(this, source, pattern, args);
    return binding.initialized;
  }

  /**
   * Unbinds the queue from the given exchange by deleting the binding. Resolves right away if there is no such
   * binding, for example because it was unbound before.
   *
   * @param source The exchange to unbind from.
   * @param pattern The pattern the queue was bind with.
   * @param _args Any additional arguments.
   */
  public async unbind(source: Exchange, pattern = "", _args: any = {}): Promise<void> {
    // a binding that does not exist (any more) has nothing to delete
    await this.connection._bindings[Binding.id(this, source, pattern)]?.delete();
  }
}
