import { BookOpen, FileText, ListChecks, MessageCircleQuestion } from 'lucide-react';

import { SettingCheckbox } from '@webview/components/setting/shared/SettingCheckbox';

import type { FC } from 'react';
import type { TabProps } from '@webview/components/setting/shared/types';

export const AbilityTab: FC<TabProps> = ({ draftSettings, handleFieldChange }) => {
  return (
    <div className="flex flex-col gap-6 px-5 py-2">
      {/* Todo tool */}
      <SettingCheckbox
        label="Task Planning"
        icon={<ListChecks size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Let the agent break work into a checklist and keep it updated while it works (`update_todo`)."
        checked={draftSettings.enableTodoTool}
        onChange={(val) => handleFieldChange('enableTodoTool', val)}
      />

      {/* Ask question tool */}
      <SettingCheckbox
        label="Clarifying Questions"
        icon={<MessageCircleQuestion size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Let the agent pause and ask you for details when a request is unclear (`ask_question`)."
        checked={draftSettings.enableAskQuestionTool}
        onChange={(val) => handleFieldChange('enableAskQuestionTool', val)}
      />

      {/* Agent rules */}
      <SettingCheckbox
        label="Project Rules"
        icon={<FileText size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Let the agent auto load AGENTS.md and CLAUDE.md files for project-specific instructions."
        checked={draftSettings.enableAgentRules}
        onChange={(val) => handleFieldChange('enableAgentRules', val)}
      />

      {/* Skill discovery */}
      <SettingCheckbox
        label="Skill Discovery"
        icon={<BookOpen size={14} className="text-vscode-descriptionForeground shrink-0" />}
        description="Let the agent pick skills (`SKILL.md` files) on its own. When off, skills stay available and you load one explicitly with `/skill:<name>`."
        checked={draftSettings.enableSkillDiscovery}
        onChange={(val) => handleFieldChange('enableSkillDiscovery', val)}
      />
    </div>
  );
};
