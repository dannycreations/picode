import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';

import type { ToolName } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Replace the project task checklist to track progress.',
  parameters: Type.Object({
    todos: Type.Array(
      Type.Object({
        content: Type.String({ description: 'The task description.' }),
        status: Type.Union([Type.Literal('pending'), Type.Literal('progress'), Type.Literal('completed')], {
          description: 'Current state (pending|progress|completed) of the task.',
        }),
      }),
      { description: 'Complete list; replaces the previous one.' },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return toolResult('Todo list updated.', { todos: params.todos as TodoItem[] });
  },
});
