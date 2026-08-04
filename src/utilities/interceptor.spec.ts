import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeFetchInterceptor } from '@extension/utilities/interceptor';

vi.mock('vscode', () => {
  return {
    workspace: {
      workspaceFolders: [
        {
          uri: {
            fsPath: '/mock/workspace',
          },
        },
      ],
    },
  };
});

vi.mock('node:fs', () => {
  return {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe('initializeFetchInterceptor', () => {
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      clone: function () {
        return {
          headers: this.headers,
          status: this.status,
          statusText: this.statusText,
          text: async () => '{"reply": "hello"}',
        };
      },
    });
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should intercept global fetch calls and record requests & responses', async () => {
    initializeFetchInterceptor();

    const response = await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: '{"message": "hi"}',
      headers: {
        Authorization: 'Bearer test',
      },
    });

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);

    // Wait briefly for background logging task
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(writeFileSync).toHaveBeenCalled();
    const [filePath, content] = (writeFileSync as any).mock.calls[0];
    expect(filePath).toContain('fetch-');
    const parsed = JSON.parse(content);
    expect(parsed.request.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(parsed.request.method).toBe('POST');
    expect(parsed.request.body).toEqual({ message: 'hi' });
    expect(parsed.response.status).toBe(200);
    expect(parsed.response.body).toEqual({ reply: 'hello' });
  });
});
