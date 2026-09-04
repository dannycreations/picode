import { cn } from 'cn';
import { ArrowRight, Check, ListChecks, SquareDashed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getScrollIndex } from '@pi-code/shared/utilities/todo';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';

import type { FC } from 'react';
import type { TodoItem, TodoStatus } from '@pi-code/shared/utilities/todo';

interface TodoHeaderProps {
  readonly todos: TodoItem[];
}

const TodoIcon: FC<{ status: TodoStatus }> = ({ status }) => {
  switch (status) {
    case 'closed':
      return <Check className="w-3.5 h-3.5 shrink-0" />;
    case 'active':
      return <ArrowRight className="w-3.5 h-3.5 shrink-0" />;
    default:
      return <SquareDashed className="w-3.5 h-3.5 shrink-0" />;
  }
};

export const TodoHeader: FC<TodoHeaderProps> = ({ todos }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const scrollIndex = useMemo(() => getScrollIndex(todos), [todos]);
  const mostImportantTodo = scrollIndex === -1 ? undefined : todos[scrollIndex];

  useEffect(() => {
    if (isCollapsed || scrollIndex === -1) return;
    itemRefs.current[scrollIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [todos, isCollapsed, scrollIndex]);

  if (!Array.isArray(todos) || todos.length === 0) return null;

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.status === 'closed').length;
  const allCompleted = completedCount === totalCount && totalCount > 0;

  return (
    <div data-todo-list className="mt-1 -mx-3 border-t border-vscode-sideBar-background overflow-hidden">
      <div
        className={cn(
          'flex items-center gap-2 pt-2 px-3 cursor-pointer select-none',
          mostImportantTodo?.status === 'active' && isCollapsed ? 'text-vscode-charts-yellow' : 'text-vscode-foreground',
        )}
        onClick={() => setIsCollapsed((v) => !v)}
      >
        <ListChecks className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">
          {isCollapsed
            ? allCompleted
              ? `${completedCount} to-dos done`
              : mostImportantTodo?.content
            : `${completedCount} of ${totalCount} to-dos done`}
        </span>
        {isCollapsed && completedCount < totalCount && (
          <div className="shrink-0 text-vscode-descriptionForeground text-xs font-mono">
            {completedCount}/{totalCount}
          </div>
        )}
      </div>

      <Accordion open={!isCollapsed}>
        <ul className="list-none max-h-[300px] overflow-y-auto pt-2 -mb-1 pb-0 px-3 cursor-default">
          {todos.map((todo, idx) => (
            <li
              key={idx}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              className={cn(
                'font-light flex flex-row gap-2 items-start min-h-[20px] leading-normal mb-2 text-xs',
                todo.status === 'active' && 'text-vscode-charts-yellow',
                todo.status !== 'active' && todo.status !== 'closed' && 'opacity-60',
              )}
            >
              <TodoIcon status={todo.status} />
              <span>{todo.content}</span>
            </li>
          ))}
        </ul>
      </Accordion>
    </div>
  );
};

interface TodoBodyProps {
  readonly oldTodos: readonly TodoItem[];
  readonly newTodos: readonly TodoItem[];
  readonly timestamp: number;
}

export const TodoBody: FC<TodoBodyProps> = ({ timestamp, oldTodos, newTodos }) => {
  const isInitialState = oldTodos.length === 0;

  const changedTodos = isInitialState
    ? newTodos
    : newTodos.filter((todo) => {
        if (todo.status !== 'closed' && todo.status !== 'active') return false;
        const previous = oldTodos.find((p) => p.content === todo.content);
        return !previous || previous.status !== todo.status;
      });

  if (changedTodos.length === 0) return null;

  return (
    <div data-todo-changes className="overflow-hidden">
      <MessageHeader icon={<ListChecks className="w-3.5 h-3.5 shrink-0" />} title="Updated to-dos" timestamp={timestamp} />
      <ul className="list-none space-y-1 my-1 pr-1 pt-1 font-light leading-normal">
        {changedTodos.map((todo) => (
          <li
            key={todo.content}
            className={cn(
              'flex flex-row gap-2 items-center',
              todo.status === 'active' && 'text-vscode-charts-yellow',
              todo.status !== 'active' && todo.status !== 'closed' && 'opacity-60',
            )}
          >
            <TodoIcon status={todo.status} />
            <span>{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
