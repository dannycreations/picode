import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const attemptCompletionTool = defineTool({
  name: 'attempt_completion' as ToolName,
  label: 'Attempt Completion',
  description: 'Present the final result of your work to the user once you have confirmed the task is complete.',
  parameters: Type.Object({
    result: Type.String({ description: 'The final result of the task, explaining what was done.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return {
      content: [{ type: 'text', text: 'attempt_completion success.' }],
      details: { result: params.result },
    };
  },
});
