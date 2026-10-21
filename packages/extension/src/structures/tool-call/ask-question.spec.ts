import { beforeEach, describe, expect, it } from 'vitest';

import { answerQuestion, cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { askQuestionTool } from '@pi-code/extension/structures/tool-call/ask-question';

function execute() {
  const params = { question: 'Proceed with the plan?', follow_up: [{ text: 'Yes' }, { text: 'No' }] };
  return askQuestionTool.execute('test-id', params, undefined, undefined, {} as any) as Promise<any>;
}

describe('askQuestionTool', () => {
  beforeEach(() => {
    cancelAllQuestions();
  });

  it('returns the text answer as the tool result', async () => {
    const pending = execute();
    answerQuestion('test-id', 'Yes');

    const result = await pending;

    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual({ type: 'text', text: 'Yes' });
    // The answer travels in the content only; nothing reads a copy from details.
    expect(result.details).toEqual({});
  });

  it('appends answered images as image content blocks', async () => {
    const pending = execute();
    answerQuestion('test-id', '(image)', [{ kind: 'image', dataUrl: 'data:image/png;base64,aGk=' }]);

    const result = await pending;

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: '(image)' },
      { type: 'image', mimeType: 'image/png', data: 'aGk=' },
    ]);
  });

  it('errors when the user cancels the question', async () => {
    const pending = execute();
    cancelAllQuestions();

    const result = await pending;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no response');
  });
});
