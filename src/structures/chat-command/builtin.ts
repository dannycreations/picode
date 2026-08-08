import type { MessageHandlerContext } from '@extension/structures/agent-webview/types';

const BUILTIN_COMMAND_PATTERN = /^\/(\S+)\s*$/;

export const BUILTIN_COMMANDS = [
  { name: 'reload', description: 'Reload skills, context files, and configuration without restarting.' },
  { name: 'compact', description: 'Summarize the current conversation to free up context.' },
] as const satisfies ReadonlyArray<{ name: string; description: string }>;

export type BuiltinCommandName = (typeof BUILTIN_COMMANDS)[number]['name'];

export function isBuiltinCommand(name: string): name is BuiltinCommandName {
  return BUILTIN_COMMANDS.some((command) => command.name === name);
}

export function parseBuiltinCommand(text: string): BuiltinCommandName | null {
  const match = BUILTIN_COMMAND_PATTERN.exec(text.trim());
  if (!match) return null;

  const name = match[1];
  return isBuiltinCommand(name) ? name : null;
}

export async function runCompact(ctx: MessageHandlerContext, id: string, title: string, path: string | undefined): Promise<void> {
  if (!path) {
    ctx.postMessage({ type: 'info', payload: { text: 'Open or start a task before using /compact.' } });
    return;
  }

  await ctx.agent.compact(path, ctx.webview);
  const { messages, stats } = await ctx.sessionService.loadSessionDetails(path, ctx.cwd);
  ctx.postMessage({
    type: 'session_loaded',
    payload: { id: id || 'task-active', title: title || '', messages, path, ...stats },
  });
}

export function runBuiltinCommand(ctx: MessageHandlerContext, text: string, path: string | undefined): boolean {
  const builtin = parseBuiltinCommand(text);
  if (!builtin) return false;

  switch (builtin) {
    case 'reload':
      void ctx.agent.reload(ctx.webview);
      return true;
    case 'compact':
      void runCompact(ctx, '', '', path || ctx.agent.getSessionFile());
      return true;
  }
}
