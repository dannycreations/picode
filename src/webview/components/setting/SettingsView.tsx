import { ArrowLeft, Sliders, ToggleLeft, ToggleRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { vscode } from '@webview/utilities/vscode';

import type { FC } from 'react';
import type { AppSettings } from '@extension/core/settings';

interface SettingsViewProps {
  readonly onDone: () => void;
}

export const SettingsView: FC<SettingsViewProps> = ({ onDone }) => {
  // Local states for settings
  const [maxOpenTabsContext, setMaxOpenTabsContext] = useState(20);
  const [maxWorkspaceFiles, setMaxWorkspaceFiles] = useState(200);
  const [maxGitStatusFiles, setMaxGitStatusFiles] = useState(20);
  const [maxConcurrentFileReads, setMaxConcurrentFileReads] = useState(10);
  const [autoCondenseContext, setAutoCondenseContext] = useState(true);
  const [autoCondenseContextPercent, setAutoCondenseContextPercent] = useState(80);

  // Request settings on mount
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ type: 'get_settings' });
    }
  }, []);

  // Listen for settings from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'settings_data' && msg.payload?.settings) {
        const s = msg.payload.settings as AppSettings;
        setMaxOpenTabsContext(s.maxOpenTabsContext ?? 20);
        setMaxWorkspaceFiles(s.maxWorkspaceFiles ?? 200);
        setMaxGitStatusFiles(s.maxGitStatusFiles ?? 20);
        setMaxConcurrentFileReads(s.maxConcurrentFileReads ?? 10);
        setAutoCondenseContext(s.autoCondenseContext ?? true);
        setAutoCondenseContextPercent(s.autoCondenseContextPercent ?? 80);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Helper to update setting on change
  const handleChange = (key: keyof AppSettings, value: unknown) => {
    // Optimistic local update
    switch (key) {
      case 'maxOpenTabsContext':
        setMaxOpenTabsContext(value as number);
        break;
      case 'maxWorkspaceFiles':
        setMaxWorkspaceFiles(value as number);
        break;
      case 'maxGitStatusFiles':
        setMaxGitStatusFiles(value as number);
        break;
      case 'maxConcurrentFileReads':
        setMaxConcurrentFileReads(value as number);
        break;
      case 'autoCondenseContext':
        setAutoCondenseContext(value as boolean);
        break;
      case 'autoCondenseContextPercent':
        setAutoCondenseContextPercent(value as number);
        break;
      default:
        break;
    }

    if (vscode) {
      vscode.postMessage({ type: 'update_setting', key, value });
    }
  };

  return (
    <div className="flex flex-col h-full bg-vscode-sideBar-background text-vscode-foreground select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-vscode-editorGroup-border/30 shrink-0">
        <button
          onClick={onDone}
          className="p-1 hover:bg-vscode-list-hoverBackground rounded text-vscode-foreground bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors duration-150"
          title="Back to Chat"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold m-0 text-vscode-foreground leading-tight">Settings</h2>
          <span className="text-[10px] text-vscode-descriptionForeground leading-none mt-0.5">Configure Pi Code behavior</span>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Tabs Navigation */}
        <div className="w-24 border-r border-vscode-editorGroup-border/20 flex flex-col shrink-0 py-2">
          <button className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-vscode-list-activeSelectionBackground text-vscode-foreground border-l-2 border-vscode-focusBorder text-left w-full border-y-0 border-r-0 cursor-default">
            <Sliders size={12} />
            <span>Context</span>
          </button>
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-5 min-w-0">
          <div className="flex flex-col">
            <h3 className="text-xs font-bold uppercase tracking-wider text-vscode-descriptionForeground m-0">Context Management</h3>
            <p className="text-[10px] text-vscode-descriptionForeground mt-1 mb-0 leading-normal">
              Manage parameters controlling workspace, open files, and git repository context limits.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {/* Open tabs context limit */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-vscode-foreground">Open tabs context limit</label>
                <span className="text-[10px] font-mono text-vscode-descriptionForeground">{maxOpenTabsContext}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={maxOpenTabsContext}
                  onChange={(e) => handleChange('maxOpenTabsContext', parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-vscode-editorGroup-border/50 rounded-lg appearance-none cursor-pointer accent-vscode-focusBorder"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={maxOpenTabsContext}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                    handleChange('maxOpenTabsContext', val);
                  }}
                  className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground focus:border-vscode-focusBorder outline-none font-mono"
                />
              </div>
              <span className="text-[10px] text-vscode-descriptionForeground leading-normal">
                Maximum number of open files in the editor tabs to include in context.
              </span>
            </div>

            {/* Workspace files context limit */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-vscode-foreground">Workspace files context limit</label>
                <span className="text-[10px] font-mono text-vscode-descriptionForeground">{maxWorkspaceFiles}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="500"
                  value={maxWorkspaceFiles}
                  onChange={(e) => handleChange('maxWorkspaceFiles', parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-vscode-editorGroup-border/50 rounded-lg appearance-none cursor-pointer accent-vscode-focusBorder"
                />
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={maxWorkspaceFiles}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 0));
                    handleChange('maxWorkspaceFiles', val);
                  }}
                  className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground focus:border-vscode-focusBorder outline-none font-mono"
                />
              </div>
              <span className="text-[10px] text-vscode-descriptionForeground leading-normal">
                Maximum number of workspace files to catalog and search.
              </span>
            </div>

            {/* Git status max files */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-vscode-foreground">Git status max files</label>
                <span className="text-[10px] font-mono text-vscode-descriptionForeground">{maxGitStatusFiles}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={maxGitStatusFiles}
                  onChange={(e) => handleChange('maxGitStatusFiles', parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-vscode-editorGroup-border/50 rounded-lg appearance-none cursor-pointer accent-vscode-focusBorder"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={maxGitStatusFiles}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                    handleChange('maxGitStatusFiles', val);
                  }}
                  className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground focus:border-vscode-focusBorder outline-none font-mono"
                />
              </div>
              <span className="text-[10px] text-vscode-descriptionForeground leading-normal">
                Maximum number of modified or untracked repository files to list.
              </span>
            </div>

            {/* Concurrent file reads limit */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-vscode-foreground">Concurrent file reads limit</label>
                <span className="text-[10px] font-mono text-vscode-descriptionForeground">{maxConcurrentFileReads}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={maxConcurrentFileReads}
                  onChange={(e) => handleChange('maxConcurrentFileReads', parseInt(e.target.value, 10))}
                  className="flex-1 h-1 bg-vscode-editorGroup-border/50 rounded-lg appearance-none cursor-pointer accent-vscode-focusBorder"
                />
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={maxConcurrentFileReads}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1));
                    handleChange('maxConcurrentFileReads', val);
                  }}
                  className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground focus:border-vscode-focusBorder outline-none font-mono"
                />
              </div>
              <span className="text-[10px] text-vscode-descriptionForeground leading-normal">
                Maximum number of files the agent is allowed to read at the same time.
              </span>
            </div>

            {/* Automatic trigger condensing */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-vscode-editorGroup-border/10">
              <div className="flex items-center justify-between">
                <div className="flex flex-col pr-2">
                  <label className="text-xs font-semibold text-vscode-foreground">Automatic trigger condensing</label>
                  <span className="text-[10px] text-vscode-descriptionForeground leading-normal mt-0.5">
                    Automatically condense the chat context history when it reaches the threshold.
                  </span>
                </div>
                <button
                  onClick={() => handleChange('autoCondenseContext', !autoCondenseContext)}
                  className="bg-transparent border-none p-0 cursor-pointer flex items-center text-vscode-focusBorder focus:outline-none shrink-0"
                >
                  {autoCondenseContext ? <ToggleRight size={28} /> : <ToggleLeft className="text-vscode-descriptionForeground" size={28} />}
                </button>
              </div>

              {/* Condensing Threshold */}
              {autoCondenseContext && (
                <div className="flex flex-col gap-1.5 ml-2 pl-3 border-l-2 border-vscode-focusBorder/20 animate-fade-in">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-vscode-foreground">Condensing threshold</label>
                    <span className="text-[10px] font-mono text-vscode-descriptionForeground">{autoCondenseContextPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="10"
                      max="90"
                      value={autoCondenseContextPercent}
                      onChange={(e) => handleChange('autoCondenseContextPercent', parseInt(e.target.value, 10))}
                      className="flex-1 h-1 bg-vscode-editorGroup-border/50 rounded-lg appearance-none cursor-pointer accent-vscode-focusBorder"
                    />
                    <input
                      type="number"
                      min="10"
                      max="90"
                      value={autoCondenseContextPercent}
                      onChange={(e) => {
                        const val = Math.max(10, Math.min(90, parseInt(e.target.value, 10) || 10));
                        handleChange('autoCondenseContextPercent', val);
                      }}
                      className="w-12 px-1.5 py-0.5 text-xs text-center rounded border border-vscode-input-border bg-vscode-input-background text-vscode-input-foreground focus:border-vscode-focusBorder outline-none font-mono"
                    />
                  </div>
                  <span className="text-[10px] text-vscode-descriptionForeground leading-normal">
                    The percentage of context window usage at which context condensing is triggered.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
