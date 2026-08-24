import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { applyResourceContext, createContextExtension, discoverContext } from '@pi-code/extension/structures/agent-runtime/context';
import { createPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { LoaderConfig } from '@pi-code/extension/structures/agent-runtime/context';

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

  const context = await discoverContext(cwd, config);
  const resource = applyResourceContext({ extensionFactories: [createContextExtension(), createPolicyExtension()] }, context, config);
  const services = await createSessionServices({ cwd, modelRuntime: sharedModelRuntime, settingsManager, resourceLoaderOptions: resource });

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
    agentRules: settings.enableAgentRules,
    skillInvocation: settings.enableSkillDiscovery,
    projectTrusted: isProjectTrusted(cwd),
  };

  const key = [config.agentRules, config.skillInvocation, config.projectTrusted].join('|');
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
