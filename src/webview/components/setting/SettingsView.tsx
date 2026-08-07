import { cn } from 'cnfast';
import { ArrowLeft, Database, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { useResponsive } from '@extension/webview/components/setting/hooks/useResponsive';
import { useSetting } from '@extension/webview/components/setting/hooks/useSetting';
import { AbilityTab } from '@extension/webview/components/setting/tabs/AbilityTab';
import { ApprovalTab } from '@extension/webview/components/setting/tabs/ApprovalTab';
import { ContextTab } from '@extension/webview/components/setting/tabs/ContextTab';
import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';

import type { FC } from 'react';
import type { AppSettings } from '@extension/core/settings';
import type { SettingsTab } from '@extension/webview/components/setting/shared/types';

const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'ability',
    label: 'Ability',
    icon: Sparkles,
    title: 'Ability',
    description: 'Choose which optional abilities the agent can use while working on your tasks.',
    component: AbilityTab,
  },
  {
    id: 'approval',
    label: 'Approval',
    icon: ShieldCheck,
    title: 'Approval',
    description: 'Configure auto-approval settings for agent actions to balance speed and safety.',
    component: ApprovalTab,
  },
  {
    id: 'context',
    label: 'Context',
    icon: Database,
    title: 'Context',
    description: 'Control what information is included in the context window, affecting token usage and response quality.',
    component: ContextTab,
  },
];

interface SettingsViewProps {
  readonly settings: AppSettings;
  readonly onDone: () => void;
}

export const SettingsView: FC<SettingsViewProps> = ({ settings, onDone }) => {
  const [activeTabId, setActiveTabId] = useState(SETTINGS_TABS[0].id);
  const [isDiscardDialogShow, setDiscardDialogShow] = useState(false);

  const { draftSettings, isChangeDetected, handleFieldChange, handleSave, resetDraft } = useSetting(settings);

  const { containerRef, isCollapsed } = useResponsive(500, true);

  const checkUnsavedChanges = (proceed: () => void) => {
    if (isChangeDetected) {
      setDiscardDialogShow(true);
    } else {
      proceed();
    }
  };

  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId) || SETTINGS_TABS[0];
  const ActiveTabComponent = activeTab.component;

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-vscode-sideBar-background text-vscode-foreground select-none overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center gap-2 px-5 py-2.5 border-b border-vscode-panel-border bg-vscode-sideBar-background shrink-0">
        <div className="flex items-center gap-2 grow">
          <button
            type="button"
            onClick={() => checkUnsavedChanges(onDone)}
            className="p-1.5 -ml-2 hover:bg-vscode-list-hoverBackground rounded text-vscode-foreground bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors duration-150"
            title="Discard unsaved changes and go back to tasks view"
          >
            <ArrowLeft size={16} />
          </button>
          <h3 className="text-vscode-foreground m-0 flex-shrink-0 text-sm font-semibold">Settings</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!isChangeDetected}
            onClick={handleSave}
            className={cn(
              'h-7 px-3 text-xs font-semibold rounded cursor-pointer transition-colors duration-150',
              isChangeDetected
                ? 'bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none'
                : 'bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border-none opacity-50 cursor-not-allowed',
            )}
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
            'border-r border-vscode-editorGroup-border/20 flex flex-col shrink-0 py-2 overflow-y-auto overflow-x-hidden bg-vscode-sideBar-background transition-all duration-150',
          )}
        >
          {SETTINGS_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                title={isCollapsed ? tab.label : undefined}
                className={cn(
                  'whitespace-nowrap overflow-hidden min-w-0 h-12 py-3 box-border flex items-center border-l-2 text-xs w-full border-y-0 border-r-0 transition-colors duration-150',
                  isCollapsed ? 'justify-center px-0' : 'px-4 gap-2 text-left',
                  isActive
                    ? 'border-vscode-focusBorder bg-vscode-list-activeSelectionBackground text-vscode-foreground font-medium cursor-default'
                    : 'border-transparent text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground hover:text-vscode-foreground cursor-pointer bg-transparent',
                )}
              >
                <TabIcon className={cn('w-4 h-4 shrink-0', isActive ? 'text-vscode-foreground' : 'text-vscode-descriptionForeground')} />
                {!isCollapsed && <span className="tab-label">{tab.label}</span>}
              </button>
            );
          })}
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 overflow-y-auto pb-6 flex flex-col min-w-0 bg-vscode-sideBar-background">
          <div className="sticky top-0 z-10 bg-vscode-sideBar-background text-vscode-sideBar-foreground px-5 pt-6 pb-4">
            <h3 className="text-xl font-semibold text-vscode-foreground m-0">{activeTab.title}</h3>
            <p className="text-vscode-descriptionForeground text-xs mt-2 mb-0">{activeTab.description}</p>
          </div>

          <ActiveTabComponent draftSettings={draftSettings} handleFieldChange={handleFieldChange} />
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
