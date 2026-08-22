import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { createToolPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ModelRuntime, ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent';

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
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

type ServicesFactory = typeof createAgentSessionServices;

async function createServices(cwd: string, config: LoaderConfig, createSessionServices: ServicesFactory): Promise<AgentSessionServices> {
  const settingsManager = getSettingsManager(cwd);
  settingsManager.setProjectTrusted(config.projectTrusted);

  const services = await createSessionServices({
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

export async function createAgentResources(
  cwd: string,
  createSessionServices: ServicesFactory = createAgentSessionServices,
): Promise<AgentSessionServices> {
  const settings = readAppSettings();
  const config: LoaderConfig = {
    noContextFiles: !settings.enableAgentRules,
    disableSkillInvocation: !settings.enableSkillDiscovery,
    projectTrusted: isProjectTrusted(cwd),
  };

  const key = [config.noContextFiles, config.disableSkillInvocation, config.projectTrusted].join('|');
  let cached = resourceCache.get(cwd);
  if (!cached || cached.key !== key) {
    cached = { key, services: createServices(cwd, config, createSessionServices) };
    resourceCache.set(cwd, cached);
    // A rejected creation must not poison the cache for later attempts.
    cached.services.catch(() => {
      if (resourceCache.get(cwd) === cached) resourceCache.delete(cwd);
    });
  }

  return await cached.services;
}
