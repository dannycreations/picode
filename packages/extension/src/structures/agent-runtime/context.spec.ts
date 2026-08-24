import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SUBAGENT_MESSAGE_PROMPT } from '@pi-code/extension/core/prompt';
import { applyResourceContext, composeSystemContext, discoverContext } from '@pi-code/extension/structures/agent-runtime/context';

import type { BuildSystemPromptOptions, Skill } from '@earendil-works/pi-coding-agent';

let roots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-agent-context-'));
  roots.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

describe('discoverAgentContext', () => {
  it('collects the global file first, then ancestor agent rules ordered root-most to nearest', async () => {
    const root = makeRoot();
    const agentDir = join(root, 'agent-dir');
    const project = join(root, 'proj');
    const nested = join(project, 'nested');
    writeFile(join(agentDir, 'AGENTS.md'), 'global');
    writeFile(join(project, 'AGENTS.md'), 'outer');
    writeFile(join(nested, 'AGENTS.override.md'), 'inner-override');
    writeFile(join(nested, 'AGENTS.md'), 'inner-shadowed');

    const context = await discoverContext(nested, { agentRules: true, projectTrusted: false }, agentDir);

    expect(context.agentRules[0]).toEqual({ path: join(agentDir, 'AGENTS.md'), content: 'global' });
    const projectRules = context.agentRules.filter((file) => file.path.startsWith(project + sep));
    expect(projectRules).toEqual([
      { path: join(project, 'AGENTS.md'), content: 'outer' },
      { path: join(nested, 'AGENTS.override.md'), content: 'inner-override' },
    ]);
  });

  it('returns no agent rules while still discovering prompts when agent rules are disabled', async () => {
    const root = makeRoot();
    const agentDir = join(root, 'agent-dir');
    const project = join(root, 'proj');
    writeFile(join(project, 'AGENTS.md'), 'rules');
    writeFile(join(agentDir, 'SYSTEM.md'), 'system');

    const context = await discoverContext(project, { agentRules: false, projectTrusted: false }, agentDir);

    expect(context.agentRules).toEqual([]);
    expect(context.systemPrompt).toBe('system');
  });

  it('prefers the project prompt files when trusted and falls back to the global ones otherwise', async () => {
    const root = makeRoot();
    const agentDir = join(root, 'agent-dir');
    const project = join(root, 'proj');
    writeFile(join(project, '.pi', 'SYSTEM.md'), 'project-system');
    writeFile(join(project, '.pi', 'APPEND_SYSTEM.md'), 'project-append');
    writeFile(join(agentDir, 'SYSTEM.md'), 'global-system');
    writeFile(join(agentDir, 'APPEND_SYSTEM.md'), 'global-append');

    const trusted = await discoverContext(project, { agentRules: false, projectTrusted: true }, agentDir);
    const untrusted = await discoverContext(project, { agentRules: false, projectTrusted: false }, agentDir);

    expect(trusted.systemPrompt).toBe('project-system');
    expect(trusted.appendSystemPrompt).toEqual(['project-append']);
    expect(untrusted.systemPrompt).toBe('global-system');
    expect(untrusted.appendSystemPrompt).toEqual(['global-append']);
  });

  it('reports absent prompts without error', async () => {
    const root = makeRoot();

    const context = await discoverContext(join(root, 'proj'), { agentRules: true, projectTrusted: true }, join(root, 'agent-dir'));

    expect(context.systemPrompt).toBeUndefined();
    expect(context.appendSystemPrompt).toEqual([]);
  });
});

describe('applyAgentContext', () => {
  it('disables loader-side discovery and serves the scanned values through the overrides', () => {
    const options = applyResourceContext(
      { extensionFactories: [] },
      {
        agentRules: [{ path: '/p/AGENTS.md', content: 'rules' }],
        systemPrompt: 'system',
        appendSystemPrompt: ['append'],
      },
      { projectTrusted: false },
    );

    expect(options.noContextFiles).toBe(true);
    expect(options.systemPrompt).toBe('');
    expect(options.appendSystemPrompt).toEqual([]);
    expect(options.agentsFilesOverride?.({ agentsFiles: [] })).toEqual({
      agentsFiles: [{ path: '/p/AGENTS.md', content: 'rules' }],
    });
    expect(options.systemPromptOverride?.('loader-base')).toBe('system');
    expect(options.appendSystemPromptOverride?.(['loader-base'])).toEqual(['append']);
  });

  it('serves undefined when no system prompt was discovered', () => {
    const options = applyResourceContext(
      {},
      {
        agentRules: [],
        systemPrompt: undefined,
        appendSystemPrompt: [],
      },
      { projectTrusted: false },
    );

    expect(options.systemPromptOverride?.('loader-base')).toBeUndefined();
  });
});

function makeSkill(name: string): Skill {
  return {
    name,
    description: `desc-${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {} as Skill['sourceInfo'],
    disableModelInvocation: false,
  };
}

describe('composeSystemPrompt', () => {
  it('joins only the sections pi-code owns and never renders a working directory', () => {
    const options: BuildSystemPromptOptions = {
      customPrompt: 'CUSTOM',
      cwd: '/workspace',
      contextFiles: [{ path: '/p/AGENTS.md', content: 'rules' }],
    };
    const prompt = composeSystemContext(options);
    const expected = 'CUSTOM\n\n## Project Context\n\nProject-specific instructions and guidelines:\n\n### /p/AGENTS.md\n\n```markdown\nrules\n```';
    expect(prompt).toBe(expected);
    expect(prompt).not.toContain('Current working directory');
    expect(prompt).not.toContain('/workspace');
  });

  it('appends the extra section after the base and collapses empty ones', () => {
    expect(composeSystemContext({ customPrompt: 'C', appendSystemPrompt: 'EXTRA', cwd: '/w' })).toBe('C\n\nEXTRA');
    expect(composeSystemContext({ cwd: '/w' })).toBe('');
  });

  it('renders skills as markdown only when the read tool is selected', () => {
    const skills = [makeSkill('review')];
    expect(composeSystemContext({ cwd: '/w', selectedTools: ['read_file'], skills })).toBe(
      [
        'The following skills provide specialized instructions for specific tasks.',
        "Use the read tool to load a skill's file when the task matches its description.",
        'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
        '',
        '## Available Skills',
        '',
        '- **review**: desc-review',
        '  Location: `/skills/review/SKILL.md`',
      ].join('\n'),
    );
    expect(composeSystemContext({ cwd: '/w', selectedTools: ['execute_command'], skills })).toBe('');
  });

  it('appends delegation guidance only when spawn_subagent is selectable', () => {
    const delegating = composeSystemContext({ customPrompt: 'C', cwd: '/w', selectedTools: ['read_file', 'spawn_subagent'] });
    expect(delegating).toBe(`C\n\n${SUBAGENT_MESSAGE_PROMPT}`);
    expect(composeSystemContext({ customPrompt: 'C', cwd: '/w', selectedTools: ['read_file'] })).not.toContain('Sub-Agent Delegation');
  });

  it('renders skill fields verbatim and hides skills flagged as invocation-disabled', () => {
    const broken = { ...makeSkill('broken'), description: 'a & b <c>' };
    const manual = { ...makeSkill('manual'), disableModelInvocation: true };
    const prompt = composeSystemContext({ cwd: '/w', selectedTools: ['read_file'], skills: [broken, manual] });

    expect(prompt).toContain('- **broken**: a & b <c>');
    expect(prompt).toContain('Location: `/skills/broken/SKILL.md`');
    expect(prompt).not.toContain('- **manual**:');
  });
});
