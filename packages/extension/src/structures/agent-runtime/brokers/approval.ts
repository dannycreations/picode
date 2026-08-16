import { uuidv7 } from '@earendil-works/pi-ai';

import { createRequestRegistry } from '@pi-code/extension/structures/agent-runtime/brokers/registry';

import type { ToolName } from '@pi-code/shared/core/types';

interface ApprovalRequest {
  readonly id: string;
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly subagent?: string;
  readonly toolCallId?: string;
}

type ApprovalPresenter = (request: ApprovalRequest) => void;

const approvals = createRequestRegistry<boolean>();

let presenter: ApprovalPresenter | null = null;

export function setApprovalPresenter(next: ApprovalPresenter): () => void {
  presenter = next;
  return () => {
    if (presenter === next) {
      presenter = null;
    }
  };
}

export function requestApproval(
  toolName: ToolName,
  toolCallId: string | undefined,
  args: unknown,
  subagent?: string,
  parentToolCallId?: string,
): Promise<boolean> {
  const currentPresenter = presenter;
  if (!currentPresenter) {
    return Promise.resolve(false);
  }

  const id = toolCallId || uuidv7();
  return new Promise<boolean>((resolve) => {
    approvals.register(id, resolve);
    currentPresenter({ id, toolName, args, subagent, toolCallId: parentToolCallId });
  });
}

export function approveApproval(id: string): void {
  approvals.resolve(id, true);
}

export function denyApproval(id: string): void {
  approvals.resolve(id, false);
}

export function cancelAllApprovals(): void {
  approvals.cancelAll(false);
}
