import { ArrowLeft, Database, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@webview/components/shared/ConfirmDialog';
import { vscode } from '@webview/utilities/vscode';
import { ApprovalTab } from './ApprovalTab';
import { ContextTab } from './ContextTab';

import type { LucideIcon } from 'lucide-react';
import type { ComponentType, FC } from 'react';
import type { AppSettings } from '@extension/core/settings';

export interface TabProps {
  readonly draftSettings: AppSettings;
  readonly handleFieldChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  readonly getSliderStyle: (value: number, min: number, max: number) => { background: string };
  readonly sliderClassName: string;
}

export interface SettingsTab {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly component: ComponentType<TabProps>;
}

const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'approval',
    label: 'Approval',
    icon: ShieldCheck,
    title: 'Approval',
    description: 'Configure auto-approval settings for agent actions to balance speed and safety',
    component: ApprovalTab,
  },
  {
    id: 'context',
    label: 'Context',
    icon: Database,
    title: 'Context',
    description: "Control what information is included in the AI's context window, affecting token usage and response quality",
    component: ContextTab,
  },
];

interface SettingsViewProps {
  readonly onDone: () => void;
}

export const areSettingsValuesEqual = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }
  return a === b;
};

export const SettingsView: FC<SettingsViewProps> = ({ onDone }) => {
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(null);
  const [activeTabId, setActiveTabId] = useState(SETTINGS_TABS[0].id);

  const [isSaving, setIsSaving] = useState(false);
  const pendingUpdatesRef = useRef<Array<{ key: keyof AppSettings; value: unknown }>>([]);
  const [isDiscardDialogShow, setDiscardDialogShow] = useState(false);

  // Request settings on mount
  useEffect(() => {
    vscode?.postMessage({ type: 'get_settings' });
  }, []);

  // Listen for settings from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'settings_data' && msg.payload?.settings) {
        const s = msg.payload.settings as AppSettings;
        setOriginalSettings(s);

        if (pendingUpdatesRef.current.length > 0) {
          // Process sequential updates
          pendingUpdatesRef.current = pendingUpdatesRef.current.slice(1);
          if (pendingUpdatesRef.current.length > 0) {
            const next = pendingUpdatesRef.current[0];
            vscode?.postMessage({ type: 'update_setting', key: next.key, value: next.value });
          } else {
            setIsSaving(false);
            setDraftSettings(s);
          }
        } else {
          // Initial load or update from outside
          setDraftSettings(s);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Helper to detect if settings have changed
  const isChangeDetected = (() => {
    if (!draftSettings || !originalSettings) return false;
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    return keys.some((key) => !areSettingsValuesEqual(draftSettings[key], originalSettings[key]));
  })();

  // Update draft settings locally
  const handleFieldChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!draftSettings) return;
    setDraftSettings({
      ...draftSettings,
      [key]: value,
    });
  };

  // Sequential saving to avoid filesystem write race conditions
  const handleSave = () => {
    if (!draftSettings || !originalSettings || isSaving) return;

    const updates: Array<{ key: keyof AppSettings; value: unknown }> = [];
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (!areSettingsValuesEqual(draftSettings[key], originalSettings[key])) {
        updates.push({ key, value: draftSettings[key] });
      }
    }

    if (updates.length === 0) return;

    setIsSaving(true);
    pendingUpdatesRef.current = updates;

    const first = updates[0];
    vscode?.postMessage({ type: 'update_setting', key: first.key, value: first.value });
  };

  // Back button guard
  const checkUnsaveChanges = (then: () => void) => {
    if (isChangeDetected) {
      setDiscardDialogShow(true);
    } else {
      then();
    }
  };

  // Helper to render customized slider track backgrounds
  const getSliderStyle = (value: number, min: number, max: number) => {
    const pct = ((value - min) / (max - min)) * 100;
    return {
      background: `linear-gradient(to right, var(--vscode-button-background) ${pct}%, var(--vscode-input-background) ${pct}%)`,
    };
  };

  if (!draftSettings || !originalSettings) {
    return (
      <div className="flex items-center justify-center h-full bg-vscode-sideBar-background text-vscode-descriptionForeground text-xs select-none">
        Loading settings...
      </div>
    );
  }

  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId) || SETTINGS_TABS[0];
  const ActiveTabComponent = activeTab.component;

  const sliderClassName =
    'w-full appearance-none h-2 rounded-sm border border-vscode-settings-checkboxBorder outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-vscode-button-background [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-vscode-button-background [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer';

  return (
    <div className="flex flex-col h-full bg-vscode-sideBar-background text-vscode-foreground select-none overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center gap-2 px-5 py-2.5 border-b border-vscode-panel-border bg-vscode-sideBar-background shrink-0">
        <div className="flex items-center gap-2 grow">
          <button
            onClick={() => checkUnsaveChanges(onDone)}
            className="p-1.5 -ml-2 hover:bg-vscode-list-hoverBackground rounded text-vscode-foreground bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors duration-150"
            title="Discard unsaved changes and go back to tasks view"
          >
            <ArrowLeft size={16} />
          </button>
          <h3 className="text-vscode-foreground m-0 flex-shrink-0 text-sm font-semibold">Settings</h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            disabled={!isChangeDetected || isSaving}
            onClick={handleSave}
            className={`h-7 px-3 text-xs font-semibold rounded cursor-pointer transition-colors duration-150 ${
              isChangeDetected && !isSaving
                ? 'bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none'
                : 'bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border opacity-50 cursor-not-allowed'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main Layout Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Tabs Navigation */}
        <div className="w-48 border-r border-vscode-editorGroup-border/20 flex flex-col shrink-0 py-2 overflow-y-auto overflow-x-hidden bg-vscode-sideBar-background">
          {SETTINGS_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center gap-2 border-l-2 text-xs text-left w-full border-y-0 border-r-0 transition-colors duration-150 ${
                  isActive
                    ? 'border-vscode-focusBorder bg-vscode-list-activeSelectionBackground text-vscode-foreground font-medium cursor-default'
                    : 'border-transparent text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground hover:text-vscode-foreground cursor-pointer bg-transparent'
                }`}
              >
                <TabIcon className={`w-4 h-4 shrink-0 ${isActive ? 'text-vscode-foreground' : 'text-vscode-descriptionForeground'}`} />
                <span className="tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Settings Content */}
        <div className="flex-1 overflow-y-auto pb-6 flex flex-col min-w-0 bg-vscode-sideBar-background">
          {/* Section Header */}
          <div className="sticky top-0 z-10 bg-vscode-sideBar-background text-vscode-sideBar-foreground px-5 pt-6 pb-4">
            <h3 className="text-[1.25em] font-semibold text-vscode-foreground m-0">{activeTab.title}</h3>
            <p className="text-vscode-descriptionForeground text-xs mt-2 mb-0">{activeTab.description}</p>
          </div>

          {/* Section content */}
          <ActiveTabComponent
            draftSettings={draftSettings}
            handleFieldChange={handleFieldChange}
            getSliderStyle={getSliderStyle}
            sliderClassName={sliderClassName}
          />
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
          setDraftSettings(originalSettings);
          onDone();
        }}
        onCancel={() => setDiscardDialogShow(false)}
      />
    </div>
  );
};
