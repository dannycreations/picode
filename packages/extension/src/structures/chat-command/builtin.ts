import { postSessionLoaded } from '@pi-code/extension/structures/agent-webview/dispatcher';

import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';

export async function runCompact(ctx: MessageHandlerContext, id: string, title: string, path: string | undefined): Promise<void> {
  if (!path) {
    ctx.postMessage({ type: 'info', payload: { text: 'Open or start a task before using /compact.' } });
    return;
  }

  await ctx.agent.compact(path, ctx.webview);
  await postSessionLoaded(ctx, id, title, path);
}
