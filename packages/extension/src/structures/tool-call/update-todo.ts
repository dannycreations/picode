import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
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
          { description: 'Current state (e.g., open, active, or closed) of the task.' },
        ),
      }),
      { description: 'Complete list in order; replaces the previous one.' },
    ),
  }),
  async execute(_toolCallId, params, signal, onUpdate, _ctx) {
    if (signal?.aborted) {
      return toolError('Todo update cancelled.');
    }
    const result = toolResult('Todo list updated.', { todos: params.todos });
    onUpdate?.(result);
    return result;
  },
});
