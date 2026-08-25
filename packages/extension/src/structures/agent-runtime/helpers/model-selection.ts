import { getSettingsManager } from '@pi-code/extension/core/settings';
import { applyCompactionSettings } from '@pi-code/extension/structures/agent-runtime/session';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ModelSelection } from '@pi-code/shared/core/protocol';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

export function persistModelAndThinking(selection: ModelSelection, level?: ModelThinkingLevel): void {
  const manager = getSettingsManager(getWorkspaceCwd());
  if (selection.id && selection.provider) {
    manager.setDefaultModelAndProvider(selection.provider, selection.id);
  }
  if (level) {
    manager.setDefaultThinkingLevel(level);
  }
}

export async function applyPersistedModelAndThinking(session: AgentSession): Promise<void> {
  // Honor whatever the footer shows rather than a transient selection: read
  // the persisted model and thinking level and apply them to the session.
  const manager = getSettingsManager(getWorkspaceCwd());

  const provider = manager.getDefaultProvider();
  const modelId = manager.getDefaultModel();
  if (provider && modelId && (session.model?.id !== modelId || session.model?.provider !== provider)) {
    const model = session.modelRuntime.getModel(provider, modelId);
    if (model) {
      try {
        await session.setModel(model);
      } catch (err) {
        logger.warn(`Could not apply persisted model ${provider}/${modelId}:`, err);
      }
    }
  }

  const level = manager.getDefaultThinkingLevel();
  if (level && session.thinkingLevel !== level) {
    try {
      session.setThinkingLevel(level);
    } catch (err) {
      logger.warn(`Could not apply persisted thinking level ${level}:`, err);
    }
  }

  applyCompactionSettings(session);
}
