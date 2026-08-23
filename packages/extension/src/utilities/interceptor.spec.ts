import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('installFetchInterceptor', () => {
  let dir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(join(tmpdir(), 'pi-debug-'));
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  });

  it('writes redacted request and response bodies to a dated file', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-api-key': 'response-secret' },
      })) as typeof globalThis.fetch;

    const { installFetchInterceptor, flushDebugLog } = await import('./interceptor');
    installFetchInterceptor(dir);

    const res = await fetch('https://api.example.com/v1/chat', {
      method: 'POST',
      headers: { authorization: 'Bearer request-secret', 'content-type': 'application/json' },
      body: '{"prompt":"hello"}',
    });
    await res.text();
    await flushDebugLog();

    const files = await readdir(join(dir, 'debug'));
    const log = files.find((name) => name.startsWith('requests_'));
    expect(log).toBeDefined();

    const contents = await readFile(join(dir, 'debug', log!), 'utf8');
    expect(contents).toContain('=== REQUEST');
    expect(contents).toContain('=== RESPONSE');
    expect(contents).toContain('hello');
    expect(contents).toContain('[redacted]');
    expect(contents).not.toContain('request-secret');
    expect(contents).not.toContain('response-secret');
  });

  it('returns the response untouched and still writes a log entry', async () => {
    globalThis.fetch = (async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof globalThis.fetch;

    const { installFetchInterceptor, flushDebugLog } = await import('./interceptor');
    installFetchInterceptor(dir);

    const res = await fetch('https://api.example.com/ping');
    const text = await res.text();
    await flushDebugLog();

    expect(res.status).toBe(200);
    expect(text).toBe('ok');
    const files = await readdir(join(dir, 'debug'));
    expect(files.some((name) => name.startsWith('requests_'))).toBe(true);
  });
});
