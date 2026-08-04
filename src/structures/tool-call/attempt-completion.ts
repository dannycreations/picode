import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { ToolName } from '@extension/types/webview';

export const attemptCompletionTool = defineTool({
  name: 'attempt_completion' as ToolName,
  label: 'Attempt Completion',
  description: 'Present the final result of your work to the user once you have confirmed the task is complete.',
  parameters: Type.Object({
    result: Type.String({ description: 'The final result of the task, explaining what was done.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      return {
        content: [{ type: 'text', text: 'Completion attempt received.' }],
        details: { result: params.result },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error completing task: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
