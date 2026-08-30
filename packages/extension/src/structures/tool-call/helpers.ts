import { formatThrownValue } from '@earendil-works/pi-ai';
import { resolvePath, withFileMutationQueue } from '@earendil-works/pi-coding-agent';

import { parseAttachments } from '@pi-code/extension/utilities/codec';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { Attachment } from '@pi-code/shared/core/types';

type EmptyDetails = Record<string, never>;

export function toolResult<T = EmptyDetails>(text: string, details: T = {} as T, attachments?: readonly Attachment[]): CustomToolResult<T> {
  return { content: [{ type: 'text', text }, ...(parseAttachments(attachments) ?? [])], details };
}

export function toolError<T = EmptyDetails>(text: string, details: T = {} as T): CustomToolResult<T> {
  return { content: [{ type: 'text', text }], details, isError: true };
}

export function toolErrorFrom<T = EmptyDetails>(err: unknown, action: string): CustomToolResult<T> {
  return toolError<T>(`Error ${action}: ${formatThrownValue(err)}`);
}

export function runFileMutation(
  cwd: string,
  rawPath: string,
  action: string,
  mutate: (resolvedPath: string) => Promise<CustomToolResult>,
): Promise<CustomToolResult> {
  const resolvedPath = resolvePath(rawPath, cwd);
  return withFileMutationQueue(resolvedPath, async () => {
    try {
      return await mutate(resolvedPath);
    } catch (err) {
      return toolErrorFrom(err, action);
    }
  });
}
