import { describe, expect, it } from 'vitest';

import { resolveCommandAction, resolvePathAction } from '@extension/utilities/action';

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
  });

  it('should request confirmation when command contains dangerous substitutions', () => {
    const action = resolveCommandAction('echo ${var@P}', true, ['echo'], []);
    expect(action).toBe('confirm');
  });

  it('should auto-approve using prefix match', () => {
    // allowed prefix is 'rg' (no wildcards), command is 'rg -i "approval"'
    const action = resolveCommandAction('rg -i "approval"', true, ['rg'], []);
    expect(action).toBe('approve');
  });
});
