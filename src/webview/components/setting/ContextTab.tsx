import { FoldVertical } from 'lucide-react';

import type { FC } from 'react';
import type { TabProps } from '@webview/components/setting/SettingsView';

export const ContextTab: FC<TabProps> = ({ draftSettings, handleFieldChange, getSliderStyle, sliderClassName }) => {
  return (
    <div className="flex flex-col gap-6 px-5 py-2">
      {/* Enable AGENTS.md rules */}
      <div className="flex flex-col gap-2.5 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.useAgentRules}
            onChange={(e) => handleFieldChange('useAgentRules', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <span className="font-semibold text-sm text-vscode-foreground">Enable AGENTS.md rules</span>
        </label>
        <div className="text-vscode-descriptionForeground text-xs ml-6.5 leading-normal">
          Enable loading of AGENTS.md and CLAUDE.md files for agent-specific rules.
        </div>
      </div>

      {/* Automatic trigger condensing */}
      <div className="flex flex-col gap-2.5 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.autoCondenseContext}
            onChange={(e) => handleFieldChange('autoCondenseContext', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <span className="font-semibold text-sm text-vscode-foreground">Automatic trigger condensing</span>
        </label>

        {/* Condensing Threshold */}
        {draftSettings.autoCondenseContext && (
          <div className="flex flex-col gap-2 ml-4 pl-3 border-l-2 border-vscode-button-background animate-fade-in mt-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-vscode-foreground">
              <FoldVertical size={14} className="text-vscode-descriptionForeground shrink-0" />
              <span>Condensing threshold</span>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="10"
                max="100"
                value={draftSettings.autoCondenseContextPercent}
                style={getSliderStyle(draftSettings.autoCondenseContextPercent, 10, 100)}
                onChange={(e) => handleFieldChange('autoCondenseContextPercent', parseInt(e.target.value, 10))}
                className={sliderClassName}
              />
              <span className="w-10 text-sm text-vscode-foreground text-right">{draftSettings.autoCondenseContextPercent}%</span>
            </div>
            <div className="text-vscode-descriptionForeground text-xs leading-normal">
              The percentage of context window usage at which context condensing is triggered.
            </div>
          </div>
        )}
      </div>

      {/* Open tabs context limit */}
      <div className="flex flex-col gap-2">
        <span className="block font-semibold text-sm text-vscode-foreground">Open tabs context limit</span>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="500"
            value={draftSettings.maxOpenTabsContext}
            style={getSliderStyle(draftSettings.maxOpenTabsContext, 0, 500)}
            onChange={(e) => handleFieldChange('maxOpenTabsContext', parseInt(e.target.value, 10))}
            className={sliderClassName}
          />
          <span className="w-10 text-sm text-vscode-foreground text-right">{draftSettings.maxOpenTabsContext}</span>
        </div>
        <div className="text-vscode-descriptionForeground text-xs mt-1.5 leading-normal">
          Maximum number of VSCode open tabs to include in context. Higher values provide more context but increase token usage.
        </div>
      </div>

      {/* Workspace files context limit */}
      <div className="flex flex-col gap-2">
        <span className="block font-semibold text-sm text-vscode-foreground">Workspace files context limit</span>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="500"
            value={draftSettings.maxWorkspaceFiles}
            style={getSliderStyle(draftSettings.maxWorkspaceFiles, 0, 500)}
            onChange={(e) => handleFieldChange('maxWorkspaceFiles', parseInt(e.target.value, 10))}
            className={sliderClassName}
          />
          <span className="w-10 text-sm text-vscode-foreground text-right">{draftSettings.maxWorkspaceFiles}</span>
        </div>
        <div className="text-vscode-descriptionForeground text-xs mt-1.5 leading-normal">
          Maximum number of files to include in current working directory details. Higher values provide more context but increase token usage.
        </div>
      </div>

      {/* Git status max files */}
      <div className="flex flex-col gap-2">
        <span className="block font-semibold text-sm text-vscode-foreground">Git status max files</span>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="50"
            value={draftSettings.maxGitStatusFiles}
            style={getSliderStyle(draftSettings.maxGitStatusFiles, 0, 50)}
            onChange={(e) => handleFieldChange('maxGitStatusFiles', parseInt(e.target.value, 10))}
            className={sliderClassName}
          />
          <span className="w-10 text-sm text-vscode-foreground text-right">{draftSettings.maxGitStatusFiles}</span>
        </div>
        <div className="text-vscode-descriptionForeground text-xs mt-1.5 leading-normal">
          Maximum number of file entries to include in git status context. Set to 0 to disable. Branch info is always shown when &gt; 0.
        </div>
      </div>

      {/* Concurrent file reads limit */}
      <div className="flex flex-col gap-2">
        <span className="block font-semibold text-sm text-vscode-foreground">Concurrent file reads limit</span>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="1"
            max="100"
            value={draftSettings.maxConcurrentFileReads}
            style={getSliderStyle(draftSettings.maxConcurrentFileReads, 1, 100)}
            onChange={(e) => handleFieldChange('maxConcurrentFileReads', parseInt(e.target.value, 10))}
            className={sliderClassName}
          />
          <span className="w-10 text-sm text-vscode-foreground text-right">{draftSettings.maxConcurrentFileReads}</span>
        </div>
        <div className="text-vscode-descriptionForeground text-xs mt-1.5 leading-normal">
          Maximum number of files the 'read_file' tool can process concurrently. Higher values may speed up reading multiple small files but increase
          memory usage.
        </div>
      </div>
    </div>
  );
};
