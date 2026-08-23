import { useEffect, useMemo } from 'react';

import { defaultThinkingLevel, resolveContextLimit } from '@pi-code/shared/utilities/common';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { CommandItem, ModelItem } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

interface UseChatConfigReturn {
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: string;
  readonly setSelectedModel: (modelId: string) => void;
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
  const selectedThinkingLevel = useChatStore((state) => state.selectedThinkingLevel);
  const setSelectedModel = useChatStore((state) => state.setSelectedModel);
  const setSelectedThinkingLevel = useChatStore((state) => state.setSelectedThinkingLevel);

  const selectedModelItem = useMemo(() => models.find((model) => model.id === selectedModel), [models, selectedModel]);

  const thinkingLevels = selectedModelItem?.thinkingLevels ?? [];
  const supportsImages = selectedModelItem?.supportsImages ?? false;
  const selectedModelContextWindow = resolveContextLimit(selectedModelItem?.contextWindow);

  // Keep the displayed level valid for the selected model; drop to a default
  // only when the current choice is unsupported (e.g. after a model switch).
  useEffect(() => {
    const current = useChatStore.getState().selectedThinkingLevel;
    const next = thinkingLevels.length === 0 ? null : current && thinkingLevels.includes(current) ? current : defaultThinkingLevel(thinkingLevels);
    useChatStore.getState().syncSelectedThinkingLevel(next);
  }, [thinkingLevels]);

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
