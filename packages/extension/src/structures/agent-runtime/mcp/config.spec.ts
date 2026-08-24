import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadMcpConfig, MCP_CONFIG_FILE, mergeMcpConfigs, parseMcpServer } from '@pi-code/extension/structures/agent-runtime/mcp/config';

describe('parseMcpServer', () => {
  it('rejects entries that are neither local nor remote', () => {
    expect(parseMcpServer({})).toMatchObject({ ok: false });
    expect(parseMcpServer('nope')).toMatchObject({ ok: false });
  });

  it('rejects entries that define both a command and a url', () => {
    expect(parseMcpServer({ command: 'x', url: 'https://a.example' })).toMatchObject({ ok: false });
  });

  it('rejects remote urls without an http scheme', () => {
    expect(parseMcpServer({ url: 'ftp://a.example' })).toMatchObject({ ok: false });
  });
});

describe('mergeMcpConfigs', () => {
  it('parses local and remote servers into typed configs', () => {
    const { config, warnings } = mergeMcpConfigs(
      {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: { DEBUG: '1' }, cwd: '/srv' },
        web: { url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer t' }, timeoutMs: 60_000 },
      },
      undefined,
    );

    expect(warnings).toEqual([]);
    expect(config['fs']).toEqual({
      kind: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { DEBUG: '1' },
      cwd: '/srv',
    });
    expect(config['web']).toEqual({
      kind: 'remote',
      url: 'https://mcp.example/mcp',
      headers: { Authorization: 'Bearer t' },
      timeoutMs: 60_000,
    });
  });

  it('keeps the autorun flag when true and omits it otherwise', () => {
    const { config, warnings } = mergeMcpConfigs(
      { hot: { command: 'npx', autorun: true }, web: { url: 'https://mcp.example/mcp', autorun: false } },
      undefined,
    );

    expect(warnings).toEqual([]);
    expect(config['hot']).toEqual({ kind: 'local', command: 'npx', autorun: true });
    expect(config['web']).toEqual({ kind: 'remote', url: 'https://mcp.example/mcp' });
  });

  it('rejects a non-boolean autorun flag with a warning', () => {
    const { config, warnings } = mergeMcpConfigs({ typo: { command: 'npx', autorun: 'yes' } }, undefined);

    expect(config).toEqual({});
    expect(warnings[0]).toContain('"typo"');
    expect(warnings[0]).toContain('"autorun" must be a boolean');
  });

  it('drops invalid entries and reports each with a warning', () => {
    const { config, warnings } = mergeMcpConfigs({ broken: {}, conflict: { command: 'x', url: 'https://a.example' }, scalar: 'nope' }, undefined);

    expect(config).toEqual({});
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('"broken"');
  });

  it('skips disabled entries and lets the project switch off a global server', () => {
    const { config, warnings } = mergeMcpConfigs(
      { keep: { command: 'kept' }, off: { command: 'disabled' } },
      { off: { disabled: true }, extra: { url: 'https://mcp.example/mcp' } },
    );

    expect(warnings).toEqual([]);
    expect(Object.keys(config)).toEqual(['keep', 'extra']);
  });

  it('lets project entries override global entries with the same name', () => {
    const { config } = mergeMcpConfigs({ s: { command: 'old' } }, { s: { command: 'new' } });

    expect(config['s']).toEqual({ kind: 'local', command: 'new' });
  });
});

describe('loadMcpConfig', () => {
  let workspace: string;
  let agentDir: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pi-code-mcp-workspace-'));
    agentDir = await mkdtemp(join(tmpdir(), 'pi-code-mcp-agent-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(agentDir, { recursive: true, force: true });
  });

  async function writeProjectConfig(content: string): Promise<void> {
    await mkdir(join(workspace, CONFIG_DIR_NAME));
    await writeFile(join(workspace, CONFIG_DIR_NAME, MCP_CONFIG_FILE), content);
  }

  it('ignores the project config in untrusted workspaces', async () => {
    await writeFile(join(agentDir, MCP_CONFIG_FILE), JSON.stringify({ g: { command: 'global' } }));
    await writeProjectConfig(JSON.stringify({ p: { command: 'project' } }));

    const config = await loadMcpConfig(workspace, { trusted: false, agentDir });

    expect(Object.keys(config)).toEqual(['g']);
  });

  it('merges global and project configs inside trusted workspaces', async () => {
    await writeFile(join(agentDir, MCP_CONFIG_FILE), JSON.stringify({ s: { command: 'old' } }));
    await writeProjectConfig(JSON.stringify({ s: { url: 'https://mcp.example/mcp' }, p: { command: 'project' } }));

    const config = await loadMcpConfig(workspace, { trusted: true, agentDir });

    expect(Object.keys(config)).toEqual(['s', 'p']);
    expect(config['s']).toEqual({ kind: 'remote', url: 'https://mcp.example/mcp' });
  });

  it('treats malformed json as an absent config', async () => {
    await writeFile(join(agentDir, MCP_CONFIG_FILE), '{ definitely not json');

    const config = await loadMcpConfig(workspace, { trusted: true, agentDir });

    expect(config).toEqual({});
  });
});
