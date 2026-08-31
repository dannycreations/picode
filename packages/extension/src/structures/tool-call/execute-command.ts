import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { formatThrownValue } from '@earendil-works/pi-ai';
import {
  defineTool,
  formatSize,
  getShellConfig,
  killProcessTree,
  resolvePath,
  stripAnsi,
  trackDetachedChildPid,
  untrackDetachedChildPid,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readAppSettings, readOutputLimits } from '@pi-code/extension/core/settings';
import { truncateOutput } from '@pi-code/extension/utilities/truncate';
import { logger } from '@pi-code/shared/core/logger';

import type { SpawnOptions } from 'node:child_process';
import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

function stripAnsiAndNormalize(raw: string): string {
  return stripAnsi(raw).replace(/\r\n/g, '\n');
}

const DEFAULT_TIMEOUT_MS = 120_000;
const STREAM_FLUSH_MS = 80;
// How long a child's stdio pipes may stay open after its exit before the
// result settles anyway. A killed shell can leave a descendant holding the
// pipes forever, which would otherwise hang the caller.
const EXIT_STDIO_GRACE_MS = 100;

function resolveTimeout(requested: number | undefined, maxMs: number): number {
  return Math.min(requested ?? DEFAULT_TIMEOUT_MS, maxMs);
}

function resolveBashShell(): { shell: string; args: string[] } | null {
  try {
    return getShellConfig();
  } catch {
    return null;
  }
}

async function isDirExist(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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

type ExecuteCommandReturn = CustomToolResult<{ exitCode: number | null; signalCode: string | null; output: string; timedOut: boolean }>;

export const executeCommandTool = defineTool({
  name: 'execute_command' as ToolName,
  label: 'Execute Command',
  description: 'Run a CLI command on the host. Prefer explicit `cwd` over using change directory `cd` command.',
  parameters: Type.Object({
    command: Type.String({ description: 'The command to execute.' }),
    cwd: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'Optional working directory; defaults to the workspace.' })),
    timeout: Type.Optional(Type.Integer({ minimum: 1, description: 'Optional timeout in milliseconds; defaults to 120000 ms (2 minutes).' })),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const limits = readOutputLimits();
    const retainedBytes = limits.maxBytes * 2;
    const effectiveTimeout = resolveTimeout(params.timeout, readAppSettings().maxCommandTimeoutMs);

    const executeCommand = async (res: (result: ExecuteCommandReturn) => void): Promise<void> => {
      let resolvedCwd = ctx.cwd;
      if (typeof params.cwd === 'string' && params.cwd.trim() !== '') {
        resolvedCwd = resolvePath(params.cwd, ctx.cwd);
        if (!(await isDirExist(resolvedCwd))) {
          resolvedCwd = ctx.cwd;
        }
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

      const spawnOptions: SpawnOptions = {
        cwd: resolvedCwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      };

      const bash = resolveBashShell();
      const cp = bash ? spawn(bash.shell, [...bash.args, params.command], spawnOptions) : spawn(params.command, [], { ...spawnOptions, shell: true });

      if (cp.pid) trackDetachedChildPid(cp.pid);

      let finished = false;
      let timedOut = false;
      let exited = false;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;
      let onAbort: (() => void) | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let exitGraceTimer: ReturnType<typeof setTimeout> | null = null;

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
        if (streamTimer) {
          clearTimeout(streamTimer);
          streamTimer = null;
        }
        if (exitGraceTimer) {
          clearTimeout(exitGraceTimer);
          exitGraceTimer = null;
        }
      };

      const finish = (exitCode: number | null, signalCode: string | null) => {
        if (finished) return;
        finished = true;
        detachSignal();
        clearTimers();
        if (cp.pid) untrackDetachedChildPid(cp.pid);

        // Flush remaining bytes from stream decoders
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        appendOutput(stdoutTail);
        appendOutput(stderrTail);
        streamUpdate(stdoutTail);
        streamUpdate(stderrTail);
        flushStream();
        // Release pipes a descendant may still hold after the grace settle.
        cp.stdout?.destroy();
        cp.stderr?.destroy();

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
          modelText = `${modelText}\n\nCommand timed out after ${effectiveTimeout} ms. If it is not waiting for input, rerun with a larger \`timeout\`.`;
        }

        res({
          content: [{ type: 'text', text: modelText || `Command completed with no output. ${exitInfo}` }],
          details: { exitCode, signalCode, output: cleanOutput, timedOut },
          isError: exitCode !== 0,
        });
      };

      const killCommand = () => {
        if (cp.pid) {
          killProcessTree(cp.pid);
          return;
        }
        // Abort or timeout can land while spawn is still in flight. Kill as
        // soon as the pid exists instead of letting the command run on.
        cp.once('spawn', () => {
          if (cp.pid) killProcessTree(cp.pid);
        });
      };

      // 'close' waits for stdio pipes to close, and a killed shell can leave a
      // detached descendant holding them open forever. After exit, settle once
      // the pipes go idle instead of hanging; active output re-arms the grace
      // so a still-writing descendant keeps its tail.
      const armExitGrace = () => {
        if (exitGraceTimer) clearTimeout(exitGraceTimer);
        exitGraceTimer = setTimeout(() => finish(exitCode, exitSignal), EXIT_STDIO_GRACE_MS);
      };

      cp.stdout?.on('data', (chunk: Buffer) => {
        try {
          const text = stdoutDecoder.write(chunk);
          appendOutput(text);
          streamUpdate(text);
          if (exited && !finished) armExitGrace();
        } catch (err) {
          logger.warn('Failed to process command stdout chunk:', err);
        }
      });

      cp.stderr?.on('data', (chunk: Buffer) => {
        try {
          const text = stderrDecoder.write(chunk);
          appendOutput(text);
          streamUpdate(text);
          if (exited && !finished) armExitGrace();
        } catch (err) {
          logger.warn('Failed to process command stderr chunk:', err);
        }
      });

      cp.on('error', (err) => {
        appendOutput(`\nError spawning process: ${err.message}\n`);
        finish(1, null);
      });

      cp.once('exit', (code, sig) => {
        exited = true;
        exitCode = code;
        exitSignal = sig;
        armExitGrace();
      });

      cp.on('close', (code, sig) => {
        finish(code, sig);
      });

      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killCommand();
      }, effectiveTimeout);

      if (signal) {
        if (signal.aborted) {
          killCommand();
          finish(null, 'SIGABRT');
        } else {
          onAbort = () => killCommand();
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    };

    return new Promise<ExecuteCommandReturn>((res) => {
      void executeCommand(res).catch((err) => {
        res({
          content: [{ type: 'text', text: `Command failed before execution: ${formatThrownValue(err)}` }],
          details: { exitCode: null, signalCode: null, output: '', timedOut: false },
          isError: true,
        });
      });
    });
  },
});
