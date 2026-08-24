import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { loadMcpConfig } from '@pi-code/extension/structures/agent-runtime/mcp/config';
import { mcpGateway } from '@pi-code/extension/structures/agent-runtime/mcp/manager';
import { toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { truncateOutput } from '@pi-code/extension/utilities/truncate';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

interface McpDetails {
  readonly subtitle?: string;
}

export const mcpTool = defineTool({
  name: 'mcp' as ToolName,
  label: 'Model Context Protocol',
  description:
    'Interact with MCP servers by: first, call with no parameters to list configured servers; second, call with "server" to start it on first use and list its tools/schemas; third, call with "server", "tool", and schema-matching "arguments" to execute the tool.',
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: 'The MCP server to talk to. Omit to list the configured servers.' })),
    tool: Type.Optional(Type.String({ description: "The tool to run on that server. Omit to list the server's tools." })),
    arguments: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: 'Arguments for the tool, following the parameter schema listed earlier.',
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx): Promise<CustomToolResult<McpDetails>> {
    try {
      const config = await loadMcpConfig(ctx.cwd, { trusted: isProjectTrusted(ctx.cwd) });
      const outcome = await mcpGateway.dispatch(config, ctx.cwd, params, signal);
      const { text } = truncateOutput(outcome.text, { limits: readOutputLimits() });
      const details: McpDetails = { subtitle: outcome.subtitle };
      return outcome.isError ? toolError(text, details) : toolResult(text, details);
    } catch (err) {
      return toolError(`Error calling MCP: ${formatThrownValue(err)}`);
    }
  },
});
