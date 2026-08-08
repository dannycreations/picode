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
