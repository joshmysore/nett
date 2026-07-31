import { readFile } from "node:fs/promises";
import path from "node:path";

export interface LocalMcpServerManifest {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  cwd?: string;
  enabled: boolean;
  requestTimeoutMs?: number;
}

export interface ConnectorManifest {
  version: 1;
  servers: LocalMcpServerManifest[];
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) {
    throw new ManifestValidationError(`Manifest field "${field}" must be a non-empty single-line string`);
  }
  return value;
}

function parseServer(value: unknown, baseDirectory: string): LocalMcpServerManifest {
  if (!isRecord(value)) throw new ManifestValidationError("Each MCP server entry must be an object");
  const id = stringField(value, "id");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) {
    throw new ManifestValidationError(`Invalid MCP server id: ${id}`);
  }
  const rawCommand = stringField(value, "command");
  const rawArgs = value.args ?? [];
  if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new ManifestValidationError(`MCP server "${id}" args must be strings`);
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new ManifestValidationError(`MCP server "${id}" enabled must be boolean`);
  }
  if (value.requestTimeoutMs !== undefined &&
      (!Number.isInteger(value.requestTimeoutMs) || (value.requestTimeoutMs as number) < 100 ||
       (value.requestTimeoutMs as number) > 300_000)) {
    throw new ManifestValidationError(`MCP server "${id}" requestTimeoutMs is out of range`);
  }

  const cwd = value.cwd === undefined ? undefined : path.resolve(baseDirectory, stringField(value, "cwd"));
  const command = rawCommand.includes(path.sep)
    ? path.resolve(baseDirectory, rawCommand)
    : rawCommand;
  return {
    id,
    displayName: value.displayName === undefined ? id : stringField(value, "displayName"),
    command,
    args: rawArgs as string[],
    cwd,
    enabled: value.enabled !== false,
    requestTimeoutMs: value.requestTimeoutMs as number | undefined
  };
}

export async function loadConnectorManifest(
  manifestPath: string,
  options: { maxBytes?: number } = {}
): Promise<ConnectorManifest> {
  const maxBytes = options.maxBytes ?? 256 * 1024;
  const contents = await readFile(manifestPath);
  if (contents.byteLength > maxBytes) throw new ManifestValidationError("Connector manifest exceeds size limit");

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new ManifestValidationError(`Connector manifest is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.servers)) {
    throw new ManifestValidationError("Connector manifest must contain version 1 and a servers array");
  }

  const baseDirectory = path.dirname(path.resolve(manifestPath));
  const servers = parsed.servers.map((server) => parseServer(server, baseDirectory));
  const ids = new Set<string>();
  for (const server of servers) {
    if (ids.has(server.id)) throw new ManifestValidationError(`Duplicate MCP server id: ${server.id}`);
    ids.add(server.id);
  }
  return { version: 1, servers };
}
