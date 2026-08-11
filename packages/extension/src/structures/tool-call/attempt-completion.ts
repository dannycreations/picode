import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const attemptCompletionTool = defineTool({
  name: 'attempt_completion' as ToolName,
  label: 'Attempt Completion',
  description: 'Report the final outcome to the user only after the task is fully complete and verified. Summarize what was done in "result".',
  parameters: Type.Object({
    result: Type.String({ description: 'Summary of what was done and the final outcome.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return {
      content: [{ type: 'text', text: 'Completion reported to the user.' }],
      details: { result: params.result },
    };
  },
});
