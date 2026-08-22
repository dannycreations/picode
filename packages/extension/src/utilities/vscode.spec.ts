import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';

let mockIsTrusted = false;

vi.mock('vscode', () => {
  return {
    Uri: { file: (path: string) => ({ fsPath: path }) },
    workspace: {
      get isTrusted() {
        return mockIsTrusted;
      },
      asRelativePath: (target: { fsPath: string }) => target.fsPath,
      getWorkspaceFolder: () => undefined,
    },
  };
});

// The trust helpers come straight from @earendil-works/pi-coding-agent:
// Vitest 4 cannot intercept natively loaded node_modules, so these tests
// exercise the real predicates against throwaway directories instead of
// mocking them.

const tempProjects: string[] = [];

async function makeTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-code-trust-'));
  tempProjects.push(dir);
  return dir;
}

afterEach(async () => {
  mockIsTrusted = false;
  await Promise.all(tempProjects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('isProjectTrusted', () => {
  it('should return true if workspace.isTrusted is true', async () => {
    mockIsTrusted = true;
    const project = await makeTempProject();
    expect(isProjectTrusted(project)).toBe(true);
  });

  it('should return true if workspace.isTrusted is false but project has no trust-requiring resources', async () => {
    mockIsTrusted = false;
    const project = await makeTempProject();
    expect(isProjectTrusted(project)).toBe(true);
  });

  it('should return false if workspace.isTrusted is false and project has trust-requiring resources and not trusted in store', async () => {
    mockIsTrusted = false;
    const project = await makeTempProject();
    // A project-level skills directory is one of the resources the library
    // treats as requiring explicit trust.
    await mkdir(join(project, '.pi', 'skills'), { recursive: true });

    expect(isProjectTrusted(project)).toBe(false);
  });
});
