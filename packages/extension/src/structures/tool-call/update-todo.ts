import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toErrorMessage } from '@pi-code/shared/utilities/common';
import { parseTodoList } from '@pi-code/shared/utilities/todo';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Update the checklist of tasks (TODO list) for tracking the current progress of the project.',
  parameters: Type.Object({
    todos: Type.String({ description: 'The updated markdown checklist of TODO items.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      return {
        content: [{ type: 'text', text: 'update_todo success.' }],
        details: { todos: parseTodoList(params.todos) },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating todo list: ${toErrorMessage(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
