import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { applyAgentContext, discoverAgentContext } from '@pi-code/extension/structures/agent-runtime/context';
import { createToolPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ModelRuntime, ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent';

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
}

interface LoaderConfig {
  readonly enableAgentRules: boolean;
  readonly enableSkillInvocation: boolean;
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

  const context = await discoverAgentContext(cwd, config);
  const services = await createSessionServices({
    cwd,
    modelRuntime: sharedModelRuntime,
    settingsManager,
    resourceLoaderOptions: applyAgentContext(
      {
        extensionFactories: [createToolPolicyExtension()],
        skillsOverride: config.enableSkillInvocation
          ? undefined
          : (base: SkillsResult) => ({
              ...base,
              skills: base.skills.map((skill) =>
                skill.disableModelInvocation
                  ? skill
                  : {
                      ...skill,
                      disableModelInvocation: true,
                    },
              ),
            }),
      },
      context,
    ),
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
    enableAgentRules: settings.enableAgentRules,
    enableSkillInvocation: settings.enableSkillDiscovery,
    projectTrusted: isProjectTrusted(cwd),
  };

  const key = [config.enableAgentRules, config.enableSkillInvocation, config.projectTrusted].join('|');
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
