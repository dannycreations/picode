import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { parseTodoList } from '@pi-code/shared/utilities/todo';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Update the project task checklist to track progress. Provide the full updated list in "todos".',
  parameters: Type.Object({
    todos: Type.String({ description: 'Full updated markdown checklist of TODO items.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      return {
        content: [{ type: 'text', text: 'Todo list updated.' }],
        details: { todos: parseTodoList(params.todos) },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating todo list: ${formatThrownValue(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
