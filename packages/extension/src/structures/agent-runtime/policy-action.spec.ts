import { describe, expect, it } from 'vitest';

import {
  containsDangerousSubstitution,
  matchesGlob,
  parseCommand,
  resolveCommandAction,
  resolvePathAction,
  resolveReadPath,
} from '@pi-code/extension/structures/agent-runtime/policy-action';
import { DEFAULT_SETTINGS } from '@pi-code/shared/core/settings';

describe('resolveReadPath', () => {
  it('should auto-approve skill reads only when both autoApproveSkillReads and its parent autoApproveRead are enabled', () => {
    const skillPath = '/workspace/.pi/skills/foo/SKILL.md';

    // Parent off: skill reads are not auto-approved even if skill flag is on.
    expect(
      resolveReadPath('/workspace', skillPath, {
        ...DEFAULT_SETTINGS,
        autoApproveSkillReads: true,
        autoApproveRead: false,
      }),
    ).toBe('confirm');

    // Both on: skill reads are auto-approved.
    expect(
      resolveReadPath('/workspace', skillPath, {
        ...DEFAULT_SETTINGS,
        autoApproveSkillReads: true,
        autoApproveRead: true,
      }),
    ).toBe('approve');
  });

  it('should respect the deny list above the skill auto-approve', () => {
    expect(
      resolveReadPath('/workspace', '/workspace/.pi/skills/foo/SKILL.md', {
        ...DEFAULT_SETTINGS,
        autoApproveSkillReads: true,
        autoApproveRead: true,
        deniedReadPaths: ['**/skills/**'],
      }),
    ).toBe('deny');
  });
});

describe('resolvePathAction', () => {
  it('should confirm when auto-approve is enabled and allowed list is empty', () => {
    const action = resolvePathAction(undefined, 'src/core/agent.ts', true, [], []);
    expect(action).toBe('confirm');
  });

  it('should auto-approve when path is inside working directory and allowed list is empty', () => {
    const action = resolvePathAction('/workspace', 'src/core/agent.ts', true, [], []);
    expect(action).toBe('approve');
  });

  it('should confirm when path is outside working directory and allowed list is empty', () => {
    const action = resolvePathAction('/workspace', '../outside.ts', true, [], []);
    expect(action).toBe('confirm');
  });

  it('should block when path is inside working directory but explicitly denied', () => {
    const action = resolvePathAction('/workspace', 'src/core/agent.ts', true, [], ['src/core/*.ts']);
    expect(action).toBe('deny');
  });

  it('should auto-approve when auto-approve is enabled and allowed list contains wildcard', () => {
    const actionStar = resolvePathAction(undefined, 'src/core/agent.ts', true, ['*'], []);
    expect(actionStar).toBe('approve');
  });

  it('should request confirmation when auto-approve is disabled and allowed list is empty', () => {
    const action = resolvePathAction(undefined, 'src/core/agent.ts', false, [], []);
    expect(action).toBe('confirm');
  });

  it('should ignore denied and allowed list and return confirm when auto-approve is disabled', () => {
    const actionDenied = resolvePathAction(undefined, 'src/core/agent.ts', false, [], ['src/core/*.ts']);
    expect(actionDenied).toBe('confirm');

    const actionAllowed = resolvePathAction(undefined, 'src/core/agent.ts', false, ['src/core/*.ts'], []);
    expect(actionAllowed).toBe('confirm');
  });

  it('should auto-approve when path matches allowed patterns', () => {
    const action = resolvePathAction(undefined, 'src/core/agent.ts', true, ['src/**/*.ts'], []);
    expect(action).toBe('approve');
  });

  it('should confirm when path does not match allowed patterns', () => {
    const action = resolvePathAction(undefined, 'src/core/agent.ts', true, ['web/**/*.tsx'], []);
    expect(action).toBe('confirm');
  });

  it('should block when path matches denied patterns', () => {
    const action = resolvePathAction(undefined, 'src/core/agent.ts', true, [], ['src/core/*.ts']);
    expect(action).toBe('deny');
  });

  it('should resolve conflict by pattern length precedence (denied wins if longer or equal)', () => {
    // denied pattern is longer
    const action1 = resolvePathAction(
      undefined,
      'src/core/agent.ts',
      true,
      ['src/**/*.ts'], // length 11
      ['src/core/agent.ts'], // length 17
    );
    expect(action1).toBe('deny');

    // allowed pattern is longer
    const action2 = resolvePathAction(
      undefined,
      'src/core/agent.ts',
      true,
      ['src/core/agent.ts'], // length 17
      ['src/**/*.ts'], // length 11
    );
    expect(action2).toBe('approve');
  });

  it('should deny paths containing null bytes', () => {
    const action = resolvePathAction(undefined, 'src/core/\0agent.ts', true, ['src/**/*.ts'], []);
    expect(action).toBe('deny');
  });

  it('should normalize backslashes and match case-insensitively', () => {
    const actionWin = resolvePathAction(undefined, 'src\\core\\agent.ts', true, ['src/core/*.ts'], []);
    expect(actionWin).toBe('approve');

    const actionCase = resolvePathAction(undefined, 'SRC/CORE/AGENT.TS', true, ['src/core/*.ts'], []);
    expect(actionCase).toBe('approve');
  });
});

describe('resolveCommandAction', () => {
  it('should auto-approve when auto-approve is enabled and allowed list is empty', () => {
    const action = resolveCommandAction('npm test', true, [], []);
    expect(action).toBe('approve');
  });

  it('should request confirmation when auto-approve is disabled and allowed list is empty', () => {
    const action = resolveCommandAction('npm test', false, [], []);
    expect(action).toBe('confirm');
  });

  it('should block when command matches denied patterns', () => {
    const action = resolveCommandAction('npm install typescript', true, [], ['npm install']);
    expect(action).toBe('deny');
  });

  it('should auto-approve when command matches allowed patterns', () => {
    const action = resolveCommandAction('npm test', true, ['npm'], []);
    expect(action).toBe('approve');
  });

  it('should resolve conflict by pattern length precedence', () => {
    const action1 = resolveCommandAction(
      'npm run build',
      true,
      ['npm'], // length 3
      ['npm run build'], // length 13
    );
    expect(action1).toBe('deny');

    const action2 = resolveCommandAction(
      'npm run build',
      true,
      ['npm run build'], // length 13
      ['npm'], // length 3
    );
    expect(action2).toBe('approve');
  });

  it('should block or request confirmation when command is chained and any sub-command is not approved', () => {
    // rg is allowed, but rm is not
    const action = resolveCommandAction('rg && rm -rf *', true, ['rg'], []);
    expect(action).toBe('confirm');

    // rg is allowed, rm is explicitly denied -> should deny immediately
    const actionDenied = resolveCommandAction('rg && rm -rf *', true, ['rg'], ['rm *']);
    expect(actionDenied).toBe('deny');
  });

  it('should request confirmation when command contains dangerous substitutions', () => {
    const action = resolveCommandAction('echo ${var@P}', true, ['echo'], []);
    expect(action).toBe('confirm');
  });

  it('should auto-approve using prefix match with word boundary', () => {
    // allowed prefix is 'rg' (no wildcards), command is 'rg -i "approval"'
    const action = resolveCommandAction('rg -i "approval"', true, ['rg'], []);
    expect(action).toBe('approve');
  });

  it('should NOT approve command sharing prefix without word boundary (security check)', () => {
    // Pattern 'git' must NOT match 'github-downloader'
    const action = resolveCommandAction('github-downloader https://example.com', true, ['git'], []);
    expect(action).toBe('confirm');
  });

  it('should support glob pattern matching in commands', () => {
    const action = resolveCommandAction('npm run build', true, ['npm run *'], []);
    expect(action).toBe('approve');

    const actionMismatch = resolveCommandAction('npm test', true, ['npm run *'], []);
    expect(actionMismatch).toBe('confirm');
  });

  it('should strip stream redirections properly during evaluation', () => {
    const action = resolveCommandAction('echo hello 2>&1', true, ['echo *'], []);
    expect(action).toBe('approve');
  });
});

describe('containsDangerousSubstitution', () => {
  it('should detect dangerous parameter expansion flags', () => {
    expect(containsDangerousSubstitution('echo ${var@P}')).toBe(true);
    expect(containsDangerousSubstitution('echo ${var@Q}')).toBe(true);
  });

  it('should detect indirect expansion and arithmetic substitution', () => {
    expect(containsDangerousSubstitution('echo ${!ref}')).toBe(true);
    expect(containsDangerousSubstitution('echo $((1 + 1))')).toBe(true);
  });

  it('should detect null bytes', () => {
    expect(containsDangerousSubstitution('echo \0evil')).toBe(true);
  });

  it('should return false for safe command strings', () => {
    expect(containsDangerousSubstitution('npm test --coverage')).toBe(false);
    expect(containsDangerousSubstitution('git checkout -b feature/test')).toBe(false);
  });
});

describe('parseCommand', () => {
  it('should correctly parse command chains', () => {
    const subCmds = parseCommand('git status && git pull || echo failed');
    expect(subCmds).toEqual(['git status', 'git pull', 'echo failed']);
  });

  it('should preserve glob tokens correctly without substituting "glob"', () => {
    const subCmds = parseCommand('ls *.ts');
    expect(subCmds).toEqual(['ls *.ts']);
  });

  it('should ignore shell comments', () => {
    const subCmds = parseCommand('npm test # run test suite');
    expect(subCmds).toEqual(['npm test']);
  });

  it('should handle empty or whitespace-only inputs', () => {
    expect(parseCommand('')).toEqual([]);
    expect(parseCommand('   ')).toEqual([]);
  });
});

describe('matchesGlob', () => {
  it('should match standard glob patterns', () => {
    expect(matchesGlob('src/**/*.ts', 'src/core/agent.ts')).toBe(true);
    expect(matchesGlob('*.json', 'package.json')).toBe(true);
    expect(matchesGlob('*.json', 'src/package.json')).toBe(false);
  });

  it('should handle malformed regex patterns gracefully without throwing', () => {
    expect(matchesGlob('[invalid-glob', 'test')).toBe(false);
  });
});
