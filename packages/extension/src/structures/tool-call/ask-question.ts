import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { askQuestion } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';

import type { ToolName } from '@pi-code/shared/core/types';

export const askQuestionTool = defineTool({
  name: 'ask_question' as ToolName,
  label: 'Ask Follow-up Question',
  description: 'Ask the user for clarification when you need input to finish the task.',
  parameters: Type.Object({
    question: Type.String({ description: 'The question to ask.' }),
    follow_up: Type.Array(Type.Object({ text: Type.String({ description: 'A complete, self-contained option with no placeholders.' }) }), {
      minItems: 2,
      description: '2-4 answer options, ordered from most to least likely.',
    }),
  }),
  async execute(toolCallId, params, signal, _onUpdate, _ctx) {
    try {
      // The chat view renders the question straight from the tool call
      // arguments, so an empty question would surface as an empty card.
      if (!params.question.trim()) {
        return toolError('Error: "question" is required and cannot be empty.');
      }

      const response = await askQuestion(toolCallId, signal);

      if (response === null || response.trim() === '') {
        return toolError('Error: the user provided no response.');
      }

      return toolResult(response, { response });
    } catch (err) {
      return toolErrorFrom(err, 'asking question');
    }
  },
});
