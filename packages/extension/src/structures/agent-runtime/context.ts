import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir, loadProjectContextFiles } from '@earendil-works/pi-coding-agent';

import type { CreateAgentSessionServicesOptions } from '@earendil-works/pi-coding-agent';

type ResourceLoaderOptions = NonNullable<CreateAgentSessionServicesOptions['resourceLoaderOptions']>;

interface ContextFile {
  readonly path: string;
  readonly content: string;
}

interface AgentContext {
  // AGENTS.md / CLAUDE.md content, ordered global file first, then root-most ancestor to nearest.
  readonly agentRules: readonly ContextFile[];
  readonly systemPrompt?: string;
  readonly appendSystemPrompt: readonly string[];
}

interface ContextDiscoveryOptions {
  readonly enableAgentRules: boolean;
  readonly projectTrusted: boolean;
}

const SYSTEM_PROMPT_FILE = 'SYSTEM.md';
const APPEND_SYSTEM_PROMPT_FILE = 'APPEND_SYSTEM.md';

async function readOptionalFile(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function selectPromptFile(projectPath: string | undefined, globalPath: string): Promise<string | undefined> {
  const projectContent = projectPath ? await readOptionalFile(projectPath) : undefined;
  return projectContent ?? (await readOptionalFile(globalPath));
}

export async function discoverAgentContext(cwd: string, options: ContextDiscoveryOptions, agentDir: string = getAgentDir()): Promise<AgentContext> {
  const projectConfigDir = join(cwd, CONFIG_DIR_NAME);
  const projectSystemPrompt = options.projectTrusted ? join(projectConfigDir, SYSTEM_PROMPT_FILE) : undefined;
  const projectAppendPrompt = options.projectTrusted ? join(projectConfigDir, APPEND_SYSTEM_PROMPT_FILE) : undefined;

  const [agentRules, systemPrompt, appendSystemPrompt] = await Promise.all([
    options.enableAgentRules ? loadProjectContextFiles({ cwd, agentDir }) : Promise.resolve([]),
    selectPromptFile(projectSystemPrompt, join(agentDir, SYSTEM_PROMPT_FILE)),
    selectPromptFile(projectAppendPrompt, join(agentDir, APPEND_SYSTEM_PROMPT_FILE)),
  ]);

  return {
    agentRules,
    systemPrompt,
    appendSystemPrompt: appendSystemPrompt ? [appendSystemPrompt] : [],
  };
}

export function applyAgentContext(loaderOptions: ResourceLoaderOptions, context: AgentContext): ResourceLoaderOptions {
  return {
    ...loaderOptions,
    // Empty sources switch off the loader's own discovery so the values it
    // serves come exclusively from pi-code's scan in discoverAgentContext.
    noContextFiles: true,
    systemPrompt: '',
    appendSystemPrompt: [],
    agentsFilesOverride: () => ({ agentsFiles: [...context.agentRules] }),
    systemPromptOverride: () => context.systemPrompt,
    appendSystemPromptOverride: () => [...context.appendSystemPrompt],
  };
}
