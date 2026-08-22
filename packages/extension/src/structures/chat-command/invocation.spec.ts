import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildPromptBlock,
  buildSkillBlock,
  injectResourceMessages,
  matchPromptInvocation,
  matchSkillInvocation,
} from '@pi-code/extension/structures/chat-command/invocation';

import type { AgentSession, PromptTemplate, Skill } from '@earendil-works/pi-coding-agent';

function fakeSession(): { session: AgentSession; sendCustomMessage: ReturnType<typeof vi.fn> } {
  const sendCustomMessage = vi.fn(async () => {});
  return { session: { sendCustomMessage } as unknown as AgentSession, sendCustomMessage };
}

describe('matchSkillInvocation', () => {
  it('returns null for non-skill text', () => {
    expect(matchSkillInvocation('do the thing')).toBeNull();
    expect(matchSkillInvocation('/prompt:review')).toBeNull();
    expect(matchSkillInvocation('')).toBeNull();
  });

  it('returns the skill name', () => {
    expect(matchSkillInvocation('/skill:review')).toBe('review');
  });

  it('returns only the name when args follow', () => {
    expect(matchSkillInvocation('/skill:review my notes')).toBe('review');
  });
});

describe('matchPromptInvocation', () => {
  const review = { name: 'review' } as PromptTemplate;
  const commitHelper = { name: 'commit-helper' } as PromptTemplate;

  it('returns null for non-command text, empty names, and unknown templates', () => {
    const prompts = [review, commitHelper];
    expect(matchPromptInvocation('do the thing', prompts)).toBeNull();
    expect(matchPromptInvocation('/', prompts)).toBeNull();
    expect(matchPromptInvocation('/missing', prompts)).toBeNull();
  });

  it('leaves built-in chat commands alone', () => {
    expect(matchPromptInvocation('/reload', [review])).toBeNull();
  });

  it('never claims skill commands', () => {
    expect(matchPromptInvocation('/skill:review', [review])).toBeNull();
  });

  it('matches the prefixed spelling with raw args', () => {
    const prompts = [review, commitHelper];
    expect(matchPromptInvocation('/prompt:review', prompts)).toEqual({ name: 'review', args: '' });
    expect(matchPromptInvocation('/prompt:commit-helper now', prompts)).toEqual({ name: 'commit-helper', args: 'now' });
    expect(matchPromptInvocation('/review', prompts)).toBeNull();
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

describe('buildPromptBlock', () => {
  it('wraps name, location, and content in the prompt block', () => {
    const block = buildPromptBlock({ name: 'review', filePath: '/proj/prompts/review.md' } as PromptTemplate, 'Check the diff.\n');
    expect(block).toBe('<prompt name="review" location="/proj/prompts/review.md">\nCheck the diff.\n</prompt>');
  });
});

describe('injectResourceMessages', () => {
  function resourcesWith(skills: Skill[], prompts: PromptTemplate[]) {
    return { skills, prompts };
  }

  it('sends a hidden skill message for a /skill: command', async () => {
    const file = join(tmpdir(), `picode-skill-test-${Date.now()}.md`);
    writeFileSync(file, '---\nname: review\n---\nRead the diff.');
    try {
      const { session, sendCustomMessage } = fakeSession();

      await injectResourceMessages(
        session,
        resourcesWith([{ name: 'review', filePath: file }] as unknown as Skill[], []),
        '/skill:review check the logs',
      );

      expect(sendCustomMessage).toHaveBeenCalledTimes(1);
      expect(sendCustomMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: 'skill_content',
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

  it('stays silent when the skill file cannot be read', async () => {
    const { session, sendCustomMessage } = fakeSession();

    await injectResourceMessages(
      session,
      resourcesWith([{ name: 'review', filePath: '/does/not/exist.md' }] as unknown as Skill[], []),
      '/skill:review do it',
    );

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('sends a hidden prompt message for the explicit /prompt: form', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const prompts = [{ name: 'notes', filePath: '/p/notes.md', content: 'Write notes.' }] as unknown as PromptTemplate[];

    await injectResourceMessages(session, resourcesWith([], prompts), '/prompt:notes about today');

    expect(sendCustomMessage).toHaveBeenCalledTimes(1);
    expect(sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'prompt_content',
        display: false,
        content: expect.stringContaining('<prompt name="notes"'),
      }),
    );
  });

  it('substitutes arguments into placeholders like pi-agent does', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const prompts = [{ name: 'notes', filePath: '/p/notes.md', content: 'Topic: $1\nAll: $ARGUMENTS' }] as unknown as PromptTemplate[];

    await injectResourceMessages(session, resourcesWith([], prompts), '/prompt:notes "web cache" one two');

    expect(sendCustomMessage).toHaveBeenCalledTimes(1);
    expect(sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'prompt_content',
        content: '<prompt name="notes" location="/p/notes.md">\nTopic: web cache\nAll: web cache one two\n</prompt>',
      }),
    );
  });

  it('stays silent for the plain /name spelling', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const prompts = [{ name: 'notes', filePath: '/p/notes.md', content: 'Write notes.' }] as unknown as PromptTemplate[];

    await injectResourceMessages(session, resourcesWith([], prompts), '/notes hello world');

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('does nothing for plain text or unknown names', async () => {
    const { session, sendCustomMessage } = fakeSession();
    const prompts = [{ name: 'notes' }] as unknown as PromptTemplate[];
    const resources = resourcesWith([{ name: 'review' }] as unknown as Skill[], prompts);

    await injectResourceMessages(session, resources, 'just chatting');
    await injectResourceMessages(session, resources, '/missing');

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });
});
