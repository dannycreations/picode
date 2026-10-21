import { relative, resolve } from 'node:path';
import { contentText } from '@earendil-works/pi-ai';
import { createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';

import { applySessionOverrides, readDelegationTaskModelSelection, readDelegationTaskThinkingLevel } from '@pi-code/extension/core/settings';
import { attachLiveSubagentSession, unregisterLiveSubagent } from '@pi-code/extension/structures/agent-runtime/brokers/subagent';
import { registerSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { deleteFileTool } from '@pi-code/extension/structures/tool-call/delete-file';
import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';
import { readFileTool } from '@pi-code/extension/structures/tool-call/read-file';
import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';
import { createIsolatedWorktree, integrateIsolatedWorktree, removeWorktreeDirectory, withWorktreeLock } from '@pi-code/extension/utilities/worktree';
import { logger } from '@pi-code/shared/core/logger';
import { elapsedSeconds } from '@pi-code/shared/utilities/common';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { SubagentDefinition } from '@pi-code/extension/core/prompt';
import type { ToolName } from '@pi-code/shared/core/types';

type SubagentToolName = SubagentDefinition['tools'][number];

const SUBAGENT_TOOLS = {
  read_file: readFileTool,
  write_file: writeFileTool,
  edit_file: editFileTool,
  delete_file: deleteFileTool,
  execute_command: executeCommandTool,
} satisfies Record<SubagentToolName, ToolDefinition>;

export interface SubagentUsage {
  readonly turns: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cost: number;
}

export interface SubagentOutcome {
  readonly agent: string;
  readonly text: string;
  readonly steps: string;
  readonly usage: SubagentUsage;
  readonly error?: string;
  readonly duration?: number;
}

interface SubagentInput {
  readonly agent: SubagentDefinition;
  readonly task: string;
  readonly cwd: string;
  readonly model?: Model<Api>;
  readonly signal?: AbortSignal;
  readonly toolCallId: string;
  readonly onProgress?: (steps: string) => void;
  readonly onEvent?: (event: AgentSessionEvent, session: AgentSession) => void;
}

export const SPAWN_SUBAGENT_TOOL_NAME = 'spawn_subagent' as ToolName;
export const SUBAGENT_FORWARDED_EVENTS: ReadonlySet<string> = new Set(['tool_execution_start', 'tool_execution_update', 'tool_execution_end']);

const MAX_CONCURRENT_SUBAGENTS = 3;
const MAX_SUBAGENT_STEP_HISTORY = 10;

let activeSpawns = 0;
const waiting: (() => void)[] = [];

function releaseSlot(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;

    const next = waiting.shift();
    if (next) next();
    else activeSpawns--;
  };
}

async function acquireSpawnSlot(signal?: AbortSignal): Promise<() => void> {
  if (activeSpawns < MAX_CONCURRENT_SUBAGENTS) {
    activeSpawns++;
    return releaseSlot();
  }

  // A cancelled sub-agent waiting for a slot must not block the queue until a
  // slot frees; it leaves the wait list and gets a no-op release instead.
  let granted = false;
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      const index = waiting.indexOf(waiter);
      if (index !== -1) waiting.splice(index, 1);
      resolve();
    };
    const waiter = (): void => {
      granted = true;
      // The slot is ours, so the abort handler has nothing left to undo. Leaving
      // it attached would pile one listener up on the caller's signal per queued
      // sub-agent for the rest of the task.
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    waiting.push(waiter);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });

  return granted ? releaseSlot() : () => {};
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function formatSubagentStep(toolName: SubagentToolName, args: unknown): string {
  const values = (args ?? {}) as { files?: unknown; command?: string; path?: string };

  if (toolName === 'read_file') {
    const files = Array.isArray(values.files) ? values.files : [];
    const paths = files
      .map((file) => (file as { path?: unknown })?.path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0);
    return `read ${preview(paths.join(', ')) || '(no path)'}`;
  }

  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'delete_file') {
    return `${toolName.replace('_file', '')} ${preview(values.path ?? '') || '(no path)'}`;
  }

  return `execute ${preview(values.command ?? '')}`;
}

export function lastAssistantText(session: AgentSession): { text: string; error?: string } {
  for (let i = session.state.messages.length - 1; i >= 0; i--) {
    const message = session.state.messages[i];
    if (message.role !== 'assistant') continue;

    const text = contentText(message.content).trim();
    if (text.length > 0) {
      return { text };
    }

    if (message.stopReason === 'error') {
      return { text, error: message.errorMessage ?? 'The sub-agent request failed.' };
    }

    // The run resolved without a final text report. State the cause instead of
    // leaving an empty error: a tool call with no trailing summary is how the
    // agent loop ends when it stops before writing its report.
    const endedOnToolCall = message.stopReason === 'toolUse' || message.content.some((block) => block.type === 'toolCall');
    const error = endedOnToolCall ? 'The sub-agent ended without a report; its last turn was a tool call.' : 'The sub-agent ended without a report.';
    return { text, error };
  }
  return { text: '', error: 'The sub-agent produced no report.' };
}

function collectUsage(session: AgentSession): SubagentUsage {
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;

  for (const message of session.state.messages) {
    if (message.role !== 'assistant') continue;
    turns++;
    tokensIn += message.usage?.input ?? 0;
    tokensOut += message.usage?.output ?? 0;
    cost += message.usage?.cost?.total ?? 0;
  }

  return { turns, tokensIn, tokensOut, cost };
}

async function applyDelegationSettings(session: AgentSession, runtime: ModelRuntime, inherited: Model<Api> | undefined): Promise<void> {
  const configured = readDelegationTaskModelSelection();
  // Delegated runs can be pointed at their own model, which keeps a cheap model
  // off the main chat's budget. Without one the child inherits the caller's
  // model. A failure here is not fatal because the child falls back to the
  // default model.
  const model = (configured ? runtime.getModel(configured.provider, configured.id) : undefined) ?? inherited;
  if (model) {
    await session.setModel(model).catch((err) => logger.warn('Could not apply the delegated model to the sub-agent:', err));
  }

  // setModel resolves the persisted chat level, so a configured delegation level
  // is applied on top of it, once the model it belongs to is settled.
  const level = readDelegationTaskThinkingLevel();
  if (level && level !== 'off') {
    try {
      session.setThinkingLevel(level);
    } catch (err) {
      logger.warn(`Could not apply the delegated thinking level ${level}:`, err);
    }
  }
}

async function createChildSession(
  cwd: string,
  agent: SubagentDefinition,
  inheritedModel: Model<Api> | undefined,
  toolCallId: string,
): Promise<AgentSession> {
  // Services are cached per workspace, so a child session reuses the parent's
  // model runtime, credentials, and tool policy extension instead of rebuilding
  // them. Only the transcript is separate, which is the point of delegation.
  const services = await createAgentResources(cwd);

  const { session } = await createAgentSessionFromServices({
    services,
    // In memory keeps sub-agent out of the session history: the parent
    // transcript already records the delegation and its result.
    sessionManager: SessionManager.inMemory(cwd),
    tools: [...agent.tools],
    customTools: agent.tools.map((tool) => SUBAGENT_TOOLS[tool]),
  });

  // Tag this child session so the shared tool policy can label any
  // confirmation prompts it raises with the sub-agent name.
  registerSubagentSession(session.sessionId, agent.name, toolCallId);

  // The registry keeps the session reachable after this run ends, so the user
  // can open the sub-agent's own transcript the way they open a task.
  attachLiveSubagentSession(toolCallId, session);

  applySessionOverrides(session);

  await applyDelegationSettings(session, services.modelRuntime, inheritedModel);

  return session;
}

function isMutatingAgent(agent: SubagentDefinition): boolean {
  return agent.tools.some((tool) => tool === 'write_file' || tool === 'edit_file' || tool === 'delete_file');
}

export async function spawnSubagent(input: SubagentInput): Promise<SubagentOutcome> {
  const release = await acquireSpawnSlot(input.signal);
  const startTime = Date.now();
  const collected: string[] = [];

  const steps = (): string => collected.join('\n');

  const cancelled = (): SubagentOutcome => ({
    agent: input.agent.name,
    text: '',
    steps: '',
    usage: emptyUsage(),
    error: 'Sub-agent was cancelled.',
    duration: elapsedSeconds(startTime),
  });

  const recordStep = (step: string): void => {
    collected.push(step);
    if (collected.length > MAX_SUBAGENT_STEP_HISTORY) collected.shift();
  };

  // Mutating agents work in an isolated copy of the workspace so parallel runs
  // cannot overwrite each other. Read-only agents keep using the shared cwd.
  const mutating = isMutatingAgent(input.agent);
  let worktree: Awaited<ReturnType<typeof createIsolatedWorktree>> = null;
  let effectiveCwd = input.cwd;
  let integrated = false;
  let integrationFailed = false;
  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;

  try {
    if (mutating) {
      worktree = await withWorktreeLock(() => createIsolatedWorktree(input.cwd));
      if (worktree) {
        const relativeCwd = relative(worktree.baseRoot, input.cwd);
        effectiveCwd = relativeCwd && relativeCwd !== '.' && !relativeCwd.startsWith('..') ? resolve(worktree.path, relativeCwd) : worktree.path;
      } else {
        logger.warn('Running the mutating sub-agent without isolation because no git worktree could be created.');
      }
    }

    input.onProgress?.('');
    if (input.signal?.aborted) {
      if (worktree) await withWorktreeLock(() => removeWorktreeDirectory(worktree!));
      return cancelled();
    }

    session = await createChildSession(effectiveCwd, input.agent, input.model, input.toolCallId);

    // createChildSession does not observe the signal, so check it again before
    // starting any model work.
    if (input.signal?.aborted) {
      // The session never ran, so there is no transcript worth keeping.
      unregisterLiveSubagent(input.toolCallId);
      if (worktree) await withWorktreeLock(() => removeWorktreeDirectory(worktree!));
      return cancelled();
    }

    const onAbort = (): void => {
      void session?.abort().catch((err) => logger.error('Failed to abort sub-agent session:', err));
    };

    try {
      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (event.type === 'tool_execution_start') {
          recordStep(formatSubagentStep(event.toolName as SubagentToolName, event.args));
          input.onProgress?.(steps());
        }
        input.onEvent?.(event, session!);
      });
    } catch (err) {
      unregisterLiveSubagent(input.toolCallId);
      session = undefined;
      throw err;
    }

    try {
      input.signal?.addEventListener('abort', onAbort, { once: true });
      // The brief is model authored, so prompt template expansion stays off to
      // keep a stray leading slash from loading an unrelated template.
      await session.prompt(`${input.agent.prompt}\n\n## Task\n\n${input.task.trim()}`, {
        expandPromptTemplates: false,
        source: 'extension',
      });

      const { text, error } = lastAssistantText(session);
      const aborted = input.signal?.aborted === true;

      let finalText = text;
      let finalError = aborted ? 'Sub-agent was cancelled.' : error;

      if (worktree && !aborted) {
        const integration = await withWorktreeLock(() => integrateIsolatedWorktree(worktree!));
        integrated = integration.ok;
        if (!integration.ok) {
          integrationFailed = true;
          finalError = finalError ?? integration.reason;
          finalText = finalText ? `${finalText}\n\n${integration.reason}` : integration.reason;
        }
      }

      if (worktree && aborted) {
        await withWorktreeLock(() => removeWorktreeDirectory(worktree!));
      }

      return {
        agent: input.agent.name,
        text: finalText,
        steps: steps(),
        usage: collectUsage(session),
        error: finalError,
        duration: elapsedSeconds(startTime),
      };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      unsubscribe?.();
      // The session stays alive: it is the sub-agent's own transcript, and the
      // user opens it from the task that delegated the work. The registry
      // releases it together with the parent task.
    }
  } finally {
    // A sub-agent that never got a session has no transcript to open.
    if (!session) unregisterLiveSubagent(input.toolCallId);
    if (worktree && !integrated && !integrationFailed) {
      await withWorktreeLock(() => removeWorktreeDirectory(worktree!));
    }
    release();
  }
}

function emptyUsage(): SubagentUsage {
  return { turns: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
}

// Sub-agent are in-memory, so their spend never reaches the persisted
// session file. The parent's live header stats are the only place it can show
// up, so each records here keyed by parent session and is folded into the
// next `agent_settled` payload, then cleared.
const childUsageBySession = new Map<string, SubagentUsage>();

export function recordSubagentUsage(sessionId: string, usage: SubagentUsage): void {
  const previous = childUsageBySession.get(sessionId) ?? emptyUsage();
  childUsageBySession.set(sessionId, {
    turns: previous.turns + usage.turns,
    tokensIn: previous.tokensIn + usage.tokensIn,
    tokensOut: previous.tokensOut + usage.tokensOut,
    cost: previous.cost + usage.cost,
  });
}

export function takeSubagentUsage(sessionId: string): SubagentUsage {
  const usage = childUsageBySession.get(sessionId) ?? emptyUsage();
  childUsageBySession.delete(sessionId);
  return usage;
}
