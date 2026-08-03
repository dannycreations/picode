import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { window } from 'vscode';

import type { ToolName } from '@extension/types/webview';

export const askQuestionTool = defineTool({
  name: 'ask_question' as ToolName,
  label: 'Ask Follow-up Question',
  description: 'Ask the user a question to gather additional information or clarification needed to complete the task.',
  parameters: Type.Object({
    question: Type.String({ description: 'The question to ask the user' }),
    follow_up: Type.Array(
      Type.Object({
        text: Type.String({ description: 'Suggested answer text' }),
        mode: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'Optional mode switch' })),
      }),
      { description: 'Suggested answers' },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      const choices = params.follow_up.map((f) => f.text);
      const customOption = 'Type a custom response...';
      choices.push(customOption);

      const selected = await window.showQuickPick(choices, {
        placeHolder: params.question,
        ignoreFocusOut: true,
      });

      if (selected === undefined) {
        return {
          content: [{ type: 'text', text: 'Error: No response was provided by the user.' }],
          details: {},
          isError: true,
        };
      }

      let response = selected;
      if (selected === customOption) {
        const typed = await window.showInputBox({
          prompt: params.question,
          ignoreFocusOut: true,
        });
        if (typed === undefined) {
          return {
            content: [{ type: 'text', text: 'Error: No response was provided by the user.' }],
            details: {},
            isError: true,
          };
        }
        response = typed;
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
