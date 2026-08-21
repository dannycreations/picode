import { formatThrownValue, StringEnum } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { SUBAGENTS } from '@pi-code/extension/core/prompt';
import { readOutputLimits } from '@pi-code/extension/core/settings';
import { mapEvent, notifySubagentEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { recordSubagentUsage, spawnSubagent } from '@pi-code/extension/structures/agent-runtime/subagent';
import { toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';
import { truncateOutput } from '@pi-code/extension/utilities/truncate';

import type { SubagentOutcome, SubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';
import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

interface SubagentDetails {
  readonly agent: string;
  readonly description: string;
  readonly steps: string;
  readonly usage?: SubagentUsage;
  readonly subtitle?: string;
  readonly duration?: number;
}

function formatUsage(usage: SubagentUsage): string {
  const turns = `${usage.turns} turn${usage.turns === 1 ? '' : 's'}`;
  return `${turns}, ${usage.tokensIn} in / ${usage.tokensOut} out, $${usage.cost.toFixed(4)}`;
}

function renderOutcome(outcome: SubagentOutcome, state: 'completed' | 'error'): string {
  const { text } = truncateOutput(outcome.text, {
    limits: readOutputLimits(),
    keep: 'head',
    hint: `Re-run the "${outcome.agent}" sub-agent with a narrower brief to get the rest.`,
  });

  const body =
    state === 'error'
      ? [
          ...(outcome.steps ? ['<steps>', outcome.steps, '</steps>'] : []),
          '<error>',
          outcome.error ?? 'The sub-agent produced no report.',
          '</error>',
        ]
      : ['<result>', text, '</result>'];

  return [`<subagent name="${outcome.agent}" state="${state}">`, ...body, formatUsage(outcome.usage), '</subagent>'].join('\n');
}

const SUBAGENT_NAMES = SUBAGENTS.map((agent) => agent.name);
const FORWARDED_SUBAGENT_EVENTS = new Set(['tool_execution_start', 'tool_execution_update', 'tool_execution_end']);

export const spawnSubagentTool = defineTool({
  name: 'spawn_subagent' as ToolName,
  label: 'Spawn Sub-agent',
  description: 'Delegate a self-contained, read-only task to a sub-agent that works independently and returns a final report.',
  parameters: Type.Object({
    agent: StringEnum(SUBAGENT_NAMES, { description: 'Name of the sub-agent to delegate to.' }),
    description: Type.String({ description: 'A 3-5 word description of the delegated task, shown to the user.' }),
    task: Type.String({
      description: 'The complete brief for the sub-agent, including the goal, relevant paths, and what to report back.',
    }),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx): Promise<CustomToolResult<SubagentDetails>> {
    const failure = (text: string, agentName: string): CustomToolResult<SubagentDetails> =>
      toolError(text, { agent: agentName, description: params.description, steps: '' });

    const agent = SUBAGENTS.find((agent) => agent.name === params.agent);
    if (!agent) {
      return failure(`Error: unknown sub-agent "${params.agent}". Available sub-agents: ${SUBAGENT_NAMES.join(', ')}.`, params.agent);
    }

    if (!params.task.trim()) {
      return failure('Error: "task" is required and cannot be empty.', agent.name);
    }

    try {
      const outcome = await spawnSubagent({
        agent,
        task: params.task,
        cwd: ctx.cwd,
        model: ctx.model,
        signal,
        toolCallId,
        onStart: onUpdate
          ? () =>
              onUpdate({
                content: [{ type: 'text', text: `Running the ${agent.name} sub-agent...` }],
                details: { agent: agent.name, description: params.description, steps: '' },
              })
          : undefined,
        onProgress: onUpdate
          ? (steps) =>
              onUpdate({
                content: [{ type: 'text', text: `Running the ${agent.name} sub-agent...\n\n${steps}` }],
                details: { agent: agent.name, description: params.description, steps },
              })
          : undefined,
        onEvent: (event, subagentSession) => {
          if (FORWARDED_SUBAGENT_EVENTS.has(event.type)) {
            const { message } = mapEvent(event, subagentSession, null);
            if (message) {
              notifySubagentEvent(message);
            }
          }
        },
      });

      // Fold the delegated run's spend into the parent's live header stats.
      recordSubagentUsage(ctx.sessionManager.getSessionId(), outcome.usage);

      // An empty report is a failure from the caller's perspective: it has to
      // decide whether to retry or do the work itself, and needs the steps to
      // judge how far the sub-agent got.
      const failed = outcome.error !== undefined || outcome.text === '';
      const details: SubagentDetails = {
        agent: outcome.agent,
        description: params.description,
        steps: outcome.steps,
        usage: outcome.usage,
        subtitle: outcome.usage ? formatUsage(outcome.usage) : undefined,
        duration: outcome.duration,
      };

      const report = renderOutcome(outcome, failed ? 'error' : 'completed');
      return failed ? toolError(report, details) : toolResult(report, details);
    } catch (err) {
      return failure(`Error running the ${agent.name} sub-agent: ${formatThrownValue(err)}`, agent.name);
    }
  },
});
