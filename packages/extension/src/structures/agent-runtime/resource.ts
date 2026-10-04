import { createAgentSessionServices } from '@earendil-works/pi-coding-agent';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { applyResourceContext, createContextExtension, discoverContext } from '@pi-code/extension/structures/agent-runtime/context';
import { createPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

import type { AgentSessionServices, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { LoaderConfig } from '@pi-code/extension/structures/agent-runtime/context';

interface CachedResources {
  readonly cwd: string;
  readonly key: string;
  readonly services: Promise<AgentSessionServices>;
}

let resourceCache: CachedResources | null = null;
let sharedModelRuntime: ModelRuntime | undefined;

export function invalidateAgentResources(): void {
  resourceCache = null;
  // The model runtime is captured once and reused across workspaces; drop it
  // so a trust change or settings rotation rebuilds a current one.
  sharedModelRuntime = undefined;
}

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
  if (resourceCache?.cwd !== cwd || resourceCache.key !== key) {
    const created: CachedResources = { cwd, key, services: createServices(cwd, config, createSessionServices) };
    resourceCache = created;
    // A rejected creation must not poison the cache for later attempts.
    created.services.catch(() => {
      if (resourceCache === created) resourceCache = null;
    });
  }

  return await resourceCache.services;
}
