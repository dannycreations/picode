import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildSkillBlock, injectSkillMessages, parseSkillInvocation } from '@pi-code/extension/structures/agent-runtime/skill';

import type { AgentSession, Skill } from '@earendil-works/pi-coding-agent';

function fakeSession(): { session: AgentSession; sendCustomMessage: ReturnType<typeof vi.fn> } {
  const sendCustomMessage = vi.fn(async () => {});
  return { session: { sendCustomMessage } as unknown as AgentSession, sendCustomMessage };
}

describe('parseSkillInvocation', () => {
  it('returns null for non-skill text', () => {
    expect(parseSkillInvocation('do the thing')).toBeNull();
    expect(parseSkillInvocation('/prompt:review')).toBeNull();
    expect(parseSkillInvocation('')).toBeNull();
  });

  it('parses a name with no args', () => {
    expect(parseSkillInvocation('/skill:review')).toEqual({ name: 'review', args: '' });
  });

  it('parses a name with trimmed args', () => {
    expect(parseSkillInvocation('/skill:review my notes')).toEqual({ name: 'review', args: 'my notes' });
  });
});

describe('buildSkillBlock', () => {
  it('wraps name, path, and body in the skill block', () => {
    const block = buildSkillBlock('review', '/proj/skills/review/SKILL.md', 'Read the diff.');
    expect(block).toBe(
      '<skill name="review" location="/proj/skills/review/SKILL.md">\nReferences are relative to /proj/skills/review.\n\nRead the diff.\n</skill>',
    );
  });
});

describe('injectSkillMessages', () => {
  it('strips the command and sends a hidden skill custom message', async () => {
    const file = join(tmpdir(), `picode-skill-test-${Date.now()}.md`);
    writeFileSync(file, '---\nname: review\n---\nRead the diff.');
    try {
      const { session, sendCustomMessage } = fakeSession();
      const skills = [{ name: 'review', filePath: file }] as unknown as Skill[];

      const result = await injectSkillMessages(session, skills, '/skill:review check the logs');

      expect(result).toBe('check the logs');
      expect(sendCustomMessage).toHaveBeenCalledTimes(1);
      expect(sendCustomMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: 'skill',
          display: false,
          content: expect.stringContaining('<skill name="review"'),
        }),
      );
    } finally {
      try {
        unlinkSync(file);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('returns the original text when the skill is unknown', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const skills = [{ name: 'review', filePath: '/x' }] as unknown as Skill[];

    const text = '/skill:missing do it';
    expect(await injectSkillMessages(session, skills, text)).toBe(text);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('returns the original text when the skill file cannot be read', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const skills = [{ name: 'review', filePath: '/does/not/exist.md' }] as unknown as Skill[];

    const text = '/skill:review do it';
    expect(await injectSkillMessages(session, skills, text)).toBe(text);
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});
