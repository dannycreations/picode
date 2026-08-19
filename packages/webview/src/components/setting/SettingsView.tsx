import { cn } from 'cnfast';
import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getRootFieldKeys, isFieldVisible, SETTINGS_TABS } from '@pi-code/webview/components/setting/core/fields';
import { SettingControl } from '@pi-code/webview/components/setting/fields/SettingControl';
import { useResponsive } from '@pi-code/webview/components/setting/hooks/useResponsive';
import { useSetting } from '@pi-code/webview/components/setting/hooks/useSetting';
import { ConfirmDialog } from '@pi-code/webview/components/shared/ConfirmDialog';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface SettingsViewProps {
  readonly settings: AppSettings;
  readonly onDone: () => void;
}

export const SettingsView: FC<SettingsViewProps> = ({ settings, onDone }) => {
  const [activeTabId, setActiveTabId] = useState(SETTINGS_TABS[0].id);
  const [isDiscardDialogShow, setDiscardDialogShow] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { draftSettings, isChangeDetected, handleFieldChange, handleSave, resetDraft } = useSetting(settings);

  const { containerRef, isCollapsed, shouldAnimate } = useResponsive(550);

  useEffect(() => {
    if (searchQuery.trim()) {
      const activeTabHasMatch = getRootFieldKeys(activeTabId).some((key) => isFieldVisible(key, searchQuery));
      if (!activeTabHasMatch) {
        const firstTabWithMatch = SETTINGS_TABS.find((tab) => getRootFieldKeys(tab.id).some((key) => isFieldVisible(key, searchQuery)));
        if (firstTabWithMatch) {
          setActiveTabId(firstTabWithMatch.id);
        }
      }
    }
  }, [searchQuery, activeTabId]);

  const checkUnsavedChanges = (proceed: () => void) => {
    if (isChangeDetected) {
      setDiscardDialogShow(true);
    } else {
      proceed();
    }
  };

  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId) || SETTINGS_TABS[0];
  const visibleRootKeys = getRootFieldKeys(activeTab.id).filter((key) => isFieldVisible(key, searchQuery));

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-vscode-sideBar-background text-vscode-foreground select-none overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center gap-2 px-5 py-2.5 border-b border-vscode-panel-border bg-vscode-sideBar-background shrink-0">
        <div className="flex items-center gap-2 grow">
          <Tooltip content="Discard unsaved changes and go back to tasks view" side="bottom">
            <button type="button" onClick={() => checkUnsavedChanges(onDone)} className="icon-button -ml-2 transition-colors duration-150">
              <ArrowLeft size={16} />
            </button>
          </Tooltip>
          <h3 className="text-vscode-foreground m-0 flex-shrink-0 text-sm font-semibold">Settings</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSearchExpanded ? (
            <div className="flex items-center bg-vscode-settings-textInputBackground border border-vscode-focusBorder rounded h-7 px-2 w-44 transition-all duration-200 overflow-hidden">
              <Search size={14} className="shrink-0 text-vscode-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search settings..."
                className="bg-transparent border-none outline-none text-xs w-full text-vscode-settings-textInputForeground placeholder:text-vscode-input-placeholderForeground ml-1.5"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchQuery) {
                      setSearchQuery('');
                    } else {
                      setIsSearchExpanded(false);
                    }
                  }
                }}
                onBlur={() => {
                  if (!searchQuery) {
                    setIsSearchExpanded(false);
                  }
                }}
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="icon-button">
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <Tooltip content="Search settings" side="bottom">
              <button type="button" onClick={() => setIsSearchExpanded(true)} className="icon-button">
                <Search size={16} />
              </button>
            </Tooltip>
          )}

          <button
            type="button"
            disabled={!isChangeDetected}
            onClick={handleSave}
            className={cn('action-button h-7 px-3', isChangeDetected ? '' : 'action-button-secondary opacity-50 cursor-not-allowed border-none')}
          >
            Save
          </button>
        </div>
      </div>

      {/* Main Layout Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Tabs Navigation */}
        <div
          className={cn(
            isCollapsed ? 'w-12' : 'w-48',
            'border-r border-vscode-editorGroup-border/20 flex flex-col shrink-0 py-2 overflow-y-auto overflow-x-hidden bg-vscode-sideBar-background',
            shouldAnimate ? 'transition-all duration-150' : '',
          )}
        >
          {SETTINGS_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = tab.id === activeTabId;
            const hasMatch = !searchQuery.trim() || getRootFieldKeys(tab.id).some((key) => isFieldVisible(key, searchQuery));
            return (
              <Tooltip key={tab.id} content={tab.label} side="right" disabled={!isCollapsed}>
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    'whitespace-nowrap overflow-hidden min-w-0 h-12 py-3 box-border flex items-center border-l-2 text-xs w-full border-y-0 border-r-0 transition-colors duration-150',
                    isCollapsed ? 'justify-center px-0' : 'px-4 gap-2 text-left',
                    isActive
                      ? 'border-vscode-focusBorder bg-vscode-list-activeSelectionBackground text-vscode-foreground font-medium cursor-default'
                      : 'border-transparent text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground hover:text-vscode-foreground cursor-pointer bg-transparent',
                    !hasMatch && 'opacity-40',
                  )}
                >
                  <TabIcon className={cn('w-4 h-4 shrink-0', isActive ? 'text-vscode-foreground' : 'text-vscode-descriptionForeground')} />
                  {!isCollapsed && <span className="tab-label">{tab.label}</span>}
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 overflow-y-auto pb-6 flex flex-col min-w-0 bg-vscode-sideBar-background">
          <div className="sticky top-0 z-10 bg-vscode-sideBar-background text-vscode-sideBar-foreground px-5 pt-6 pb-4">
            <h3 className="text-xl font-semibold text-vscode-foreground m-0">{activeTab.label}</h3>
            <p className="text-muted mt-2 mb-0">{activeTab.description}</p>
          </div>

          {/* Controls are generated from the shared settings schema */}
          <div className="flex flex-col gap-6 px-5 py-2">
            {visibleRootKeys.length > 0 ? (
              visibleRootKeys.map((key) => (
                <SettingControl key={key} settingKey={key} draftSettings={draftSettings} onChange={handleFieldChange} searchQuery={searchQuery} />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-muted">No settings found matching &quot;{searchQuery}&quot;</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Discard confirmation dialog */}
      <ConfirmDialog
        isOpen={isDiscardDialogShow}
        title="Unsaved Changes"
        description="Do you want to discard changes and continue?"
        warningText=""
        confirmLabel="Discard changes"
        cancelLabel="Cancel"
        onConfirm={() => {
          setDiscardDialogShow(false);
          resetDraft();
          onDone();
        }}
        onCancel={() => setDiscardDialogShow(false)}
      />
    </div>
  );
};
