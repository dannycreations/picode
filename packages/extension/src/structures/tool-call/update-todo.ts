import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { TODO_STATUSES } from '@pi-code/shared/utilities/todo';

import type { ToolName } from '@pi-code/shared/core/types';

const UpdateTodoSchema = Type.Object({
  todos: Type.Array(
    Type.Object({
      content: Type.String({ description: 'The task description.' }),
      status: Type.Enum(TODO_STATUSES, { description: `Current status (e.g., ${TODO_STATUSES.join(', ')}) of the task.` }),
    }),
    { description: 'Complete list in order; replaces the previous one.' },
  ),
});

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Replace the project task checklist to track progress.',
  parameters: UpdateTodoSchema,
  prepareArguments(args) {
    const input = args as Type.Static<typeof UpdateTodoSchema>;
    const todos = input?.todos;
    if (!Array.isArray(todos)) return input;

    const invalid = todos.reduce<string[]>((acc, todo) => {
      if (typeof todo?.status === 'string' && !TODO_STATUSES.includes(todo.status)) {
        acc.push(`"${todo.status}" at "${todo.content ?? '(unnamed)'}"`);
      }
      return acc;
    }, []);

    if (invalid.length > 0) {
      throw new Error(
        [
          'Invalid todo statuses:',
          ...invalid.map((item) => `  - ${item}`),
          '',
          `Allowed values: ${TODO_STATUSES.map((s) => `"${s}"`).join(', ')}.`,
        ].join('\n'),
      );
    }

    return input;
  },
  async execute(_toolCallId, params, signal, onUpdate, _ctx) {
    if (signal?.aborted) {
      return toolError('Todo update cancelled.');
    }
    const result = toolResult('Todo list updated.', { todos: params.todos });
    onUpdate?.(result);
    return result;
  },
});
