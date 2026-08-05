import { cn } from 'cnfast';
import { ArrowRight, Check, ListChecks, SquareDashed } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getMostImportantTodo, getScrollIndex } from '@extension/webview/components/chat/helpers/todo';

import type { FC } from 'react';
import type { TodoItem, TodoStatus } from '@extension/webview/components/chat/helpers/todo';

export interface TodoViewProps {
  readonly todos: TodoItem[];
}

const TodoIcon: FC<{ status: TodoStatus }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <Check className="w-3 h-3 mt-1 shrink-0" />;
    case 'in_progress':
      return <ArrowRight className="w-3 h-3 mt-1 shrink-0" />;
    default:
      return <SquareDashed className="w-3 h-3 mt-1 shrink-0" />;
  }
};

export const TodoView: FC<TodoViewProps> = ({ todos }) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const ulRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const scrollIndex = useMemo(() => getScrollIndex(todos), [todos]);
  const mostImportantTodo = useMemo(() => getMostImportantTodo(todos), [todos]);

  useEffect(() => {
    if (isCollapsed || !ulRef.current || scrollIndex === -1) return;
    const target = itemRefs.current[scrollIndex];
    if (target) {
      const ul = ulRef.current;
      const targetTop = target.offsetTop - ul.offsetTop;
      const scrollTo = targetTop - (ul.clientHeight / 2 - target.offsetHeight / 2);
      ul.scrollTop = scrollTo;
    }
  }, [todos, isCollapsed, scrollIndex]);

  if (!Array.isArray(todos) || todos.length === 0) return null;

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const allCompleted = completedCount === totalCount && totalCount > 0;

  return (
    <div data-todo-list className="mt-1 -mx-3 border-t border-vscode-sideBar-background overflow-hidden">
      <div
        className={cn(
          'flex items-center gap-2 pt-2 px-3 cursor-pointer select-none',
          mostImportantTodo?.status === 'in_progress' && isCollapsed ? 'text-vscode-charts-yellow' : 'text-vscode-foreground',
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
          <div className="shrink-0 text-vscode-descriptionForeground text-[10px] font-mono">
            {completedCount}/{totalCount}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <ul ref={ulRef} className="list-none max-h-[300px] overflow-y-auto mt-2 -mb-1 pb-0 px-3 cursor-default">
          {todos.map((todo, idx) => (
            <li
              key={idx}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              className={cn(
                'font-light flex flex-row gap-2 items-start min-h-[20px] leading-normal mb-2 text-xs',
                todo.status === 'in_progress' && 'text-vscode-charts-yellow',
                todo.status !== 'in_progress' && todo.status !== 'completed' && 'opacity-60',
              )}
            >
              <TodoIcon status={todo.status} />
              <span>{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
