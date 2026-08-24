import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent';

import { logger } from '@pi-code/shared/core/logger';

interface LocalMcpServer {
  readonly kind: 'local';
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

interface RemoteMcpServer {
  readonly kind: 'remote';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type McpServerConfig = (LocalMcpServer | RemoteMcpServer) & {
  readonly autorun?: boolean;
  readonly description?: string;
  readonly timeoutMs?: number;
};

export type McpConfig = Readonly<Record<string, McpServerConfig>>;

export const MCP_CONFIG_FILE = 'mcp.json';

let activeConfig: McpConfig = {};

export function setActiveMcpConfig(config: McpConfig): void {
  activeConfig = config;
}

export function getActiveMcpConfig(): McpConfig {
  return activeConfig;
}

type ParsedServer = { ok: true; server?: McpServerConfig } | { ok: false; error: string };

export function parseMcpServer(raw: unknown): ParsedServer {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'entry must be an object' };
  }

  const record = raw as Record<string, unknown>;
  if (record['disabled'] === true) return { ok: true };

  const autorun = record['autorun'];
  if (autorun !== undefined && typeof autorun !== 'boolean') {
    return { ok: false, error: '`autorun` must be a boolean' };
  }

  const description = optionalDescription(record);
  const timeoutMs = optionalTimeout(record);
  const url = optionalUrl(record);
  const command = typeof record['command'] === 'string' ? record['command'] : undefined;

  if (url !== undefined && command !== undefined) {
    return { ok: false, error: 'specify either `command` or `url`, not both' };
  }

  if (url !== undefined) {
    const headers = optionalStringMap(record, 'headers');
    if (record['headers'] !== undefined && headers === undefined) {
      return { ok: false, error: '`headers` must map strings to strings' };
    }
    return {
      ok: true,
      server: {
        kind: 'remote',
        url,
        ...(headers && { headers }),
        ...(timeoutMs && { timeoutMs }),
        ...(autorun && { autorun }),
        ...(description && { description }),
      },
    };
  }

  if (command !== undefined) {
    if (command.trim() === '') return { ok: false, error: '`command` cannot be empty' };

    const args = optionalStrings(record, 'args');
    if (record['args'] !== undefined && args === undefined) return { ok: false, error: '`args` must be a list of strings' };

    const env = optionalStringMap(record, 'env');
    if (record['env'] !== undefined && env === undefined) return { ok: false, error: '`env` must map strings to strings' };

    const cwd = record['cwd'];
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.trim() === '')) {
      return { ok: false, error: '`cwd` must be a non-empty string' };
    }

    return {
      ok: true,
      server: {
        kind: 'local',
        command,
        ...(args && { args }),
        ...(env && { env }),
        ...(typeof cwd === 'string' && cwd.trim() !== '' && { cwd }),
        ...(timeoutMs && { timeoutMs }),
        ...(autorun && { autorun }),
        ...(description && { description }),
      },
    };
  }

  return { ok: false, error: 'needs either a local `command` or a remote `url`' };
}

export function mergeMcpConfigs(globalRaw: unknown, projectRaw: unknown): { config: McpConfig; warnings: readonly string[] } {
  const config: Record<string, McpServerConfig> = {};
  const warnings: string[] = [];

  const apply = (label: string, raw: unknown): void => {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(`Ignoring MCP servers from ${label}: expected an object at the top level.`);
      return;
    }

    for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
      const parsed = parseMcpServer(entry);
      if (!parsed.ok) {
        warnings.push(`Ignoring MCP server "${name}" from ${label}: ${parsed.error}.`);
        continue;
      }
      // A disabled entry removes the name outright, so a project can switch
      // off a global server by redefining its name with `disabled`: true.
      if (parsed.server) config[name] = parsed.server;
      else delete config[name];
    }
  };

  apply(`the global ${MCP_CONFIG_FILE}`, globalRaw);
  apply(`the project ${CONFIG_DIR_NAME}/${MCP_CONFIG_FILE}`, projectRaw);
  return { config, warnings };
}

interface LoadMcpConfigOptions {
  readonly trusted: boolean;
  readonly agentDir?: string;
}

export async function loadMcpConfig(cwd: string, options: LoadMcpConfigOptions): Promise<McpConfig> {
  const agentDir = options.agentDir ?? getAgentDir();
  const sources = [{ label: `the global ${MCP_CONFIG_FILE}`, path: join(agentDir, MCP_CONFIG_FILE) }];
  if (options.trusted) {
    sources.push({ label: `the project ${CONFIG_DIR_NAME}/${MCP_CONFIG_FILE}`, path: join(cwd, CONFIG_DIR_NAME, MCP_CONFIG_FILE) });
  }

  const reads = await Promise.all(sources.map((source) => readRawConfig(source.path, source.label)));
  const { config, warnings } = mergeMcpConfigs(reads[0]?.raw, reads[1]?.raw);

  for (const warning of [...reads.flatMap((read) => (read.warning ? [read.warning] : [])), ...warnings]) {
    logger.warn(warning);
  }
  return config;
}

async function readRawConfig(path: string, label: string): Promise<{ raw?: unknown; warning?: string }> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return { warning: `Could not read ${label}: ${formatThrownValue(err)}.` };
  }

  try {
    return { raw: JSON.parse(text) };
  } catch (err) {
    return { warning: `Could not parse ${label}: ${formatThrownValue(err)}.` };
  }
}

function optionalTimeout(record: Record<string, unknown>): number | undefined {
  const value = record['timeoutMs'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function optionalDescription(record: Record<string, unknown>): string | undefined {
  if (typeof record['description'] !== 'string') return undefined;
  const trimmed = record['description'].trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalUrl(record: Record<string, unknown>): string | undefined {
  const value = record['url'];
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined;
}

function optionalStrings(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return [...value];
}

function optionalStringMap(record: Record<string, unknown>, key: string): Readonly<Record<string, string>> | undefined {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!Object.values(value).every((item) => typeof item === 'string')) return undefined;
  return { ...(value as Record<string, string>) };
}
