import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { getActiveMcpConfig } from '@pi-code/extension/structures/agent-runtime/mcp/config';
import { mcpGateway } from '@pi-code/extension/structures/agent-runtime/mcp/manager';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { truncateOutput } from '@pi-code/extension/utilities/truncate';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

interface McpDetails {
  readonly subtitle?: string;
}

export const mcpTool = defineTool({
  name: 'mcp' as ToolName,
  label: 'Model Context Protocol',
  description:
    'Interact with MCP servers by: first, call with no parameters to list configured servers; second, call with `server` to start it on first use and list its tools/schemas; third, call with `server`, `tool`, and schema-matching `arguments` to execute the tool.',
  parameters: Type.Object({
    server: Type.Optional(Type.String({ description: 'The MCP server to talk to. Omit to list the configured servers.' })),
    tool: Type.Optional(Type.String({ description: "The tool to run on that server. Omit to list the server's tools." })),
    arguments: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: 'Arguments for the tool, following the parameter schema listed earlier.',
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx): Promise<CustomToolResult<McpDetails>> {
    try {
      const config = getActiveMcpConfig();

      if (params.server !== undefined && config[params.server] !== undefined) {
        const subtitle = params.tool !== undefined ? `${params.server}/${params.tool}` : params.server;
        const previewText =
          params.tool !== undefined
            ? `Calling tool "${params.tool}" on MCP server "${params.server}"...`
            : `Listing tools on MCP server "${params.server}"...`;
        onUpdate?.(toolResult(previewText, { subtitle }));
      }

      const outcome = await mcpGateway.dispatch(config, ctx.cwd, params, signal);
      const { text } = truncateOutput(outcome.text, { limits: readOutputLimits() });
      const details: McpDetails = { subtitle: outcome.subtitle };
      const result = outcome.isError ? toolError(text, details) : toolResult(text, details);
      onUpdate?.(result);
      return result;
    } catch (err) {
      const result = toolErrorFrom(err, 'calling MCP');
      onUpdate?.(result);
      return result;
    }
  },
});
