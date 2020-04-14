/* eslint-disable @typescript-eslint/no-empty-function */
/**
 * A function that retrieves an instance of a logger.
 */
export interface LoggerFactory {
  (context: Function | string, meta?: { [key: string]: any }): SimpleLogger;
}

/**
 * A simple logger that logs messages.
 */
export interface SimpleLogger {
  /** Logs with trace level. */
  trace: LogFunction;
  /** Logs with debug level. */
  debug: LogFunction;
  /** Logs with info level. */
  info: LogFunction;
  /** Logs with warn level. */
  warn: LogFunction;
  /** Logs with error level. */
  error: LogFunction;
  /** Logs with fatal level. */
  fatal: LogFunction;
}

/**
 * A function that writes logs.
 */
interface LogFunction {
  /**
   * Logs a message template where %d, %s and %o are replaced by the given args in their order.
   */
  (msg: string, ...args: any[]): void;
  /**
   * Logs an object with it's properties and a message template where %d, %s and %o are replaced by the given args in
   * their order.
   */
  (obj: object, msg?: string, ...args: any[]): void;
}

export class EmtpyLogger implements SimpleLogger {
  trace(_obj: object | string, _msg?: string, ..._args: any[]): void {}
  debug(_obj: object | string, _msg?: string, ..._args: any[]): void {}
  info(_obj: object | string, _msg?: string, ..._args: any[]): void {}
  warn(_obj: object | string, _msg?: string, ..._args: any[]): void {}
  error(_obj: object | string, _msg?: string, ..._args: any[]): void {}
  fatal(_obj: object | string, _msg?: string, ..._args: any[]): void {}
}
