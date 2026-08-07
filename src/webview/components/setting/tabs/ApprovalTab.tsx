import { Edit, Eye, Terminal, Trash2 } from 'lucide-react';

import { SettingCheckbox } from '@extension/webview/components/setting/shared/SettingCheckbox';
import { SettingList } from '@extension/webview/components/setting/shared/SettingList';

import type { FC } from 'react';
import type { TabProps } from '@extension/webview/components/setting/shared/types';

export const ApprovalTab: FC<TabProps> = ({ draftSettings, handleFieldChange }) => {
  return (
    <div className="flex flex-col gap-6 px-5 py-2">
      {/* Read tool */}
      <SettingCheckbox
        label="Read Files"
        icon={<Eye size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Automatically allow the agent to read files and line ranges (`read_file`)."
        checked={draftSettings.autoApproveRead}
        onChange={(val) => handleFieldChange('autoApproveRead', val)}
      >
        <div className="flex flex-col gap-4">
          <SettingCheckbox
            label="Skill Reading"
            description="Automatically allow the agent to read skill files (`SKILL.md`) when it uses a skill."
            checked={draftSettings.autoApproveSkillReads}
            onChange={(val) => handleFieldChange('autoApproveSkillReads', val)}
          />
          <SettingList
            label="Allowed Read Paths"
            description="Files matching these globs will be auto-approved for reading. Add * to allow all paths."
            placeholder="e.g. src/**/*.ts"
            inputs={draftSettings.allowedReadPaths}
            onChange={(globs) => handleFieldChange('allowedReadPaths', globs)}
          />
          <SettingList
            label="Denied Read Paths"
            description="Files matching these globs will be blocked from reading, overriding allowed paths."
            placeholder="e.g. env/*.env"
            inputs={draftSettings.deniedReadPaths}
            onChange={(globs) => handleFieldChange('deniedReadPaths', globs)}
          />
        </div>
      </SettingCheckbox>

      {/* Write tool */}
      <SettingCheckbox
        label="Write & Edit Files"
        icon={<Edit size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Automatically allow the agent to create and edit files (`write_file`, `edit_file`)."
        checked={draftSettings.autoApproveWrite}
        onChange={(val) => handleFieldChange('autoApproveWrite', val)}
      >
        <div className="flex flex-col gap-4">
          <SettingList
            label="Allowed Write Paths"
            description="Files matching these globs will be auto-approved for writing/editing. Add * to allow all paths."
            placeholder="e.g. src/**/*.ts"
            inputs={draftSettings.allowedWritePaths}
            onChange={(globs) => handleFieldChange('allowedWritePaths', globs)}
          />
          <SettingList
            label="Denied Write Paths"
            description="Files matching these globs will be blocked from writing/editing, overriding allowed paths."
            placeholder="e.g. package.json"
            inputs={draftSettings.deniedWritePaths}
            onChange={(globs) => handleFieldChange('deniedWritePaths', globs)}
          />
        </div>
      </SettingCheckbox>

      {/* Delete tool */}
      <SettingCheckbox
        label="Delete Files"
        icon={<Trash2 size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Automatically allow the agent to delete files (`delete_file`). Use with caution."
        checked={draftSettings.autoApproveDelete}
        onChange={(val) => handleFieldChange('autoApproveDelete', val)}
      >
        <div className="flex flex-col gap-4">
          <SettingList
            label="Allowed Delete Paths"
            description="Files matching these globs will be auto-approved for deleting. Add * to allow all paths."
            placeholder="e.g. temp/**/*.log"
            inputs={draftSettings.allowedDeletePaths}
            onChange={(globs) => handleFieldChange('allowedDeletePaths', globs)}
          />
          <SettingList
            label="Denied Delete Paths"
            description="Files matching these globs will be blocked from deleting, overriding allowed paths."
            placeholder="e.g. src/**/*.ts"
            inputs={draftSettings.deniedDeletePaths}
            onChange={(globs) => handleFieldChange('deniedDeletePaths', globs)}
          />
        </div>
      </SettingCheckbox>

      {/* Execute tool */}
      <SettingCheckbox
        label="Execute Commands"
        icon={<Terminal size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Automatically allow the agent to run terminal commands (`execute_command`) inside your terminal shell environment."
        checked={draftSettings.autoApproveExecute}
        onChange={(val) => handleFieldChange('autoApproveExecute', val)}
      >
        <div className="flex flex-col gap-4">
          <SettingList
            label="Allowed Commands"
            description="Commands starting with these prefixes will be auto-approved. Add * to allow all commands."
            placeholder="e.g. npm"
            inputs={draftSettings.allowedExecuteCommands}
            onChange={(globs) => handleFieldChange('allowedExecuteCommands', globs)}
          />
          <SettingList
            label="Denied Commands"
            description="Commands starting with these prefixes will be blocked, overriding allowed commands."
            placeholder="e.g. rm -rf"
            inputs={draftSettings.deniedExecuteCommands}
            onChange={(globs) => handleFieldChange('deniedExecuteCommands', globs)}
          />
        </div>
      </SettingCheckbox>
    </div>
  );
};
