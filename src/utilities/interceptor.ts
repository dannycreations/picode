import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspace } from 'vscode';

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function logInteraction(url: string, method: string, headers: Record<string, string>, requestBodyText: string, responseClone: Response) {
  try {
    const responseHeaders: Record<string, string> = {};
    responseClone.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBodyText = '';
    try {
      responseBodyText = await responseClone.text();
    } catch (err) {
      responseBodyText = `[Failed to read response body: ${err instanceof Error ? err.message : String(err)}]`;
    }

    const timestamp = Date.now();
    const id = Math.random().toString(36).substring(2, 8);
    const logData = {
      timestamp: new Date(timestamp).toISOString(),
      request: {
        url,
        method,
        headers,
        body: requestBodyText ? safeJsonParse(requestBodyText) : '',
      },
      response: {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers: responseHeaders,
        body: responseBodyText ? safeJsonParse(responseBodyText) : '',
      },
    };

    const workspaceFolders = workspace.workspaceFolders;
    const cwd = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
    const debugDir = join(cwd, 'debug');
    if (!existsSync(debugDir)) {
      mkdirSync(debugDir, { recursive: true });
    }

    const fileName = `fetch-${timestamp}-${id}.json`;
    writeFileSync(join(debugDir, fileName), JSON.stringify(logData, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to log intercepted fetch interaction:', err);
  }
}

export function initializeFetchInterceptor(): void {
  const originalFetch = globalThis.fetch;
  if (!originalFetch) {
    console.warn('globalThis.fetch is not defined; cannot intercept requests.');
    return;
  }

  globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url = '';
    let method = 'GET';
    const headers: Record<string, string> = {};
    let requestBodyText = '';

    try {
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else if (input && typeof input === 'object' && 'url' in input) {
        url = input.url;
        method = input.method || 'GET';
      }

      if (init?.method) {
        method = init.method;
      }

      // Extract headers from init
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            headers[key] = value;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, value] of init.headers) {
            headers[key] = value;
          }
        } else {
          Object.assign(headers, init.headers);
        }
      } else if (input && typeof input === 'object' && 'headers' in input && input.headers instanceof Headers) {
        input.headers.forEach((value, key) => {
          headers[key] = value;
        });
      }

      // Extract request body
      if (init?.body) {
        if (typeof init.body === 'string') {
          requestBodyText = init.body;
        } else if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
          requestBodyText = new TextDecoder().decode(init.body);
        } else if (typeof init.body === 'object') {
          try {
            requestBodyText = String(init.body);
          } catch {
            requestBodyText = '[unserializable object]';
          }
        }
      } else if (input && typeof input === 'object' && 'clone' in input && typeof input.clone === 'function') {
        try {
          const reqClone = input.clone() as Request;
          requestBodyText = await reqClone.text();
        } catch {}
      }
    } catch (err) {
      console.error('Error parsing request in fetch interceptor:', err);
    }

    const response = await originalFetch(input, init);

    try {
      const responseClone = response.clone();
      void logInteraction(url, method, headers, requestBodyText, responseClone);
    } catch (err) {
      console.error('Error cloning response in fetch interceptor:', err);
    }

    return response;
  };
}
