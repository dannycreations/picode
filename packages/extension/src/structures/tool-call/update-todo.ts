import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';
import { parseTodoList } from '@pi-code/shared/utilities/todo';

import type { ToolName } from '@pi-code/shared/core/types';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Update the project task checklist in order to track complex progress.',
  parameters: Type.Object({
    todos: Type.String({ description: 'Full updated markdown checklist of TODO items.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      return toolResult('Todo list updated.', { todos: parseTodoList(params.todos) });
    } catch (err) {
      return toolErrorFrom(err, 'updating todo list');
    }
  },
});
