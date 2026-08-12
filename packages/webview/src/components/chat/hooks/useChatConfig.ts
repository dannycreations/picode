import { useCallback, useState } from 'react';

import { DEFAULT_MODEL_ID } from '@pi-code/shared/core/protocol';

import type { Dispatch, SetStateAction } from 'react';
import type { CommandItem, ExtensionToWebviewMessage, ModelItem } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface UseChatConfigReturn {
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: string;
  readonly setSelectedModel: Dispatch<SetStateAction<string>>;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatConfig = (): UseChatConfigReturn => {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [commands, setCommands] = useState<CommandItem[]>([]);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data': {
        const { models: backendModels, default_model: defaultModel, settings: backendSettings, commands: backendCommands } = msg.payload;
        setModels(backendModels);
        setSettings(backendSettings ?? null);
        setCommands(backendCommands ?? []);
        setSelectedModel(defaultModel || backendModels[0]?.id || DEFAULT_MODEL_ID);
        break;
      }

      case 'commands_data':
        setCommands(msg.payload.commands);
        break;

      case 'settings_data':
        setSettings(msg.payload.settings);
        break;
    }
  }, []);

  return { models, settings, commands, selectedModel, setSelectedModel, onMessage };
};
