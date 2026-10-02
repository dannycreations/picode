import { useMemo } from 'react';

import { findModel } from '@pi-code/shared/core/protocol';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';
import { selectThinkingLevel, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { CommandItem, ModelItem, ModelSelection } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

interface UseChatConfigReturn {
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: ModelSelection;
  readonly setSelectedModel: (model: ModelItem) => void;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
  readonly selectedThinkingLevel: ModelThinkingLevel | null;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel) => void;
  readonly supportsImages: boolean;
  readonly selectedModelContextWindow: number;
}

export const useChatConfig = (): UseChatConfigReturn => {
  const models = useChatStore((state) => state.models);
  const settings = useChatStore((state) => state.settings);
  const commands = useChatStore((state) => state.commands);
  const selectedModel = useChatStore((state) => state.selectedModel);
  const selectedThinkingLevel = useChatStore(selectThinkingLevel);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);
  const setSelectedThinkingLevel = useChatStore((state) => state.setSelectedThinkingLevel);

  const selectedModelItem = useMemo(() => findModel(models, selectedModel), [models, selectedModel]);

  const thinkingLevels = useMemo(() => selectedModelItem?.thinkingLevels ?? [], [selectedModelItem]);
  const supportsImages = selectedModelItem?.supportsImages ?? false;
  const selectedModelContextWindow = resolveContextLimit(selectedModelItem?.contextWindow);

  return {
    models,
    settings,
    commands,
    selectedModel,
    setSelectedModel,
    thinkingLevels,
    selectedThinkingLevel,
    setSelectedThinkingLevel,
    supportsImages,
    selectedModelContextWindow,
  };
};
