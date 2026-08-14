import { readAppSettings } from '@pi-code/extension/core/settings';
import { requestApproval } from '@pi-code/extension/structures/agent-runtime/brokers/policy';
import { resolveCommandAction, resolvePathAction, resolveReadPath } from '@pi-code/extension/structures/agent-runtime/policy-action';

import type { InlineExtension, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import type { ApprovalDecision } from '@pi-code/extension/structures/agent-runtime/policy-action';
import type { ToolName } from '@pi-code/shared/core/types';

interface ToolCallArgs {
  readonly files?: ReadonlyArray<{ path?: string }>;
  readonly path?: string;
  readonly file_path?: string;
  readonly command?: string;
}

// Tools that reach the user or the model without touching the workspace. A
// sub-agent run is included because every tool it uses is policed on its own,
// so gating the delegation itself would only add a redundant prompt.
const SELF_APPROVING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(['update_todo', 'ask_question', 'spawn_subagent']);

function evaluateToolCall(toolName: ToolName, cwd: string, input: unknown): ApprovalDecision {
  if (SELF_APPROVING_TOOLS.has(toolName)) {
    return { action: 'approve' };
  }

  const settings = readAppSettings();
  const args = (input ?? {}) as ToolCallArgs;

  let action: ApprovalDecision['action'] = 'confirm';
  let denyReason = '';

  switch (toolName) {
    case 'read_file':
      const resolutions = (args.files ?? []).map((file) => resolveReadPath(cwd, file.path ?? '', settings));
      if (resolutions.includes('deny')) action = 'deny';
      else action = resolutions.every((resolution) => resolution === 'approve') ? 'approve' : 'confirm';
      denyReason = 'Access to read one or more specified paths is explicitly denied by settings.';
      break;
    case 'write_file':
    case 'edit_file':
      action = resolvePathAction(
        cwd,
        (toolName === 'write_file' ? args.path : args.file_path) ?? '',
        settings.autoApproveWrite,
        settings.allowedWritePaths,
        settings.deniedWritePaths,
      );
      denyReason = 'Access to write/edit this file path is explicitly denied by settings.';
      break;
    case 'delete_file':
      action = resolvePathAction(cwd, args.path ?? '', settings.autoApproveDelete, settings.allowedDeletePaths, settings.deniedDeletePaths);
      denyReason = 'Access to delete this file path is explicitly denied by settings.';
      break;
    case 'execute_command':
      action = resolveCommandAction(args.command ?? '', settings.autoApproveExecute, settings.allowedExecuteCommands, settings.deniedExecuteCommands);
      denyReason = 'Execution of this command is explicitly denied by settings.';
      break;
  }

  return action === 'deny' ? { action, reason: denyReason } : { action };
}

const subagentBySession = new Map<string, string>();

export function registerSubagentSession(sessionId: string, name: string): void {
  subagentBySession.set(sessionId, name);
}

export function unregisterSubagentSession(sessionId: string): void {
  subagentBySession.delete(sessionId);
}

export function getSubagentSessionName(sessionId: string): string | undefined {
  return subagentBySession.get(sessionId);
}

const ALLOW: ToolCallEventResult = { block: false };

export function createToolPolicyExtension(): InlineExtension {
  return {
    name: 'pi-code-tool-policy',
    hidden: true,
    factory: (pi) => {
      pi.on('tool_call', async (event, ctx): Promise<ToolCallEventResult> => {
        const toolName = event.toolName as ToolName;
        const decision = evaluateToolCall(toolName, ctx.cwd, event.input);

        if (decision.action === 'approve') {
          return ALLOW;
        }
        if (decision.action === 'deny') {
          return { block: true, reason: decision.reason };
        }

        const subagent = subagentBySession.get(ctx.sessionManager.getSessionId());
        const approved = await requestApproval(toolName, event.toolCallId, event.input, subagent);
        return approved ? ALLOW : { block: true, reason: 'Action denied by user.' };
      });
    },
  };
}
