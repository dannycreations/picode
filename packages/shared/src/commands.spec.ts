import { describe, expect, it } from 'vitest';

import { parseBuiltinCommand } from '@pi-code/shared/commands';

describe('parseBuiltinCommand', () => {
  it('parses a bare builtin invocation', () => {
    expect(parseBuiltinCommand('/reload')).toBe('reload');
    expect(parseBuiltinCommand('/compact')).toBe('compact');
  });

  it('ignores surrounding whitespace', () => {
    expect(parseBuiltinCommand('  /compact  ')).toBe('compact');
    expect(parseBuiltinCommand('/compact\n')).toBe('compact');
  });

  it('does not claim builtins that carry arguments', () => {
    expect(parseBuiltinCommand('/compact the history')).toBeNull();
  });

  it('does not claim prompts, skills, or unknown slash commands', () => {
    expect(parseBuiltinCommand('reload')).toBeNull();
    expect(parseBuiltinCommand('/skill:review')).toBeNull();
    expect(parseBuiltinCommand('/unknown')).toBeNull();
    expect(parseBuiltinCommand('please /reload')).toBeNull();
    expect(parseBuiltinCommand('')).toBeNull();
  });
});
