/**
 * A promise together with the functions that settle it, for promises that are settled from somewhere else than
 * where they are created.
 *
 * A rejection is never reported as unhandled: the constructor attaches a no-op `catch`, because nobody has to await
 * an entity's `initialized` promise.
 */
export class Deferred<T> {
  public readonly promise: Promise<T>;
  private _resolve: (value: T) => void;
  private _reject: (err: Error) => void;
  private _settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this.promise.catch(() => {});
  }

  /** Whether {@link resolve} or {@link reject} has been called. */
  public get settled(): boolean {
    return this._settled;
  }

  public resolve(value: T): void {
    this._settled = true;
    this._resolve(value);
  }

  public reject(err: Error): void {
    this._settled = true;
    this._reject(err);
  }
}
