import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyAgentContext, discoverAgentContext } from '@pi-code/extension/structures/agent-runtime/context';

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

    const context = await discoverAgentContext(nested, { enableAgentRules: true, projectTrusted: false }, agentDir);

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

    const context = await discoverAgentContext(project, { enableAgentRules: false, projectTrusted: false }, agentDir);

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

    const trusted = await discoverAgentContext(project, { enableAgentRules: false, projectTrusted: true }, agentDir);
    const untrusted = await discoverAgentContext(project, { enableAgentRules: false, projectTrusted: false }, agentDir);

    expect(trusted.systemPrompt).toBe('project-system');
    expect(trusted.appendSystemPrompt).toEqual(['project-append']);
    expect(untrusted.systemPrompt).toBe('global-system');
    expect(untrusted.appendSystemPrompt).toEqual(['global-append']);
  });

  it('reports absent prompts without error', async () => {
    const root = makeRoot();

    const context = await discoverAgentContext(join(root, 'proj'), { enableAgentRules: true, projectTrusted: true }, join(root, 'agent-dir'));

    expect(context.systemPrompt).toBeUndefined();
    expect(context.appendSystemPrompt).toEqual([]);
  });
});

describe('applyAgentContext', () => {
  it('disables loader-side discovery and serves the scanned values through the overrides', () => {
    const options = applyAgentContext(
      { extensionFactories: [] },
      {
        agentRules: [{ path: '/p/AGENTS.md', content: 'rules' }],
        systemPrompt: 'system',
        appendSystemPrompt: ['append'],
      },
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
    const options = applyAgentContext({}, { agentRules: [], systemPrompt: undefined, appendSystemPrompt: [] });

    expect(options.systemPromptOverride?.('loader-base')).toBeUndefined();
  });
});
