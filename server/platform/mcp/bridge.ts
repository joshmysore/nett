import type { LocalMcpServerManifest } from "./manifest.js";

export interface JsonRpcErrorData {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface LocalMcpBridge {
  readonly serverId: string;
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]>;
  callTool(name: string, arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
  close(): Promise<void>;
}

export class McpBridgeError extends Error {
  constructor(
    message: string,
    readonly code: "SDK_MISSING" | "CONNECT_FAILED" | "REQUEST_FAILED" | "INVALID_RESPONSE",
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "McpBridgeError";
  }
}

type DynamicImporter = (specifier: string) => Promise<Record<string, any>>;
const runtimeImport: DynamicImporter = new Function(
  "specifier",
  "return import(specifier)"
) as DynamicImporter;

interface SdkClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(options?: unknown, requestOptions?: unknown): Promise<unknown>;
  callTool(params: unknown, resultSchema?: unknown, requestOptions?: unknown): Promise<unknown>;
  close(): Promise<void>;
}

function abortOptions(signal: AbortSignal | undefined, timeoutMs: number): Record<string, unknown> {
  return signal ? { signal, timeout: timeoutMs } : { timeout: timeoutMs };
}

/**
 * Loads the MCP SDK only when a configured server is opened. This keeps the
 * module compilable before the parent application adds @modelcontextprotocol/sdk.
 */
export async function createSdkMcpBridge(manifest: LocalMcpServerManifest): Promise<LocalMcpBridge> {
  let clientModule: Record<string, any>;
  let transportModule: Record<string, any>;
  try {
    [clientModule, transportModule] = await Promise.all([
      runtimeImport("@modelcontextprotocol/sdk/client/index.js"),
      runtimeImport("@modelcontextprotocol/sdk/client/stdio.js")
    ]);
  } catch (error) {
    throw new McpBridgeError(
      "Local MCP support requires @modelcontextprotocol/sdk",
      "SDK_MISSING",
      { cause: error }
    );
  }

  const Client = clientModule.Client;
  const StdioClientTransport = transportModule.StdioClientTransport;
  if (typeof Client !== "function" || typeof StdioClientTransport !== "function") {
    throw new McpBridgeError("Installed MCP SDK does not expose the expected client API", "SDK_MISSING");
  }

  const timeoutMs = manifest.requestTimeoutMs ?? 30_000;
  const client = new Client(
    { name: "nett", version: "0.1.0" },
    { capabilities: {} }
  ) as SdkClientLike;
  // Deliberately do not pass `env`: credentials must not be exposed through a
  // child process environment. Connector-specific authentication uses a vault.
  const transport = new StdioClientTransport({
    command: manifest.command,
    args: manifest.args,
    cwd: manifest.cwd,
    stderr: "pipe"
  });
  let connected = false;

  return {
    serverId: manifest.id,
    async connect(signal) {
      if (connected) return;
      if (signal?.aborted) throw signal.reason;
      try {
        await client.connect(transport);
        connected = true;
      } catch (error) {
        throw new McpBridgeError(`Could not connect to MCP server "${manifest.id}"`, "CONNECT_FAILED", { cause: error });
      }
    },
    async listTools(signal) {
      try {
        const response = await client.listTools(undefined, abortOptions(signal, timeoutMs)) as {
          tools?: unknown;
        };
        if (!Array.isArray(response?.tools)) {
          throw new McpBridgeError("MCP tools response is invalid", "INVALID_RESPONSE");
        }
        return response.tools.map((tool: any) => ({
          name: String(tool.name),
          description: typeof tool.description === "string" ? tool.description : undefined,
          inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : {}
        }));
      } catch (error) {
        if (error instanceof McpBridgeError) throw error;
        throw new McpBridgeError(`Could not list tools from MCP server "${manifest.id}"`, "REQUEST_FAILED", { cause: error });
      }
    },
    async callTool(name, arguments_, signal) {
      if (!name) throw new McpBridgeError("MCP tool name is required", "REQUEST_FAILED");
      try {
        const response = await client.callTool(
          { name, arguments: arguments_ },
          undefined,
          abortOptions(signal, timeoutMs)
        ) as Record<string, unknown>;
        if (!Array.isArray(response?.content)) {
          throw new McpBridgeError("MCP tool response is invalid", "INVALID_RESPONSE");
        }
        return {
          content: response.content as Array<Record<string, unknown>>,
          isError: response.isError === true,
          structuredContent: response.structuredContent
        };
      } catch (error) {
        if (error instanceof McpBridgeError) throw error;
        throw new McpBridgeError(`MCP tool "${name}" failed`, "REQUEST_FAILED", { cause: error });
      }
    },
    async close() {
      connected = false;
      await client.close();
    }
  };
}
