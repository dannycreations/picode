import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { TODO_STATUSES } from '@pi-code/shared/utilities/todo';

import type { ToolName } from '@pi-code/shared/core/types';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Replace the project task checklist to track progress.',
  parameters: Type.Object({
    todos: Type.Array(
      Type.Object({
        content: Type.String({ description: 'The task description.' }),
        status: Type.Union(
          TODO_STATUSES.map((status) => Type.Literal(status)),
          { description: 'Current state (pending|progress|completed) of the task.' },
        ),
      }),
      { description: 'Complete list in order; replaces the previous one.' },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    return toolResult('Todo list updated.', { todos: params.todos });
  },
});
