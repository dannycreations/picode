import { uuidv7 } from '@earendil-works/pi-ai';

import type { ToolName } from '@pi-code/shared/core/protocol';

interface ApprovalRequest {
  readonly id: string;
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly subagent?: string;
}

type ApprovalPresenter = (request: ApprovalRequest) => void;

const resolvers = new Map<string, (approved: boolean) => void>();

let presenter: ApprovalPresenter | null = null;

function settle(id: string, approved: boolean): void {
  const resolve = resolvers.get(id);
  if (resolve) {
    resolvers.delete(id);
    resolve(approved);
  }
}

export function setApprovalPresenter(next: ApprovalPresenter): () => void {
  presenter = next;
  return () => {
    if (presenter === next) {
      presenter = null;
    }
  };
}

export function requestApproval(toolName: ToolName, toolCallId: string | undefined, args: unknown, subagent?: string): Promise<boolean> {
  const currentPresenter = presenter;
  if (!currentPresenter) {
    return Promise.resolve(false);
  }

  const id = toolCallId || uuidv7();
  return new Promise<boolean>((resolve) => {
    resolvers.set(id, resolve);
    currentPresenter({ id, toolName, args, subagent });
  });
}

export function approveApproval(id: string): void {
  settle(id, true);
}

export function denyApproval(id: string): void {
  settle(id, false);
}
