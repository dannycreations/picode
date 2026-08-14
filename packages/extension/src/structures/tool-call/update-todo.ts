import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';

import type { ToolName } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Update the project task checklist in order to track complex progress.',
  parameters: Type.Object({
    todos: Type.Array(
      Type.Object({
        content: Type.String({ description: 'The task description.' }),
        status: Type.Union([Type.Literal('pending'), Type.Literal('progress'), Type.Literal('completed')], {
          description: 'Current state of the task.',
        }),
      }),
      { description: 'Provide the complete list every time (it replaces the previous one).' },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return toolResult('Todo list updated.', { todos: params.todos as TodoItem[] });
  },
});
