import { describe, expect, it, vi } from 'vitest';

import { isProjectTrusted } from './vscode';

let mockIsTrusted = false;

vi.mock('vscode', () => {
  return {
    workspace: {
      get isTrusted() {
        return mockIsTrusted;
      },
    },
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => {
  return {
    getAgentDir: () => '/mock/agent/dir',
    hasTrustRequiringProjectResources: (cwd: string) => {
      if (cwd === '/untrusted-project') {
        return true;
      }
      return false;
    },
    ProjectTrustStore: class {
      get(cwd: string) {
        if (cwd === '/untrusted-project') {
          return false;
        }
        return true;
      }
    },
  };
});

describe('isProjectTrusted', () => {
  it('should return true if workspace.isTrusted is true', () => {
    mockIsTrusted = true;
    expect(isProjectTrusted('/untrusted-project')).toBe(true);
  });

  it('should return true if workspace.isTrusted is false but project has no trust-requiring resources', () => {
    mockIsTrusted = false;
    expect(isProjectTrusted('/simple-project')).toBe(true);
  });

  it('should return false if workspace.isTrusted is false and project has trust-requiring resources and not trusted in store', () => {
    mockIsTrusted = false;
    expect(isProjectTrusted('/untrusted-project')).toBe(false);
  });
});
