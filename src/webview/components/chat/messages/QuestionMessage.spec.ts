import { describe, expect, it } from 'vitest';

import { findPendingQuestion, parseQuestionAnswer, parseQuestionData } from '@webview/components/chat/helpers/question';

import type { ChatMessage } from '@extension/types/webview';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'tc-1',
    sender: 'tool',
    text: 'ask_question',
    ts: 1,
    toolName: 'ask_question',
    ...overrides,
  };
}

describe('parseQuestionData', () => {
  it('should extract the question and suggestion texts', () => {
    const args = JSON.stringify({
      question: 'Which package manager should I use?',
      follow_up: [{ text: 'Use pnpm' }, { text: 'Use npm' }],
    });

    expect(parseQuestionData(args)).toEqual({
      question: 'Which package manager should I use?',
      suggestions: ['Use pnpm', 'Use npm'],
    });
  });

  it('should tolerate missing, blank, and plain string suggestions', () => {
    const args = JSON.stringify({ question: 'Continue?', follow_up: ['Yes', { text: '  ' }, {}] });

    expect(parseQuestionData(args)).toEqual({ question: 'Continue?', suggestions: ['Yes'] });
  });

  it('should return undefined for malformed or unrelated arguments', () => {
    expect(parseQuestionData(undefined)).toBeUndefined();
    expect(parseQuestionData('not json')).toBeUndefined();
    expect(parseQuestionData(JSON.stringify({ follow_up: [] }))).toBeUndefined();
  });
});

describe('parseQuestionAnswer', () => {
  it('should read the answer from the tool result details', () => {
    const result = JSON.stringify({ content: [{ type: 'text', text: 'Use pnpm' }], details: { response: 'Use pnpm' } });

    expect(parseQuestionAnswer(result)).toBe('Use pnpm');
  });

  it('should fall back to the first content block', () => {
    const result = JSON.stringify({ content: [{ type: 'text', text: 'Use npm' }] });

    expect(parseQuestionAnswer(result)).toBe('Use npm');
  });

  it('should treat non-json results as the raw answer', () => {
    expect(parseQuestionAnswer('Use bun')).toBe('Use bun');
    expect(parseQuestionAnswer(undefined)).toBe('');
  });
});

describe('findPendingQuestion', () => {
  it('should return the latest unanswered question', () => {
    const messages = [createMessage({ id: 'tc-1', toolStatus: 'completed' }), createMessage({ id: 'tc-2', toolStatus: 'running' })];

    expect(findPendingQuestion(messages)?.id).toBe('tc-2');
  });

  it('should ignore other running tools and answered questions', () => {
    const messages = [
      createMessage({ id: 'tc-1', toolStatus: 'completed' }),
      createMessage({ id: 'tc-2', toolName: 'execute_command', toolStatus: 'running' }),
    ];

    expect(findPendingQuestion(messages)).toBeUndefined();
    expect(findPendingQuestion([])).toBeUndefined();
  });
});
