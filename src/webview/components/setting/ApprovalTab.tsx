import { Edit, Eye, Plus, Terminal, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { FC } from 'react';
import type { TabProps } from '@webview/components/setting/SettingsView';

type GlobField =
  | 'allowedReadPaths'
  | 'deniedReadPaths'
  | 'allowedWritePaths'
  | 'deniedWritePaths'
  | 'allowedDeletePaths'
  | 'deniedDeletePaths'
  | 'allowedExecuteCommands'
  | 'deniedExecuteCommands';

export const ApprovalTab: FC<TabProps> = ({ draftSettings, handleFieldChange }) => {
  const [readAllowedInput, setReadAllowedInput] = useState('');
  const [readDeniedInput, setReadDeniedInput] = useState('');
  const [writeAllowedInput, setWriteAllowedInput] = useState('');
  const [writeDeniedInput, setWriteDeniedInput] = useState('');
  const [deleteAllowedInput, setDeleteAllowedInput] = useState('');
  const [deleteDeniedInput, setDeleteDeniedInput] = useState('');
  const [executeAllowedInput, setExecuteAllowedInput] = useState('');
  const [executeDeniedInput, setExecuteDeniedInput] = useState('');

  const handleAddGlob = (field: GlobField, input: string, setInput: (v: string) => void) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const current = draftSettings[field] || [];
    if (!current.includes(trimmed)) {
      handleFieldChange(field, [...current, trimmed]);
      setInput('');
    }
  };

  const handleRemoveGlob = (field: GlobField, index: number) => {
    const current = draftSettings[field] || [];
    handleFieldChange(
      field,
      current.filter((_, i) => i !== index),
    );
  };

  const handleMoveToInput = (field: GlobField, index: number, value: string, input: string, setInput: (v: string) => void) => {
    handleRemoveGlob(field, index);
    const trimmed = input.trim();
    setInput(trimmed ? `${trimmed} ${value}` : value);
    setTimeout(() => {
      const el = document.getElementById(`input-${field}`);
      if (el) {
        (el as HTMLInputElement).focus();
      }
    }, 0);
  };

  const renderGlobList = (
    field: GlobField,
    input: string,
    setInput: (v: string) => void,
    placeholder: string,
    label: string,
    description: string,
  ) => {
    const globs = draftSettings[field] || [];
    return (
      <div className="flex flex-col gap-2 mt-2.5 ml-6 pl-3 border-l-2 border-vscode-button-background/60">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-vscode-foreground">{label}</span>
          <span className="text-[10px] text-vscode-descriptionForeground leading-normal">{description}</span>
        </div>
        <div className="flex gap-2">
          <input
            id={`input-${field}`}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddGlob(field, input, setInput);
              }
            }}
            placeholder={placeholder}
            className="h-7 px-2 text-xs rounded border border-vscode-settings-textInputBorder bg-vscode-settings-textInputBackground text-vscode-settings-textInputForeground outline-none focus:border-vscode-focusBorder grow"
          />
          <button
            type="button"
            onClick={() => handleAddGlob(field, input, setInput)}
            className="h-7 px-2.5 text-xs font-semibold rounded cursor-pointer bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border/50 flex items-center justify-center shrink-0"
          >
            <Plus size={14} />
          </button>
        </div>
        {globs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {globs.map((glob, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 text-[11px] rounded bg-vscode-badge-background text-vscode-badge-foreground border border-vscode-editorGroup-border/30"
              >
                <span
                  role="button"
                  tabIndex={0}
                  className="font-mono truncate max-w-[200px] cursor-pointer hover:underline outline-none"
                  title={`Click to edit: ${glob}`}
                  onClick={() => handleMoveToInput(field, idx, glob, input, setInput)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleMoveToInput(field, idx, glob, input, setInput);
                    }
                  }}
                >
                  {glob}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveGlob(field, idx)}
                  className="p-0.5 hover:bg-vscode-list-hoverBackground rounded text-vscode-badge-foreground bg-transparent border-none cursor-pointer flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 px-5 py-2">
      {/* Read tool */}
      <div className="flex flex-col gap-2 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.autoApproveRead}
            onChange={(e) => handleFieldChange('autoApproveRead', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-semibold text-sm text-vscode-foreground">
              <Eye size={14} className="text-vscode-descriptionForeground shrink-0" />
              <span>Read Files</span>
            </div>
            <span className="text-vscode-descriptionForeground text-xs leading-normal font-normal">
              Automatically allow the agent to read files and line ranges (`read_file`).
            </span>
          </div>
        </label>
        {draftSettings.autoApproveRead && (
          <div className="flex flex-col gap-4 mt-2">
            {renderGlobList(
              'allowedReadPaths',
              readAllowedInput,
              setReadAllowedInput,
              'e.g. src/**/*.ts',
              'Allowed Read Paths',
              'Files matching these globs will be auto-approved for reading. Add * to allow all paths.',
            )}
            {renderGlobList(
              'deniedReadPaths',
              readDeniedInput,
              setReadDeniedInput,
              'e.g. env/*.env',
              'Denied Read Paths',
              'Files matching these globs will be blocked from reading, overriding allowed paths.',
            )}
          </div>
        )}
      </div>

      {/* Write tool */}
      <div className="flex flex-col gap-2 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.autoApproveWrite}
            onChange={(e) => handleFieldChange('autoApproveWrite', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-semibold text-sm text-vscode-foreground">
              <Edit size={14} className="text-vscode-descriptionForeground shrink-0" />
              <span>Write & Edit Files</span>
            </div>
            <span className="text-vscode-descriptionForeground text-xs leading-normal font-normal">
              Automatically allow the agent to create and edit files (`write_file`, `edit_file`).
            </span>
          </div>
        </label>
        {draftSettings.autoApproveWrite && (
          <div className="flex flex-col gap-4 mt-2">
            {renderGlobList(
              'allowedWritePaths',
              writeAllowedInput,
              setWriteAllowedInput,
              'e.g. src/**/*.ts',
              'Allowed Write Paths',
              'Files matching these globs will be auto-approved for writing/editing. Add * to allow all paths.',
            )}
            {renderGlobList(
              'deniedWritePaths',
              writeDeniedInput,
              setWriteDeniedInput,
              'e.g. package.json',
              'Denied Write Paths',
              'Files matching these globs will be blocked from writing/editing, overriding allowed paths.',
            )}
          </div>
        )}
      </div>

      {/* Delete tool */}
      <div className="flex flex-col gap-2.5 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.autoApproveDelete}
            onChange={(e) => handleFieldChange('autoApproveDelete', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-semibold text-sm text-vscode-foreground">
              <Trash2 size={14} className="text-vscode-descriptionForeground shrink-0" />
              <span>Delete Files</span>
            </div>
            <span className="text-vscode-descriptionForeground text-xs leading-normal font-normal">
              Automatically allow the agent to delete files (`delete_file`). Use with caution.
            </span>
          </div>
        </label>
        {draftSettings.autoApproveDelete && (
          <div className="flex flex-col gap-4 mt-2">
            {renderGlobList(
              'allowedDeletePaths',
              deleteAllowedInput,
              setDeleteAllowedInput,
              'e.g. temp/**/*.log',
              'Allowed Delete Paths',
              'Files matching these globs will be auto-approved for deleting. Add * to allow all paths.',
            )}
            {renderGlobList(
              'deniedDeletePaths',
              deleteDeniedInput,
              setDeleteDeniedInput,
              'e.g. src/**/*.ts',
              'Denied Delete Paths',
              'Files matching these globs will be blocked from deleting, overriding allowed paths.',
            )}
          </div>
        )}
      </div>

      {/* Execute tool */}
      <div className="flex flex-col gap-2.5 pt-4 border-t border-vscode-editorGroup-border/10">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draftSettings.autoApproveExecute}
            onChange={(e) => handleFieldChange('autoApproveExecute', e.target.checked)}
            className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 font-semibold text-sm text-vscode-foreground">
              <Terminal size={14} className="text-vscode-descriptionForeground shrink-0" />
              <span>Execute Commands</span>
            </div>
            <span className="text-vscode-descriptionForeground text-xs leading-normal font-normal">
              Automatically allow the agent to run terminal commands (`execute_command`). Warning: commands run in your terminal shell environment.
            </span>
          </div>
        </label>
        {draftSettings.autoApproveExecute && (
          <div className="flex flex-col gap-4 mt-2">
            {renderGlobList(
              'allowedExecuteCommands',
              executeAllowedInput,
              setExecuteAllowedInput,
              'e.g. npm',
              'Allowed Commands',
              'Commands starting with these prefixes will be auto-approved. Add * to allow all commands.',
            )}
            {renderGlobList(
              'deniedExecuteCommands',
              executeDeniedInput,
              setExecuteDeniedInput,
              'e.g. rm -rf',
              'Denied Commands',
              'Commands starting with these prefixes will be blocked, overriding allowed commands.',
            )}
          </div>
        )}
      </div>
    </div>
  );
};
