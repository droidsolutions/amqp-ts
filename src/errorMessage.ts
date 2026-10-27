/**
 * The message of an error for log lines. A failed connect can reject with an `AggregateError` (one error per
 * address of the host) whose own message is empty, so this falls back to the first inner error's message.
 * @internal
 */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return typeof err === "string" ? err : "unknown error";
  }
  if (err.message === "" && err instanceof AggregateError) {
    const first: unknown = err.errors[0];
    if (first instanceof Error && first.message !== "") {
      return first.message;
    }
  }
  return err.message;
}
