import { SUBAGENT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { readAppSettings } from '@pi-code/extension/core/settings';
import { requestApproval } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import {
  applyYoloDecision,
  resolveCommandAction,
  resolvePathAction,
  resolveReadPath,
} from '@pi-code/extension/structures/agent-runtime/policy-action';

import type { BeforeAgentStartEventResult, InlineExtension, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
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
    case 'read_file': {
      const resolutions = (args.files ?? []).map((file) => resolveReadPath(cwd, file.path ?? '', settings));
      if (resolutions.includes('deny')) action = 'deny';
      else action = resolutions.every((resolution) => resolution === 'approve') ? 'approve' : 'confirm';
      denyReason = 'Access to read one or more specified paths is explicitly denied by settings.';
      break;
    }
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

  const decision: ApprovalDecision = action === 'deny' ? { action, reason: denyReason } : { action };
  return applyYoloDecision(settings, decision);
}

interface SubagentSessionInfo {
  readonly name: string;
  readonly toolCallId?: string;
}

const subagentBySession = new Map<string, SubagentSessionInfo>();

export function registerSubagentSession(sessionId: string, name: string, toolCallId?: string): void {
  subagentBySession.set(sessionId, { name, toolCallId });
}

export function unregisterSubagentSession(sessionId: string): void {
  subagentBySession.delete(sessionId);
}

export function getSubagentSessionName(sessionId: string): string | undefined {
  return subagentBySession.get(sessionId)?.name;
}

const approvalDurations = new Map<string, number>();

export function getApprovalDuration(toolCallId: string): number | undefined {
  return approvalDurations.get(toolCallId);
}

export function recordApprovalDuration(toolCallId: string, durationMs: number): void {
  approvalDurations.set(toolCallId, durationMs);
}

const ALLOW: ToolCallEventResult = { block: false };

export function createToolPolicyExtension(): InlineExtension {
  return {
    name: 'pi-code-tool-policy',
    hidden: true,
    factory: (pi) => {
      pi.on('before_agent_start', (event): BeforeAgentStartEventResult => {
        // Only the main agent can delegate. Sub-agents lack the spawn_subagent tool,
        // so skipping keeps their context free of guidance they cannot act on.
        if (!event.systemPromptOptions.selectedTools?.includes('spawn_subagent')) {
          return {};
        }
        return { systemPrompt: `${event.systemPrompt}\n\n${SUBAGENT_MESSAGE_PROMPT}` };
      });
      pi.on('tool_call', async (event, ctx): Promise<ToolCallEventResult> => {
        const toolName = event.toolName as ToolName;
        const decision = evaluateToolCall(toolName, ctx.cwd, event.input);

        if (decision.action === 'approve') {
          return ALLOW;
        }
        if (decision.action === 'deny') {
          return { block: true, reason: decision.reason };
        }

        const sessionInfo = subagentBySession.get(ctx.sessionManager.getSessionId());
        const approvalStart = Date.now();
        const approved = await requestApproval(toolName, event.toolCallId, event.input, sessionInfo?.name, sessionInfo?.toolCallId);
        const approvalDuration = Date.now() - approvalStart;
        if (event.toolCallId) {
          recordApprovalDuration(event.toolCallId, approvalDuration);
        }
        return approved ? ALLOW : { block: true, reason: 'Action denied by user.' };
      });
    },
  };
}
