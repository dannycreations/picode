import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { createToolPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
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
  readonly key: string;
  readonly services: Promise<AgentSessionServices>;
}

const resourceCache = new Map<string, CachedResources>();

export function invalidateAgentResources(): void {
  resourceCache.clear();
}

let sharedModelRuntime: ModelRuntime | undefined;

async function createServices(cwd: string, config: LoaderConfig): Promise<AgentSessionServices> {
  const settingsManager = getSettingsManager(cwd);
  settingsManager.setProjectTrusted(config.projectTrusted);

  const services = await createAgentSessionServices({
    cwd,
    modelRuntime: sharedModelRuntime,
    settingsManager,
    resourceLoaderOptions: {
      noContextFiles: config.noContextFiles,
      extensionFactories: [createToolPolicyExtension()],
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
  return services;
}

export async function createAgentResources(cwd: string): Promise<AgentResources> {
  const settings = readAppSettings();
  const config: LoaderConfig = {
    noContextFiles: !settings.enableAgentRules,
    disableSkillInvocation: !settings.enableSkillDiscovery,
    projectTrusted: isProjectTrusted(cwd),
  };

  const key = [config.noContextFiles, config.disableSkillInvocation, config.projectTrusted].join('|');
  let cached = resourceCache.get(cwd);
  if (!cached || cached.key !== key) {
    cached = { key, services: createServices(cwd, config) };
    resourceCache.set(cwd, cached);
    // A rejected creation must not poison the cache for later attempts.
    cached.services.catch(() => {
      if (resourceCache.get(cwd) === cached) resourceCache.delete(cwd);
    });
  }

  return { settings, services: await cached.services };
}

export async function getModelRuntime(cwd: string): Promise<ModelRuntime> {
  return (await createAgentResources(cwd)).services.modelRuntime;
}
