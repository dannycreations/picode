import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { askQuestion } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

async function askUser(question: string, toolCallId: string, signal: AbortSignal | undefined): Promise<CustomToolResult> {
  // The chat view renders the question straight from the tool call
  // arguments, so an empty question would surface as an empty card.
  if (!question.trim()) {
    return toolError('Error: `question` is required and cannot be empty.');
  }

  const response = await askQuestion(toolCallId, signal);
  if (response === null || (response.text.trim() === '' && !response.attachments?.length)) {
    return toolError('Error: the user provided no response.');
  }

  // The answer travels as the tool result text; the webview reads it from there.
  return toolResult(response.text, {}, response.attachments);
}

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
  async execute(toolCallId, params, signal, onUpdate, _ctx): Promise<CustomToolResult> {
    // Every outcome, including a thrown one, resolves to a single result that
    // is reported and returned once.
    let result: CustomToolResult;
    try {
      result = await askUser(params.question, toolCallId, signal);
    } catch (err) {
      result = toolErrorFrom(err, 'asking question');
    }

    onUpdate?.(result);
    return result;
  },
});
