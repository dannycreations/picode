import { DefaultResourceLoader, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';

import { SettingsService } from '@pi-code/extension/core/settings';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
}

interface AgentResources {
  readonly settings: AppSettings;
  readonly agentDir: string;
  readonly settingsManager: SettingsManager;
  readonly resourceLoader: DefaultResourceLoader;
}

interface LoaderConfig {
  readonly noContextFiles: boolean;
  readonly hideSkills: boolean;
  readonly projectTrusted: boolean;
}

interface CachedResources extends AgentResources {
  readonly config: LoaderConfig;
}

const resourceCache = new Map<string, CachedResources>();

export async function createAgentResources(cwd: string): Promise<AgentResources> {
  const settings = await SettingsService.getInstance(cwd).load();
  const projectTrusted = isProjectTrusted(cwd);
  const config = {
    noContextFiles: !settings.enableAgentRules,
    hideSkills: !settings.enableSkillDiscovery,
    projectTrusted,
  };

  const cached = resourceCache.get(cwd);
  const isConfigMatches =
    cached &&
    cached.config.noContextFiles === config.noContextFiles &&
    cached.config.hideSkills === config.hideSkills &&
    cached.config.projectTrusted === config.projectTrusted;

  if (isConfigMatches) {
    return { ...cached, settings };
  }

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: config.noContextFiles,
    skillsOverride: config.hideSkills
      ? (base: SkillsResult) => ({
          ...base,
          skills: base.skills.map((skill) =>
            skill.disableModelInvocation
              ? skill
              : {
                  ...skill,
                  disableModelInvocation: true,
                },
          ),
        })
      : undefined,
  });
  await resourceLoader.reload();

  const entry: CachedResources = { settings, agentDir, settingsManager, resourceLoader, config };
  resourceCache.set(cwd, entry);
  return entry;
}
