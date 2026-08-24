import { contentText } from '@earendil-works/pi-ai';

import { getDefaultModelSelection } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { logger } from '@pi-code/shared/core/logger';

export async function completePrompt(cwd: string, prompt: string): Promise<string> {
  const runtime = (await createAgentResources(cwd)).modelRuntime;
  const { id, provider } = await getDefaultModelSelection(cwd);

  const model = (provider && id && runtime.getModel(provider, id)) || runtime.getAvailableSnapshot()[0];
  if (!model) {
    throw new Error('No model configured or available. Please configure your model settings in pi-agent.');
  }

  logger.debug('Sending completion request to backend...');
  const response = await runtime.completeSimple(model, {
    messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }],
  });
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
