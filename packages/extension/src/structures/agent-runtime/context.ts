import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir, loadProjectContextFiles } from '@earendil-works/pi-coding-agent';

import { SUBAGENT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';

import type {
  BeforeAgentStartEventResult,
  BuildSystemPromptOptions,
  CreateAgentSessionServicesOptions,
  InlineExtension,
  ResourceDiagnostic,
  Skill,
} from '@earendil-works/pi-coding-agent';

type ResourceLoaderOptions = NonNullable<CreateAgentSessionServicesOptions['resourceLoaderOptions']>;

interface ContextFile {
  readonly path: string;
  readonly content: string;
}

interface SystemContext {
  // AGENTS.md / CLAUDE.md content, ordered global file first, then root-most ancestor to nearest.
  readonly agentRules: readonly ContextFile[];
  readonly systemPrompt?: string;
  readonly appendSystemPrompt: readonly string[];
}

interface SkillsResult {
  readonly skills: Skill[];
  readonly diagnostics: ResourceDiagnostic[];
}

export interface LoaderConfig {
  readonly agentRules?: boolean;
  readonly skillInvocation?: boolean;
  readonly projectTrusted?: boolean;
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

export async function discoverContext(cwd: string, options: LoaderConfig, agentDir: string = getAgentDir()): Promise<SystemContext> {
  const projectConfigDir = join(cwd, CONFIG_DIR_NAME);
  const projectSystemPrompt = options.projectTrusted ? join(projectConfigDir, SYSTEM_PROMPT_FILE) : undefined;
  const projectAppendPrompt = options.projectTrusted ? join(projectConfigDir, APPEND_SYSTEM_PROMPT_FILE) : undefined;

  const [agentRules, systemPrompt, appendSystemPrompt] = await Promise.all([
    options.agentRules ? loadProjectContextFiles({ cwd, agentDir }) : Promise.resolve([]),
    selectPromptFile(projectSystemPrompt, join(agentDir, SYSTEM_PROMPT_FILE)),
    selectPromptFile(projectAppendPrompt, join(agentDir, APPEND_SYSTEM_PROMPT_FILE)),
  ]);

  return {
    agentRules,
    systemPrompt,
    appendSystemPrompt: appendSystemPrompt ? [appendSystemPrompt] : [],
  };
}

export function applyResourceContext(loaderOptions: ResourceLoaderOptions, context: SystemContext, options: LoaderConfig): ResourceLoaderOptions {
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
    skillsOverride: options.skillInvocation
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
  };
}

function renderProjectContext(contextFiles: ReadonlyArray<{ path: string; content: string }> | undefined): string {
  const files = contextFiles ?? [];
  if (files.length === 0) return '';
  let block = '<project_context>\n\nProject-specific instructions and guidelines:\n\n';
  for (const { path, content } of files) {
    block += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
  }
  return `${block}</project_context>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function renderSkills(selectedTools: readonly string[] | undefined, skills: readonly Skill[] | undefined): string {
  const visible = (skills ?? []).filter((skill) => !skill.disableModelInvocation);
  // Skills only help when the agent can actually read them.
  if (!selectedTools?.includes('read_file') || visible.length === 0) return '';

  const lines = [
    'The following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    '<available_skills>',
  ];
  for (const skill of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

function renderSubagentGuidance(selectedTools: readonly string[] | undefined): string {
  return selectedTools?.includes('spawn_subagent') ? SUBAGENT_MESSAGE_PROMPT : '';
}

export function composeSystemContext(options: BuildSystemPromptOptions): string {
  const sections = [
    options.customPrompt?.trim(),
    options.appendSystemPrompt?.trim(),
    renderProjectContext(options.contextFiles).trim(),
    renderSkills(options.selectedTools, options.skills).trim(),
    renderSubagentGuidance(options.selectedTools).trim(),
  ];
  return sections.filter((section) => section !== undefined && section.length > 0).join('\n\n');
}

export function createContextExtension(): InlineExtension {
  return {
    name: 'pi-code-system-prompt',
    hidden: true,
    factory: (pi) => {
      pi.on('before_agent_start', (event): BeforeAgentStartEventResult => ({
        systemPrompt: composeSystemContext(event.systemPromptOptions),
      }));
    },
  };
}
