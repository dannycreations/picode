import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { parseTodoList } from '@extension/structures/chat-session/todo';

import type { TodoItem } from '@extension/structures/chat-session/todo';
import type { ToolName } from '@extension/types/webview';

export const updateTodoTool = defineTool({
  name: 'update_todo' as ToolName,
  label: 'Update Todo List',
  description: 'Update the checklist of tasks (TODO list) for tracking the current progress of the project.',
  parameters: Type.Object({
    todos: Type.String({ description: 'The updated markdown checklist of TODO items.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      // Parse to validate/clean (just ensuring it is formatted well)
      const lines = params.todos
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const checklistLines = lines.map((line) => {
        // Match standard checkbox patterns: [ ], [x], [-]
        const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s*(.+)$/);
        if (match) {
          let box = '[ ]';
          const indicator = match[1].toLowerCase();
          if (indicator === 'x') {
            box = '[x]';
          } else if (indicator === '-' || indicator === '~') {
            box = '[-]';
          }
          return `- ${box} ${match[2]}`;
        }
        return line;
      });

      const updatedChecklist = checklistLines.join('\n');
      const todos: TodoItem[] = parseTodoList(updatedChecklist);

      return {
        content: [{ type: 'text', text: 'update_todo success.' }],
        details: { todos },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error updating todo list: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});
