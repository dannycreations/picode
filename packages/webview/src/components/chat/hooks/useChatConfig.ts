import { useCallback, useEffect, useMemo, useState } from 'react';

import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { defaultThinkingLevel } from '@pi-code/shared/utilities/common';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { CommandItem, ExtensionToWebviewMessage, ModelItem, ModelSelection } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

interface UseChatConfigReturn {
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: string;
  readonly modelSelection: ModelSelection;
  readonly setSelectedModel: (modelId: string) => void;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
  readonly selectedThinkingLevel: ModelThinkingLevel | null;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel) => void;
  readonly supportsImages: boolean;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatConfig = (): UseChatConfigReturn => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedModel, setSelectedModelState] = useState(DEFAULT_APP_ID);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [selectedThinkingLevel, setSelectedThinkingLevelState] = useState<ModelThinkingLevel | null>(null);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data': {
        const {
          models: backendModels,
          default_model: defaultModel,
          default_thinking_level: initialThinkingLevel,
          settings: backendSettings,
          commands: backendCommands,
        } = msg.payload;
        setModels(backendModels);
        setSettings(backendSettings ?? null);
        setCommands(backendCommands ?? []);
        setSelectedModelState(defaultModel || backendModels[0]?.id || DEFAULT_APP_ID);
        setSelectedThinkingLevelState(initialThinkingLevel ?? null);
        break;
      }

      case 'commands_data':
        setCommands(msg.payload.commands);
        break;

      case 'models_data':
        setModels(msg.payload.models);
        break;

      case 'settings_data':
        setSettings(msg.payload.settings);
        break;
    }
  }, []);

  // The id alone is ambiguous when two providers expose the same model, so the
  // provider is resolved once here for every message that carries a model.
  const modelSelection = useMemo<ModelSelection>(
    () => ({ id: selectedModel, provider: models.find((m) => m.id === selectedModel)?.provider ?? '' }),
    [models, selectedModel],
  );

  const thinkingLevels = useMemo<readonly ModelThinkingLevel[]>(
    () => models.find((m) => m.id === selectedModel)?.thinkingLevels ?? [],
    [models, selectedModel],
  );

  // Keep the displayed level valid for the selected model; drop to a default
  // only when the current choice is unsupported (e.g. after a model switch).
  useEffect(() => {
    setSelectedThinkingLevelState((current) => {
      if (thinkingLevels.length === 0) return null;
      if (current && thinkingLevels.includes(current)) return current;
      return defaultThinkingLevel(thinkingLevels);
    });
  }, [thinkingLevels]);

  const supportsImages = useMemo<boolean>(() => models.find((model) => model.id === selectedModel)?.supportsImages ?? false, [models, selectedModel]);

  // Picking a model also re-publishes the current thinking level (clamped to what
  // the new model supports) so the persisted pair always matches the footer.
  const setSelectedModel = useCallback(
    (modelId: string): void => {
      const model = models.find((m) => m.id === modelId);
      if (!model) return;
      const levels = model.thinkingLevels ?? [];
      const level = selectedThinkingLevel && levels.includes(selectedThinkingLevel) ? selectedThinkingLevel : defaultThinkingLevel(levels);
      setSelectedModelState(modelId);
      setSelectedThinkingLevelState(level);
      vscode?.postMessage({ type: 'set_model', model: { id: model.id, provider: model.provider }, thinkingLevel: level ?? undefined });
    },
    [models, selectedThinkingLevel],
  );

  const setSelectedThinkingLevel = useCallback(
    (level: ModelThinkingLevel): void => {
      setSelectedThinkingLevelState(level);
      vscode?.postMessage({ type: 'set_model', model: modelSelection, thinkingLevel: level });
    },
    [modelSelection],
  );

  return {
    models,
    settings,
    commands,
    selectedModel,
    modelSelection,
    setSelectedModel,
    thinkingLevels,
    selectedThinkingLevel,
    setSelectedThinkingLevel,
    supportsImages,
    onMessage,
  };
};
