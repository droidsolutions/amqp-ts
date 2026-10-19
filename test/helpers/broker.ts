/**
 * Helpers to disturb a real RabbitMQ broker from tests: kill client connections through the management API
 * or restart the whole broker.
 */
import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";

const ManagementUrl = process.env.AMQPTEST_MANAGEMENT_URL || "http://guest:guest@localhost:15672";
const RestartCommand = process.env.AMQPTEST_RESTART_CMD || "podman restart rabbitmq";

interface ManagementTarget {
  base: string;
  headers: Record<string, string>;
}

// fetch refuses URLs with embedded credentials, so move them into an Authorization header
function getTarget(): ManagementTarget {
  const url = new URL(ManagementUrl);
  const headers: Record<string, string> = {};
  if (url.username || url.password) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }
  url.username = "";
  url.password = "";

  return { base: url.toString().replace(/\/$/, ""), headers };
}

interface BrokerConnection {
  name: string;
  client_properties?: { connection_name?: string };
}

/** Returns a connection name that is unique per call, to be passed as `clientProperties.connection_name`. */
export function uniqueConnectionName(): string {
  return `amqp-ts-test-${randomUUID()}`;
}

async function listMatching(base: string, headers: Record<string, string>, connectionName: string) {
  const response = await fetch(`${base}/api/connections`, { headers });
  if (!response.ok) {
    throw new Error(`Listing connections failed with HTTP ${response.status}`);
  }
  const connections = (await response.json()) as BrokerConnection[];

  return connections.filter((c) => c.client_properties?.connection_name === connectionName);
}

/**
 * Closes every broker connection with the given `connection_name` and returns how many were closed.
 * The management API lists a new connection only after its next statistics emission (seconds), so this waits up
 * to `timeoutMs` for at least one matching connection to show up before giving up and returning 0.
 */
export async function killConnections(connectionName: string, timeoutMs = 15_000): Promise<number> {
  const { base, headers } = getTarget();
  const deadline = Date.now() + timeoutMs;
  let matching = await listMatching(base, headers, connectionName);
  while (matching.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    matching = await listMatching(base, headers, connectionName);
  }
  for (const connection of matching) {
    const result = await fetch(`${base}/api/connections/${encodeURIComponent(connection.name)}`, {
      method: "DELETE",
      headers,
    });
    // 404 means the connection vanished in the meantime, which is fine
    if (!result.ok && result.status !== 404) {
      throw new Error(`Closing connection failed with HTTP ${result.status}`);
    }
  }

  return matching.length;
}

async function managementAnswers(): Promise<boolean> {
  const { base, headers } = getTarget();
  try {
    const response = await fetch(`${base}/api/overview`, { headers, signal: AbortSignal.timeout(2000) });

    return response.ok;
  } catch {
    return false;
  }
}

/** Restarts the broker with `AMQPTEST_RESTART_CMD` and resolves once the management API answers again. */
export async function restartBroker(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    exec(RestartCommand, (err) =>
      err ? reject(new Error(`Unable to restart broker: ${err.message}`, { cause: err })) : resolve(),
    );
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await managementAnswers()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Broker did not come back after restart");
}
