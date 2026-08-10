import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { SettingsService } from '@pi-code/extension/core/settings';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ModelRuntime, ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
}

interface AgentResources {
  readonly settings: AppSettings;
  readonly services: AgentSessionServices;
}

interface LoaderConfig {
  readonly noContextFiles: boolean;
  readonly disableSkillInvocation: boolean;
  readonly projectTrusted: boolean;
}

interface CachedResources {
  readonly services: AgentSessionServices;
  readonly config: LoaderConfig;
}

const resourceCache = new Map<string, CachedResources>();

export function invalidateAgentResources(): void {
  resourceCache.clear();
}

let sharedModelRuntime: ModelRuntime | undefined;

export async function createAgentResources(cwd: string): Promise<AgentResources> {
  const settingsService = SettingsService.getInstance(cwd);
  const settings = await settingsService.load();
  const projectTrusted = isProjectTrusted(cwd);
  const config: LoaderConfig = {
    noContextFiles: !settings.enableAgentRules,
    disableSkillInvocation: !settings.enableSkillDiscovery,
    projectTrusted,
  };

  const cached = resourceCache.get(cwd);
  const isConfigMatch =
    cached &&
    cached.config.noContextFiles === config.noContextFiles &&
    cached.config.disableSkillInvocation === config.disableSkillInvocation &&
    cached.config.projectTrusted === config.projectTrusted;

  if (isConfigMatch) {
    return { settings, services: cached.services };
  }

  const settingsManager = settingsService.getSettingsManager();
  settingsManager.setProjectTrusted(projectTrusted);

  const services = await createAgentSessionServices({
    cwd,
    modelRuntime: sharedModelRuntime,
    settingsManager,
    resourceLoaderOptions: {
      noContextFiles: config.noContextFiles,
      skillsOverride: config.disableSkillInvocation
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
    },
  });

  for (const diagnostic of services.diagnostics) {
    if (diagnostic.type === 'error') {
      throw new Error(diagnostic.message);
    }
  }

  sharedModelRuntime ??= services.modelRuntime;
  resourceCache.set(cwd, { services, config });
  return { settings, services };
}

export async function getModelRuntime(cwd: string): Promise<ModelRuntime> {
  return (await createAgentResources(cwd)).services.modelRuntime;
}
