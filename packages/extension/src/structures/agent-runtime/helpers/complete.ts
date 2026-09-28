import { contentText } from '@earendil-works/pi-ai';

import { getDefaultModelSelection } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { logger } from '@pi-code/shared/core/logger';
import { extractCodeBlock } from '@pi-code/shared/utilities/markdown';

import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelSelection } from '@pi-code/shared/core/protocol';

function resolveModel(runtime: ModelRuntime, selection: Partial<ModelSelection> | undefined) {
  return selection?.provider && selection.id ? runtime.getModel(selection.provider, selection.id) : undefined;
}

async function completePrompt(cwd: string, prompt: string, signal?: AbortSignal, preferred?: ModelSelection): Promise<string> {
  const runtime = (await createAgentResources(cwd)).modelRuntime;
  // Reading the default model reloads the agent settings, so only pay for it
  // when the preferred selection does not name a model this runtime knows.
  const model = resolveModel(runtime, preferred) ?? resolveModel(runtime, await getDefaultModelSelection(cwd)) ?? runtime.getAvailableSnapshot()[0];
  if (!model) {
    throw new Error('No model configured or available. Please configure your model settings in pi-agent.');
  }

  logger.debug('Sending completion request to backend...');
  const response = await runtime.completeSimple(model, { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] }, { signal });
  logger.debug('Completion response received successfully.');

  const primaryText = contentText(response.content).trim();
  if (primaryText) {
    return primaryText;
  }

  return response.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('\n');
}

export async function completeAndExtract(cwd: string, prompt: string, signal?: AbortSignal, preferredModel?: ModelSelection): Promise<string> {
  return extractCodeBlock(await completePrompt(cwd, prompt, signal, preferredModel));
}
