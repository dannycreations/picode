import { parseBuiltinCommand } from '@pi-code/shared/commands';

import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';

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
