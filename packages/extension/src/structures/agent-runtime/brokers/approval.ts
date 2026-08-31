import { uuidv7 } from '@earendil-works/pi-ai';

import { createRequestRegistry } from '@pi-code/extension/structures/agent-runtime/brokers/registry';
import { clearAllApprovalDurations, clearApprovalDuration } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { logger } from '@pi-code/shared/core/logger';

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
    logger.error('Approval requested before an approval presenter was registered. Denying the tool call.');
    return Promise.resolve(false);
  }

  const id = toolCallId || uuidv7();
  // A reused id (a retried tool call) must not orphan the earlier pending
  // approval, which would hang the awaiting tool_call handler forever.
  approvals.resolve(id, false);
  return new Promise<boolean>((resolve) => {
    approvals.register(id, resolve);
    currentPresenter({ id, toolName, args, subagent, toolCallId: parentToolCallId });
  });
}

export function approveApproval(id: string): void {
  approvals.resolve(id, true);
}

export function denyApproval(id: string): void {
  clearApprovalDuration(id);
  approvals.resolve(id, false);
}

export function cancelAllApprovals(): void {
  clearAllApprovalDurations();
  approvals.cancelAll(false);
}
