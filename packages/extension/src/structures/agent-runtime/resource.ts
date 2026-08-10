import { join } from 'node:path';
import { createAgentSessionServices, getAgentDir, ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent';

import { SettingsService } from '@pi-code/extension/core/settings';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ResourceDiagnostic, ResourceLoader, Skill } from '@earendil-works/pi-coding-agent';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
}

interface AgentResources {
  readonly settings: AppSettings;
  readonly settingsManager: SettingsManager;
  readonly resourceLoader: ResourceLoader;
}

interface LoaderConfig {
  readonly noContextFiles: boolean;
  readonly disableSkillInvocation: boolean;
  readonly projectTrusted: boolean;
}

interface CachedResources extends AgentResources {
  readonly config: LoaderConfig;
}

const resourceCache = new Map<string, CachedResources>();

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

export function lazyModelRuntime(): Promise<ModelRuntime> {
  modelRuntimePromise ??= ModelRuntime.create({
    authPath: join(getAgentDir(), 'auth.json'),
    modelsPath: join(getAgentDir(), 'models.json'),
  });
  return modelRuntimePromise;
}

export async function createAgentResources(cwd: string): Promise<AgentResources> {
  const settingsService = SettingsService.getInstance(cwd);
  const settings = await settingsService.load();
  const projectTrusted = isProjectTrusted(cwd);
  const config = {
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
    return { settings, settingsManager: cached.settingsManager, resourceLoader: cached.resourceLoader };
  }

  const settingsManager = settingsService.getSettingsManager();
  settingsManager.setProjectTrusted(projectTrusted);

  const services: AgentSessionServices = await createAgentSessionServices({
    cwd,
    modelRuntime: await lazyModelRuntime(),
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

  const entry: CachedResources = {
    settings,
    settingsManager: services.settingsManager,
    resourceLoader: services.resourceLoader,
    config,
  };
  resourceCache.set(cwd, entry);
  return entry;
}
