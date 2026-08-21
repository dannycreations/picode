import { exec, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { defineTool, formatSize, resolvePath, stripAnsi } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { getOutputLimits, truncateOutput } from '@pi-code/extension/utilities/truncate';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

function stripAnsiAndNormalize(raw: string): string {
  return stripAnsi(raw).replace(/\r\n/g, '\n');
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 1_800_000;
const KILL_GRACE_MS = 2_000;
const STREAM_FLUSH_MS = 80;

function resolveTimeout(requested: number | undefined): number {
  return Math.min(requested ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

export function cleanCommandOutput(raw: string): string {
  if (!raw) return '';

  // Strip ANSI escape sequences and normalize Windows CRLF (\r\n) to LF (\n)
  const stripped = stripAnsiAndNormalize(raw);

  // Resolve carriage-return overwrites (\r) and trim trailing whitespace per line.
  const lines = stripped.split('\n');
  const len = lines.length;

  for (let i = 0; i < len; i++) {
    let line = lines[i];
    if (line.includes('\r')) {
      line = collapseCarriageReturns(line);
    }
    lines[i] = line.replace(/[ \t]+$/, '');
  }

  // Rejoin lines and collapse 3+ consecutive newlines to maximum 2 (\n\n)
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collapseCarriageReturns(line: string): string {
  let idx = line.lastIndexOf('\r');
  while (idx === line.length - 1 && idx > 0) {
    line = line.slice(0, -1);
    idx = line.lastIndexOf('\r');
  }
  return idx === -1 ? line : line.slice(idx + 1);
}

export const executeCommandTool = defineTool({
  name: 'execute_command' as ToolName,
  label: 'Execute Command',
  description: 'Run a CLI command on the host. Prefer explicit "cwd" over using change directory "cd" command.',
  parameters: Type.Object({
    command: Type.String({ description: 'The command to execute.' }),
    cwd: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'Optional working directory; defaults to the workspace.' })),
    timeout: Type.Optional(Type.Integer({ minimum: 1, description: 'Optional timeout in milliseconds; defaults to 120000 ms (2 minutes).' })),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const limits = getOutputLimits();
    const retainedBytes = limits.maxBytes * 2;
    const effectiveTimeout = resolveTimeout(params.timeout);

    return new Promise<CustomToolResult<{ exitCode: number | null; signalCode: string | null; output: string; timedOut: boolean }>>((res) => {
      let resolvedCwd = ctx.cwd;
      if (typeof params.cwd === 'string' && params.cwd.trim() !== '') {
        resolvedCwd = resolvePath(params.cwd, ctx.cwd);
      }

      const output: string[] = [];
      let retainedLength = 0;
      let totalLength = 0;

      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');

      let streamBuffer = '';
      let streamSent = 0;
      let streamDirty = false;
      let streamTimer: ReturnType<typeof setTimeout> | null = null;

      const flushStream = () => {
        if (streamTimer !== null) {
          clearTimeout(streamTimer);
          streamTimer = null;
        }
        if (!streamDirty || !onUpdate) return;
        streamDirty = false;
        if (streamBuffer.length <= streamSent) return;
        const delta = streamBuffer.slice(streamSent);
        streamSent = streamBuffer.length;
        onUpdate({
          content: [{ type: 'text', text: delta }],
          details: { exitCode: null, signalCode: null, output: delta, timedOut: false },
        });
      };

      const scheduleStream = () => {
        if (streamTimer !== null) return;
        streamTimer = setTimeout(flushStream, STREAM_FLUSH_MS);
      };

      const streamUpdate = (text: string) => {
        if (!text) return;
        streamBuffer += stripAnsiAndNormalize(text);
        if (streamBuffer.length > retainedBytes) {
          const dropped = streamBuffer.length - retainedBytes;
          streamBuffer = streamBuffer.slice(dropped);
          streamSent = Math.max(0, streamSent - dropped);
        }
        streamDirty = true;
        scheduleStream();
      };

      const appendOutput = (text: string) => {
        if (!text) return;

        totalLength += text.length;
        output.push(text);
        retainedLength += text.length;

        // Rolling window: drop the oldest chunks, tail truncation keeps the end.
        while (retainedLength > retainedBytes && output.length > 1) {
          retainedLength -= output.shift()!.length;
        }
      };

      const cp = spawn(params.command, [], {
        shell: true,
        cwd: resolvedCwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      let finished = false;
      let timedOut = false;
      let onAbort: (() => void) | null = null;
      let escalationTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const detachSignal = () => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
      };

      const clearTimers = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (escalationTimer) {
          clearTimeout(escalationTimer);
          escalationTimer = null;
        }
        if (streamTimer) {
          clearTimeout(streamTimer);
          streamTimer = null;
        }
      };

      const finish = (exitCode: number | null, signalCode: string | null) => {
        if (finished) return;
        finished = true;
        detachSignal();
        clearTimers();

        // Flush remaining bytes from stream decoders
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        appendOutput(stdoutTail);
        appendOutput(stderrTail);
        streamUpdate(stdoutTail);
        streamUpdate(stderrTail);
        flushStream();

        const exitInfo = exitCode !== null ? `Exit code: ${exitCode}` : `Killed by signal: ${signalCode ?? 'UNKNOWN'}`;
        const rawOutput = output.join('');
        const cleanOutput = cleanCommandOutput(rawOutput);

        // The rolling window may already have dropped the head of a very noisy run.
        const dropped = totalLength > retainedLength;
        const droppedNote = dropped ? ` The command produced ${formatSize(totalLength)} in total.` : '';
        const retry = `Re-run with a search or pager (findstr, grep, head, tail) to inspect the rest.${droppedNote}`;

        const { text, truncation } = truncateOutput(cleanOutput, { limits, keep: 'tail', hint: retry });

        // Streaming already discarded the head even though what remains fits the budget.
        let modelText = text;
        if (dropped && !truncation.truncated) {
          modelText = `${text}\n\nTruncated to the last ${formatSize(limits.maxBytes)} of output. ${retry}`;
        }

        if (timedOut) {
          modelText = `${modelText}\n\nCommand timed out after ${effectiveTimeout} ms. If it is not waiting for input, rerun with a larger "timeout".`;
        }

        res({
          content: [{ type: 'text', text: modelText || `Command completed with no output. ${exitInfo}` }],
          details: { exitCode, signalCode, output: cleanOutput, timedOut },
          isError: exitCode !== 0,
        });
      };

      // Safe to call repeatedly until the tree is gone. Never gate
      // on cp.killed, which only records that a kill was requested.
      const killProcess = (sig: NodeJS.Signals = 'SIGTERM') => {
        const pid = cp.pid;
        if (!pid) return;
        try {
          if (process.platform === 'win32') {
            exec(`taskkill /pid ${pid} /T /F`, () => {});
          } else {
            process.kill(-pid, sig);
            cp.kill(sig);
          }
        } catch {}
      };

      const escalateKill = (graceMs: number = KILL_GRACE_MS) => {
        killProcess('SIGTERM');
        if (escalationTimer) clearTimeout(escalationTimer);
        escalationTimer = setTimeout(() => killProcess('SIGKILL'), graceMs);
      };

      cp.stdout?.on('data', (chunk: Buffer) => {
        const text = stdoutDecoder.write(chunk);
        appendOutput(text);
        streamUpdate(text);
      });

      cp.stderr?.on('data', (chunk: Buffer) => {
        const text = stderrDecoder.write(chunk);
        appendOutput(text);
        streamUpdate(text);
      });

      cp.on('error', (err) => {
        appendOutput(`\nError spawning process: ${err.message}\n`);
        finish(1, null);
      });

      cp.on('close', (code, sig) => {
        finish(code, sig);
      });

      timeoutTimer = setTimeout(() => {
        timedOut = true;
        escalateKill();
      }, effectiveTimeout);

      if (signal) {
        if (signal.aborted) {
          killProcess('SIGKILL');
          finish(null, 'SIGABRT');
        } else {
          onAbort = () => escalateKill();
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  },
});
