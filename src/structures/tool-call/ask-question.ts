import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { QuestionBridge } from '@extension/structures/agent-runtime/question';

import type { ToolName } from '@extension/types/webview';

export const askQuestionTool = defineTool({
  name: 'ask_question' as ToolName,
  label: 'Ask Follow-up Question',
  description:
    'Ask the user a question to gather additional information or clarification needed to complete the task. Always provide 2-4 specific, actionable suggested answers ordered from most to least likely.',
  parameters: Type.Object({
    question: Type.String({ description: 'The question to ask the user' }),
    follow_up: Type.Array(Type.Object({ text: Type.String({ description: 'A complete, self-contained suggested answer with no placeholders' }) }), {
      description: 'Suggested answers presented as clickable options, ordered from most to least likely',
    }),
  }),
  async execute(toolCallId, params, signal, _onUpdate, _ctx) {
    try {
      // The chat view renders the question straight from the tool call
      // arguments, so an empty question would surface as an empty card.
      if (!params.question.trim()) {
        return {
          content: [{ type: 'text', text: 'Error: Missing required parameter "question".' }],
          details: {},
          isError: true,
        };
      }

      const response = await QuestionBridge.getInstance().ask(toolCallId, signal);

      if (response === null || response.trim() === '') {
        return {
          content: [{ type: 'text', text: 'Error: No response was provided by the user.' }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: response }],
        details: {
          response,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error asking question: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
