import { resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { Client } from '@modelcontextprotocol/sdk/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

import { logger } from '@pi-code/shared/core/logger';

import type { TextContent, Tool } from '@modelcontextprotocol/sdk/types';
import type { McpConfig, McpServerConfig } from '@pi-code/extension/structures/agent-runtime/mcp/config';

const DEFAULT_TIMEOUT_MS = 30_000;

interface ToolOutput {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly toolResult?: unknown;
  readonly isError?: boolean;
}

export interface McpConnection {
  readonly listTools: () => Promise<readonly Tool[]>;
  readonly callTool: (tool: string, args: Record<string, unknown>, signal: AbortSignal | undefined) => Promise<ToolOutput>;
  readonly close: () => Promise<void>;
  readonly onClose: (listener: () => void) => void;
}

export type McpConnector = (server: McpServerConfig, cwd: string) => Promise<McpConnection>;

async function connectMcpServer(server: McpServerConfig, cwd: string): Promise<McpConnection> {
  const client = new Client({ name: 'pi-code', version: '0.0.1' });
  const timeoutMs = server.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const transport =
    server.kind === 'local'
      ? new StdioClientTransport({
          command: server.command,
          args: [...(server.args ?? [])],
          // The SDK default environment is a safe subset of process.env
          // (PATH, HOME, ...) that keeps `npx`-style launches working.
          env: { ...getDefaultEnvironment(), ...server.env },
          cwd: resolve(server.cwd ?? cwd),
        })
      : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { ...server.headers } } });

  await client.connect(transport, { timeout: timeoutMs });

  return {
    listTools: async () => {
      const result = await client.listTools(undefined, { timeout: timeoutMs });
      return result.tools;
    },

    callTool: (tool, args, signal) => {
      return client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeoutMs, signal });
    },

    close: () => client.close(),

    onClose: (listener) => {
      const previous = client.onclose;
      client.onclose = () => {
        previous?.();
        listener();
      };
    },
  };
}

interface DispatchParams {
  readonly server?: string;
  readonly tool?: string;
  readonly arguments?: Record<string, unknown>;
}

interface DispatchOutcome {
  readonly text: string;
  readonly isError?: boolean;
  readonly subtitle?: string;
}

interface CacheEntry {
  readonly identity: string;
  readonly pending: Promise<McpConnection>;
}

export function createMcpGateway(connect: McpConnector = connectMcpServer) {
  const cache = new Map<string, CacheEntry>();
  const live = new Set<string>();

  function forget(name: string, entry: CacheEntry): void {
    if (cache.get(name) !== entry) return;
    cache.delete(name);
    live.delete(name);
  }

  async function getConnection(name: string, server: McpServerConfig, cwd: string): Promise<McpConnection> {
    // The identity covers both the config and the workspace, so an edited or
    // relocated server definition replaces its running connection instead of
    // silently keeping the stale one alive.
    const identity = `${cwd}\n${JSON.stringify(server)}`;
    const cached = cache.get(name);
    if (cached?.identity === identity) return cached.pending;

    if (cached) {
      cache.delete(name);
      live.delete(name);
      void cached.pending.then((connection) => connection.close()).catch(() => {});
    }

    const entry: CacheEntry = { identity, pending: connect(server, cwd) };
    void entry.pending.then(
      (connection) => {
        live.add(name);
        // A crashed stdio child frees the slot so the next request reconnects.
        connection.onClose(() => forget(name, entry));
      },
      () => forget(name, entry),
    );
    cache.set(name, entry);
    return entry.pending;
  }

  return {
    isConnected: (name: string): boolean => live.has(name),

    preconnect: async (config: McpConfig, cwd: string): Promise<void> => {
      const eager = Object.entries(config).filter(([, server]) => server.autorun === true);
      await Promise.all(
        eager.map(async ([name, server]) => {
          try {
            await getConnection(name, server, cwd);
          } catch (err) {
            logger.warn(`Autorun MCP server "${name}" failed to start: ${formatThrownValue(err)}.`);
          }
        }),
      );
    },

    dispatch: async (config: McpConfig, cwd: string, params: DispatchParams, signal?: AbortSignal): Promise<DispatchOutcome> => {
      const names = Object.keys(config);

      if (names.length === 0) {
        return { text: 'Error: no MCP servers are configured.', isError: true };
      }

      if (params.server === undefined) {
        return formatServerCatalog(names, config, live);
      }

      const server = config[params.server];
      if (server === undefined) {
        return {
          text: `Error: unknown MCP server "${params.server}". Configured servers: ${names.join(', ')}.`,
          isError: true,
        };
      }

      let connection: McpConnection;
      try {
        connection = await getConnection(params.server, server, cwd);
      } catch (err) {
        return { text: `Error: MCP server "${params.server}" failed to start: ${formatThrownValue(err)}.`, isError: true };
      }

      if (params.tool === undefined) {
        try {
          return formatToolCatalog(params.server, await connection.listTools());
        } catch (err) {
          return {
            text: `Error: listing tools of MCP server "${params.server}" failed: ${formatThrownValue(err)}.`,
            isError: true,
          };
        }
      }

      try {
        const result = await connection.callTool(params.tool, params.arguments ?? {}, signal);
        return formatToolResult(params.server, params.tool, result);
      } catch (err) {
        return {
          text: [
            `Error: MCP tool "${params.tool}" on server "${params.server}" failed: ${formatThrownValue(err)}.`,
            `Call again with \`server\` set to "${params.server}" and no \`tool\` to see this server's available tools.`,
          ].join(' '),
          isError: true,
        };
      }
    },

    closeAll: async (): Promise<void> => {
      const entries = [...cache.values()];
      cache.clear();
      live.clear();
      await Promise.allSettled(
        entries.map(async (entry) => {
          const connection = await entry.pending.catch(() => undefined);
          await connection?.close();
        }),
      );
    },
  };
}

export const mcpGateway = createMcpGateway();

function formatServerCatalog(names: readonly string[], config: McpConfig, live: ReadonlySet<string>): DispatchOutcome {
  const lines = names.map((name) => `- ${name} (${config[name].kind}, ${live.has(name) ? 'running' : 'not started'})`);
  return {
    subtitle: `${names.length} servers`,
    text: ['## Configured MCP servers', '', ...lines, '', `Call again with \`server\` set to one name to list that server's tools.`].join('\n'),
  };
}

function formatToolCatalog(serverName: string, tools: readonly Tool[]): DispatchOutcome {
  if (tools.length === 0) {
    return { subtitle: `${serverName}: 0 tools`, text: `MCP server "${serverName}" exposes no tools.` };
  }

  const lines = [`## Tools exposed by "${serverName}"`, ''];
  for (const tool of tools) {
    lines.push(
      `### ${tool.name}`,
      tool.description?.trim() || 'No description provided.',
      '',
      `Parameters JSON Schema: ${JSON.stringify(tool.inputSchema ?? {})}`,
      '',
    );
  }
  return { subtitle: `${serverName}: ${tools.length} tools`, text: lines.join('\n').trimEnd() };
}

function isTextContent(part: unknown): part is TextContent {
  return typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text';
}

function resultBody(result: ToolOutput): string {
  const parts = (result.content ?? []).filter(isTextContent);
  const text = parts.map((part) => part.text).join('\n');
  if (text !== '') return text;

  const structured = result.structuredContent;
  if (structured !== undefined && structured !== null) return JSON.stringify(structured, null, 2);

  // Legacy servers wrap their payload here instead of using content parts.
  if (result.toolResult !== undefined && result.toolResult !== null) return JSON.stringify(result.toolResult, null, 2);
  return '(The tool returned no content.)';
}

function formatToolResult(serverName: string, toolName: string, result: ToolOutput): DispatchOutcome {
  return {
    subtitle: `${serverName}/${toolName}`,
    text: resultBody(result),
    isError: result.isError === true,
  };
}
