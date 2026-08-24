import { describe, expect, it, vi } from 'vitest';

import { createMcpGateway } from '@pi-code/extension/structures/agent-runtime/mcp/manager';
import { logger } from '@pi-code/shared/core/logger';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig } from '@pi-code/extension/structures/agent-runtime/mcp/config';
import type { McpConnection, McpConnector } from '@pi-code/extension/structures/agent-runtime/mcp/manager';

const LOCAL: McpServerConfig = { kind: 'local', command: 'echo' };
const AUTO: McpServerConfig = { kind: 'local', command: 'echo', autorun: true };
const REMOTE: McpServerConfig = { kind: 'remote', url: 'https://mcp.example/mcp' };
const WORKSPACE = '/workspace';

interface RecordedCall {
  readonly clientId: number;
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

interface FakeClient {
  readonly id: number;
  closed: boolean;
  readonly closeListeners: Array<() => void>;
}

function createFakeConnector(options?: { failTimes?: number }) {
  const clients: FakeClient[] = [];
  const calls: RecordedCall[] = [];
  let failuresLeft = options?.failTimes ?? 0;
  let nextId = 0;

  const connector: McpConnector = async (): Promise<McpConnection> => {
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error('boom');
    }

    const client: FakeClient = { id: ++nextId, closed: false, closeListeners: [] };
    clients.push(client);

    return {
      listTools: async () => [{ name: 'ping', description: 'answers pings', inputSchema: { type: 'object' } }] as unknown as Tool[],
      callTool: async (tool, args) => {
        calls.push({ clientId: client.id, tool, args });
        return { content: [{ type: 'text', text: `ran ${tool}` }] };
      },
      close: async () => {
        client.closed = true;
      },
      onClose: (listener) => {
        client.closeListeners.push(listener);
      },
    };
  };

  return { calls, clients, connector };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createMcpGateway', () => {
  it('errors when no servers are configured', async () => {
    const { connector } = createFakeConnector();
    const outcome = await createMcpGateway(connector).dispatch({}, WORKSPACE, {});

    expect(outcome.isError).toBe(true);
  });

  it('lists configured servers without starting any of them', async () => {
    const { clients, connector } = createFakeConnector();
    const outcome = await createMcpGateway(connector).dispatch({ fs: LOCAL, web: REMOTE }, WORKSPACE, {});

    expect(outcome.isError).toBeFalsy();
    expect(outcome.text).toContain('- fs (local, not started)');
    expect(outcome.text).toContain('- web (remote, not started)');
    expect(clients).toHaveLength(0);
  });

  it('reports unknown servers as an error listing the valid names', async () => {
    const { clients, connector } = createFakeConnector();
    const outcome = await createMcpGateway(connector).dispatch({ fs: LOCAL }, WORKSPACE, { server: 'nope' });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain('unknown MCP server "nope"');
    expect(outcome.text).toContain('fs');
    expect(clients).toHaveLength(0);
  });

  it('starts a server lazily on first use and reuses the connection afterwards', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    const first = await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    const second = await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });

    expect(clients).toHaveLength(1);
    expect(first.subtitle).toBe('fs: 1 tools');
    expect(second.text).toContain('### ping');
    expect(gateway.isConnected('fs')).toBe(true);
  });

  it('forwards tool arguments and returns the tool result text', async () => {
    const { calls, clients, connector } = createFakeConnector();
    const outcome = await createMcpGateway(connector).dispatch({ fs: LOCAL }, WORKSPACE, {
      server: 'fs',
      tool: 'ping',
      arguments: { echo: 'hi' },
    });

    expect(outcome.text).toBe('ran ping');
    expect(calls).toEqual([{ clientId: clients[0].id, tool: 'ping', args: { echo: 'hi' } }]);
  });

  it('surfaces a failed start as an error and retries on the next call', async () => {
    const { clients, connector } = createFakeConnector({ failTimes: 1 });
    const gateway = createMcpGateway(connector);

    const failure = await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    const recovery = await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });

    expect(failure.isError).toBe(true);
    expect(failure.text).toContain('boom');
    expect(recovery.isError).toBeFalsy();
    // The first attempt threw before any client existed; the retry owns the only one.
    expect(clients).toHaveLength(1);
  });

  it('reconnects after a connection closes unexpectedly', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    clients[0].closeListeners.forEach((listener) => listener());
    const second = await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });

    expect(second.isError).toBeFalsy();
    expect(clients).toHaveLength(2);
    expect(gateway.isConnected('fs')).toBe(true);
  });

  it('replaces a running connection when its config changes underneath it', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    await gateway.dispatch({ fs: { ...LOCAL, timeoutMs: 5_000 } }, WORKSPACE, { server: 'fs' });
    await settle();

    expect(clients).toHaveLength(2);
    expect(clients[0].closed).toBe(true);
    expect(clients[1].closed).toBe(false);
  });

  it('closes every connection on closeAll and reconnects afterwards', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    await gateway.closeAll();
    await settle();

    expect(clients[0].closed).toBe(true);
    expect(gateway.isConnected('fs')).toBe(false);

    await gateway.dispatch({ fs: LOCAL }, WORKSPACE, { server: 'fs' });
    expect(clients).toHaveLength(2);
  });

  it('starts autorun servers eagerly and leaves lazy ones untouched', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    await gateway.preconnect({ fs: LOCAL, hot: AUTO }, WORKSPACE);

    expect(clients).toHaveLength(1);
    expect(gateway.isConnected('hot')).toBe(true);
    expect(gateway.isConnected('fs')).toBe(false);
  });

  it('reuses a preconnected server on its first dispatch', async () => {
    const { clients, connector } = createFakeConnector();
    const gateway = createMcpGateway(connector);

    await gateway.preconnect({ hot: AUTO }, WORKSPACE);
    const outcome = await gateway.dispatch({ hot: AUTO }, WORKSPACE, { server: 'hot' });

    expect(clients).toHaveLength(1);
    expect(outcome.isError).toBeFalsy();
  });

  it('logs a failed autorun start and lets the next dispatch retry it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const { clients, connector } = createFakeConnector({ failTimes: 1 });
    const gateway = createMcpGateway(connector);

    await gateway.preconnect({ hot: AUTO }, WORKSPACE);
    expect(warn).toHaveBeenCalledOnce();
    vi.restoreAllMocks();

    const recovery = await gateway.dispatch({ hot: AUTO }, WORKSPACE, { server: 'hot' });

    expect(recovery.isError).toBeFalsy();
    expect(clients).toHaveLength(1);
  });
});
