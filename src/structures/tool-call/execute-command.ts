import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { defineTool, formatSize } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveOutputLimits, truncateOutput } from '@extension/utilities/truncate';

import type { CustomToolResult } from '@extension/types/extension';
import type { ToolName } from '@extension/types/webview';

const ANSI_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[=>c()#%*+]/g;

export function cleanCommandOutput(raw: string): string {
  if (!raw) return '';

  // Strip ANSI escape sequences and normalize Windows CRLF (\r\n) to LF (\n)
  const stripped = raw.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n');

  // Resolve carriage return overwrites (\r) and trim trailing spaces without split array allocations
  const lines = stripped.split('\n');
  const len = lines.length;

  for (let i = 0; i < len; i++) {
    let line = lines[i];

    if (line.includes('\r')) {
      let idx = line.lastIndexOf('\r');
      // Strip trailing carriage returns if any exist at the end of the line
      while (idx === line.length - 1 && idx > 0) {
        line = line.slice(0, -1);
        idx = line.lastIndexOf('\r');
      }
      line = idx === -1 ? line : line.slice(idx + 1);
    }

    lines[i] = line.replace(/[ \t]+$/g, '');
  }

  // Rejoin lines and collapse 3+ consecutive newlines to maximum 2 (\n\n)
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const executeCommandTool = defineTool({
  name: 'execute_command' as ToolName,
  label: 'Execute Command',
  description: 'Execute a CLI command on the system. Tailor the command to the operating system and run it relative to the workspace.',
  parameters: Type.Object({
    command: Type.String({ description: 'The CLI command to execute.' }),
    cwd: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'Optional working directory for the command' })),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const limits = await resolveOutputLimits(ctx.cwd);
    const retainedBytes = limits.maxBytes * 2;

    return new Promise<CustomToolResult<{ exitCode: number | null; signalCode: string | null; output: string }>>((res) => {
      let resolvedCwd = ctx.cwd;
      if (typeof params.cwd === 'string' && params.cwd.trim() !== '') {
        resolvedCwd = isAbsolute(params.cwd) ? params.cwd : resolve(ctx.cwd, params.cwd);
      }

      const output: string[] = [];
      let retainedLength = 0;
      let totalLength = 0;

      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');

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
      });

      let finished = false;
      let onAbort: (() => void) | null = null;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
          onAbort = null;
        }
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      const finish = (exitCode: number | null, signalCode: string | null) => {
        if (finished) return;
        finished = true;
        cleanup();

        // Flush remaining bytes from stream decoders
        appendOutput(stdoutDecoder.end());
        appendOutput(stderrDecoder.end());

        const exitInfo = exitCode !== null ? `Exit code: ${exitCode}` : `Killed by signal: ${signalCode ?? 'UNKNOWN'}`;
        const rawOutput = output.join('');
        const cleanOutput = cleanCommandOutput(rawOutput);

        // The rolling window may already have dropped the head of a very noisy run.
        const dropped = totalLength > retainedLength;
        const droppedNote = dropped ? ` The command produced ${formatSize(totalLength)} in total.` : '';
        const retry = `Re-run filtered through a search or pager (for example findstr, grep, head, or tail) to inspect the rest.${droppedNote}`;

        const { text, truncation } = truncateOutput(cleanOutput, { limits, keep: 'tail', hint: retry });

        // Streaming already discarded the head even though what remains fits the budget.
        let modelText = text;
        if (dropped && !truncation.truncated) {
          modelText = `${text}\n\n[Truncated: showing only the end of the output (${formatSize(limits.maxBytes)} output limit). ${retry}]`;
        }

        res({
          content: [{ type: 'text', text: modelText || `[Command completed with no output. ${exitInfo}]` }],
          details: { exitCode, signalCode, output: cleanOutput },
          isError: exitCode !== 0,
        });
      };

      const killProcess = (sig: NodeJS.Signals = 'SIGTERM') => {
        try {
          if (!cp.killed) {
            cp.kill(sig);
          }
        } catch {}
      };

      cp.stdout?.on('data', (chunk: Buffer) => {
        appendOutput(stdoutDecoder.write(chunk));
      });

      cp.stderr?.on('data', (chunk: Buffer) => {
        appendOutput(stderrDecoder.write(chunk));
      });

      cp.on('error', (err) => {
        appendOutput(`\nError spawning process: ${err.message}\n`);
        finish(1, null);
      });

      cp.on('close', (code, sig) => {
        finish(code, sig);
      });

      if (signal) {
        if (signal.aborted) {
          killProcess('SIGKILL');
          finish(null, 'SIGABRT');
        } else {
          onAbort = () => {
            killProcess('SIGTERM');
            // Escalate to SIGKILL if process hangs on SIGTERM
            killTimer = setTimeout(() => {
              killProcess('SIGKILL');
            }, 2000);
            finish(null, 'SIGABRT');
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  },
});
