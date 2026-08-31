import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { logger } from '@pi-code/shared/core/logger';

// Captured API requests carry bearer tokens and session keys in their headers.
// Writing those to a file inside the workspace would leak secrets into the
// user's repo, so redact any header whose value is credential-shaped.
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization']);

let logPath: string | null = null;
let nativeFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = globalThis.fetch.bind(globalThis);
let writeChain: Promise<void> = Promise.resolve();

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function redactHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  });
  return result;
}

async function captureBody(message: Request | Response): Promise<string | null> {
  // Cloning can throw on streaming bodies; swallow it so the real request is
  // never blocked by debug logging.
  try {
    return await message.clone().text();
  } catch {
    return null;
  }
}

function formatEntry(direction: 'request' | 'response', payload: unknown): string {
  return `\n=== ${direction.toUpperCase()} ${new Date().toISOString()} ===\n${JSON.stringify(payload, null, 2)}\n`;
}

function enqueue(text: string): void {
  if (!logPath) return;
  const target = logPath;
  writeChain = writeChain
    .then(() => mkdir(dirname(target), { recursive: true }))
    .then(() => appendFile(target, text))
    .catch((err) => logger.debug('Failed to write debug request log:', err));
}

async function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let request: Request;
  try {
    request = new Request(input, init);
  } catch (err) {
    logger.debug('Skipping request capture; input is not re-wrappable:', err);
    return nativeFetch(input, init);
  }

  enqueue(
    formatEntry('request', {
      method: request.method,
      url: request.url,
      headers: redactHeaders(request.headers),
      body: '',
    }),
  );

  void captureBody(request).then((body) => {
    if (body !== null) enqueue(formatEntry('request', { url: request.url, body }));
  });

  const response = await nativeFetch(request);

  enqueue(
    formatEntry('response', {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: redactHeaders(response.headers),
      body: '',
    }),
  );

  void captureBody(response).then((body) => {
    if (body !== null) enqueue(formatEntry('response', { url: response.url, body }));
  });

  return response;
}

export function installFetchInterceptor(workspaceDir: string): void {
  if (logPath) return;
  logPath = join(workspaceDir, 'debug', `requests_${todayStamp()}.txt`);
  globalThis.fetch = interceptedFetch as typeof globalThis.fetch;
}

export function flushDebugLog(): Promise<void> {
  return writeChain;
}
