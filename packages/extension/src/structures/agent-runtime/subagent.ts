import { contentText } from '@earendil-works/pi-ai';
import { createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';

import { registerSubagentSession, unregisterSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';
import { readFileTool } from '@pi-code/extension/structures/tool-call/read-file';
import { logger } from '@pi-code/shared/core/logger';
import { elapsedSeconds } from '@pi-code/shared/utilities/common';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { SubagentDefinition } from '@pi-code/extension/core/prompt';
import type { ToolName } from '@pi-code/shared/core/types';

type SubagentToolName = SubagentDefinition['tools'][number];

const SUBAGENT_TOOLS = {
  read_file: readFileTool,
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
  readonly toolCallId?: string;
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
    const waiter = () => {
      granted = true;
      resolve();
    };
    const onAbort = () => {
      const index = waiting.indexOf(waiter);
      if (index !== -1) waiting.splice(index, 1);
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
  const values = (args ?? {}) as { files?: unknown; command?: string };

  if (toolName === 'read_file') {
    const files = Array.isArray(values.files) ? values.files : [];
    const paths = files
      .map((file) => (file as { path?: unknown })?.path)
      .filter((path): path is string => typeof path === 'string' && path.length > 0);
    return `read ${preview(paths.join(', ')) || '(no path)'}`;
  }
  if (toolName === 'execute_command') {
    return `execute ${preview(values.command ?? '')}`;
  }
  return `${toolName} ${preview(JSON.stringify(args ?? {}))}`;
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

async function createChildSession(cwd: string, agent: SubagentDefinition, toolCallId?: string): Promise<AgentSession> {
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

  return session;
}

export async function spawnSubagent(input: SubagentInput): Promise<SubagentOutcome> {
  const release = await acquireSpawnSlot(input.signal);
  const startTime = Date.now();
  const collected: string[] = [];

  const steps = (): string => collected.slice(-MAX_SUBAGENT_STEP_HISTORY).join('\n');

  try {
    input.onProgress?.('');
    if (input.signal?.aborted) {
      return {
        agent: input.agent.name,
        text: '',
        steps: '',
        usage: emptyUsage(),
        error: 'Sub-agent was cancelled.',
        duration: elapsedSeconds(startTime),
      };
    }

    const session = await createChildSession(input.cwd, input.agent, input.toolCallId);
    const onAbort = (): void => {
      void session.abort().catch((err) => logger.error('Failed to abort sub-agent session:', err));
    };

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'tool_execution_start') {
        collected.push(formatSubagentStep(event.toolName as SubagentToolName, event.args));
        input.onProgress?.(steps());
      }
      input.onEvent?.(event, session);
    });

    try {
      if (input.model) {
        // Inheriting the caller's model keeps delegation predictable; a failure
        // here is not fatal because the child falls back to the default model.
        await session.setModel(input.model).catch((err) => logger.warn('Could not apply the parent model to the sub-agent:', err));
      }

      input.signal?.addEventListener('abort', onAbort, { once: true });
      // The brief is model authored, so prompt template expansion stays off to
      // keep a stray leading slash from loading an unrelated template.
      await session.prompt(`${input.agent.prompt}\n\n## Task\n\n${input.task.trim()}`, {
        expandPromptTemplates: false,
        source: 'extension',
      });

      const { text, error } = lastAssistantText(session);
      const aborted = input.signal?.aborted === true;

      return {
        agent: input.agent.name,
        text,
        steps: steps(),
        usage: collectUsage(session),
        error: aborted ? 'Sub-agent was cancelled.' : error,
        duration: elapsedSeconds(startTime),
      };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      unregisterSubagentSession(session.sessionId);
      session.dispose();
    }
  } finally {
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
