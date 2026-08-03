import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { CustomToolResult } from '@extension/types/extension';
import type { ToolName } from '@extension/types/webview';

export const executeCommandTool = defineTool({
  name: 'execute_command' as ToolName,
  label: 'Execute Command',
  description: 'Execute a CLI command on the system. Tailor the command to the operating system and run it relative to the workspace.',
  parameters: Type.Object({
    command: Type.String({ description: 'The CLI command to execute.' }),
    cwd: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'Optional working directory for the command' })),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    return new Promise<CustomToolResult<{ exitCode: number | null; signalCode: string | null; output: string }>>((res) => {
      let resolvedCwd = ctx.cwd;
      if (params.cwd) {
        resolvedCwd = isAbsolute(params.cwd) ? params.cwd : resolve(ctx.cwd, params.cwd);
      }

      const output: string[] = [];
      const cp = spawn(params.command, [], {
        shell: true,
        cwd: resolvedCwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let finished = false;

      const finish = (exitCode: number | null, signalCode: string | null) => {
        if (finished) return;
        finished = true;

        const exitInfo = exitCode !== null ? `Exit code: ${exitCode}` : `Killed by signal: ${signalCode}`;
        const outputStr = output.join('');

        res({
          content: [{ type: 'text', text: outputStr || `[Command completed with no output. ${exitInfo}]` }],
          details: {
            exitCode,
            signalCode,
            output: outputStr,
          },
          isError: exitCode !== 0,
        });
      };

      cp.stdout?.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
      });

      cp.stderr?.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
      });

      cp.on('error', (err) => {
        output.push(`\nError spawning process: ${err.message}\n`);
        finish(1, null);
      });

      cp.on('close', (code, sig) => {
        finish(code, sig);
      });

      if (signal) {
        if (signal.aborted) {
          cp.kill();
          finish(null, 'SIGABRT');
        } else {
          signal.addEventListener('abort', () => {
            cp.kill();
            finish(null, 'SIGABRT');
          });
        }
      }
    });
  },
});
