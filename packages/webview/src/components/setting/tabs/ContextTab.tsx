import { FoldVertical } from 'lucide-react';

import { SettingCheckbox } from '@pi-code/webview/components/setting/shared/SettingCheckbox';
import { SettingSlider } from '@pi-code/webview/components/setting/shared/SettingSlider';

import type { FC } from 'react';
import type { TabProps } from '@pi-code/webview/components/setting/shared/types';

export const ContextTab: FC<TabProps> = ({ draftSettings, handleFieldChange }) => {
  return (
    <div className="flex flex-col gap-6 px-5 py-2">
      <SettingCheckbox
        label="Automatic trigger compaction"
        description="Automatically compact conversation context when it reaches the threshold."
        checked={draftSettings.autoCompactContext}
        onChange={(val) => handleFieldChange('autoCompactContext', val)}
      >
        <SettingSlider
          label="Compaction threshold"
          icon={<FoldVertical size={14} className="text-vscode-descriptionForeground shrink-0" />}
          value={draftSettings.autoCompactContextPercent}
          min={10}
          max={100}
          unit="%"
          description="The percentage of the context window in use for trigger."
          onChange={(val) => handleFieldChange('autoCompactContextPercent', val)}
        />
      </SettingCheckbox>

      <SettingSlider
        label="Open tabs context limit"
        value={draftSettings.maxOpenTabsContext}
        min={0}
        max={500}
        description="Maximum number of VSCode open tabs to include in context. Higher values provide more context but increase token usage."
        onChange={(val) => handleFieldChange('maxOpenTabsContext', val)}
      />

      <SettingSlider
        label="Workspace files context limit"
        value={draftSettings.maxWorkspaceFiles}
        min={0}
        max={500}
        description="Maximum number of files to include in current working directory details. Higher values provide more context but increase token usage."
        onChange={(val) => handleFieldChange('maxWorkspaceFiles', val)}
      />

      <SettingSlider
        label="Git status max files"
        value={draftSettings.maxGitStatusFiles}
        min={0}
        max={50}
        description="Maximum number of file entries to include in git status context. Set to 0 to disable. Branch info is always shown when > 0."
        onChange={(val) => handleFieldChange('maxGitStatusFiles', val)}
      />

      <SettingSlider
        label="Concurrent file reads limit"
        value={draftSettings.maxConcurrentFileReads}
        min={1}
        max={100}
        description="Maximum number of files the 'read_file' tool can process concurrently. Higher values may speed up reading multiple small files but increase memory usage."
        onChange={(val) => handleFieldChange('maxConcurrentFileReads', val)}
      />

      <SettingSlider
        label="Tool output line limit"
        value={draftSettings.maxToolOutputLines}
        min={100}
        max={10000}
        step={100}
        description="Maximum number of lines a single tool result may send to the model. Whichever limit is reached first, lines or size, triggers truncation."
        onChange={(val) => handleFieldChange('maxToolOutputLines', val)}
      />

      <SettingSlider
        label="Tool output size limit"
        value={draftSettings.maxToolOutputSizeKb}
        min={5}
        max={500}
        step={5}
        unit="KB"
        description="Maximum size a single tool result may send to the model. Truncated results keep a notice explaining how to retrieve the remaining output."
        onChange={(val) => handleFieldChange('maxToolOutputSizeKb', val)}
      />
    </div>
  );
};
