import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { QuestionBridge } from '@pi-code/extension/structures/agent-runtime/question';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const askQuestionTool = defineTool({
  name: 'ask_question' as ToolName,
  label: 'Ask Follow-up Question',
  description:
    'Ask the user for clarification when you need input to finish the task. Provide 2-4 specific, actionable options in "follow_up", ordered from most to least likely.',
  parameters: Type.Object({
    question: Type.String({ description: 'The question to ask the user.' }),
    follow_up: Type.Array(Type.Object({ text: Type.String({ description: 'A complete, self-contained option with no placeholders.' }) }), {
      description: '2-4 suggested answers shown as clickable options, ordered from most to least likely.',
    }),
  }),
  async execute(toolCallId, params, signal, _onUpdate, _ctx) {
    try {
      // The chat view renders the question straight from the tool call
      // arguments, so an empty question would surface as an empty card.
      if (!params.question.trim()) {
        return {
          content: [{ type: 'text', text: 'Error: "question" is required and cannot be empty.' }],
          details: {},
          isError: true,
        };
      }

      const response = await QuestionBridge.getInstance().ask(toolCallId, signal);

      if (response === null || response.trim() === '') {
        return {
          content: [{ type: 'text', text: 'Error: the user provided no response.' }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: response }],
        details: { response },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error asking question: ${formatThrownValue(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
