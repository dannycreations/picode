import { cn } from 'cnfast';
import { Play, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

import { buildToolSections, getDiffStat, getFileToolMeta, getFirstDiffLine } from '@pi-code/shared/utilities/tool';
import { CodeBlock } from '@pi-code/webview/components/chat/CodeBlock';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useElapsedSeconds } from '@pi-code/webview/hooks/useElapsedSeconds';
import { formatDuration } from '@pi-code/webview/utilities/common';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ChatMessage, ToolSection } from '@pi-code/shared/core/types';

interface ToolMessageProps {
  readonly message: ChatMessage;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
}

const ElapsedTimer: FC<{ startTs: number; isRunning: boolean; isActive: boolean; duration?: number }> = ({
  startTs,
  isRunning,
  isActive,
  duration,
}) => {
  const elapsed = useElapsedSeconds(startTs, isActive && duration === undefined);
  const displaySeconds = duration !== undefined ? duration : elapsed;
  return (
    <span
      className="flex items-center gap-1 text-xs font-mono text-vscode-descriptionForeground tabular-nums"
      aria-label={isRunning ? 'Elapsed loading time' : 'Time taken'}
    >
      {isRunning && <Spinner className="text-vscode-focusBorder" />}
      {formatDuration(displaySeconds)}
    </span>
  );
};

const DiffStat: FC<{ content?: string; className?: string }> = ({ content, className }) => {
  const stat = getDiffStat(content);
  if (!stat) return null;
  return (
    <span className={cn('flex items-center gap-1 text-xs font-mono select-none', className)}>
      {stat.added > 0 && <span className="text-vscode-charts-green">+{stat.added}</span>}
      {stat.removed > 0 && <span className="text-vscode-charts-red">-{stat.removed}</span>}
    </span>
  );
};

interface ToolSectionProps {
  readonly section: ToolSection;
  readonly defaultOpen: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly showTimer: boolean;
  readonly isRunning: boolean;
  readonly isActive?: boolean;
  readonly startTs: number;
  readonly duration?: number;
  readonly onOpenFile: (path: string, content?: string) => void;
}

const ToolSection: FC<ToolSectionProps> = ({
  section: { title, subtitle, content, language, openPath },
  defaultOpen,
  isFirst,
  isLast,
  showTimer,
  isRunning,
  isActive,
  startTs,
  duration,
  onOpenFile,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = !!content && content.trim() !== '';

  const radiusClass = isFirst && isLast ? 'rounded-md' : isFirst ? 'rounded-t-md' : isLast ? 'rounded-b-md' : 'rounded-none';

  return (
    <div className={cn('border border-vscode-editorGroup-border overflow-hidden bg-vscode-input-background', radiusClass)}>
      <div className="p-2 flex items-center gap-2 select-none">
        {hasContent ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className={cn(
              'codicon cursor-pointer text-vscode-descriptionForeground hover:text-vscode-foreground shrink-0',
              open ? 'codicon-chevron-up' : 'codicon-chevron-down',
            )}
          />
        ) : (
          <Spinner className="text-vscode-focusBorder" />
        )}
        <div className="min-w-0 flex-1">
          <Tooltip content={openPath ?? title}>
            {hasContent ? (
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-label={open ? 'Collapse' : 'Expand'}
                className="font-mono text-xs text-vscode-foreground truncate hover:text-vscode-textLink cursor-pointer select-text block max-w-full text-left"
              >
                {title}
              </button>
            ) : (
              <span className="font-mono text-xs text-vscode-foreground truncate select-text block max-w-full text-left">{title}</span>
            )}
          </Tooltip>
          {subtitle && (
            <Tooltip content={subtitle}>
              <span className="block max-w-full truncate text-[10px] text-vscode-descriptionForeground select-text cursor-pointer">{subtitle}</span>
            </Tooltip>
          )}
        </div>
        {openPath ? (
          <div className="flex items-center shrink-0">
            {language === 'diff' && <DiffStat content={content} className="group-hover:hidden" />}
            <span className="hidden group-hover:inline-flex">
              <Tooltip content="Open file">
                <button
                  type="button"
                  onClick={() => onOpenFile(openPath, content)}
                  aria-label="Open file"
                  className="codicon codicon-link-external text-vscode-descriptionForeground hover:text-vscode-foreground cursor-pointer"
                />
              </Tooltip>
            </span>
          </div>
        ) : showTimer ? (
          <ElapsedTimer startTs={startTs} isRunning={isRunning} isActive={isActive ?? isRunning} duration={duration} />
        ) : null}
      </div>

      {open && hasContent && (
        <div className="border-t border-vscode-editorGroup-border/30 p-2 pt-0">
          <CodeBlock source={content} language={language ?? 'text'} />
        </div>
      )}
    </div>
  );
};

export const ToolMessage: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  if (message.sender !== 'tool') return null;

  const { title, icon } = getFileToolMeta(message.toolName, message.toolStatus);
  const sections: ReadonlyArray<ToolSection> = message.toolSections ?? buildToolSections(message);
  const hiddenCount = sections.length > 0 ? sections.length - 1 : 0;
  const hasMore = hiddenCount > 0;
  const approvalIndex = sections.findIndex((s) => s.approvalMessage !== undefined);
  const shouldExpandForApproval = hasMore && approvalIndex > 0;
  const [isExpanded, setIsExpanded] = useState(shouldExpandForApproval);

  useEffect(() => {
    if (shouldExpandForApproval && !isExpanded) {
      setIsExpanded(true);
    }
  }, [shouldExpandForApproval, isExpanded]);

  const visibleSections = isExpanded ? sections : sections.slice(0, 1);

  const openFile = (target: string, content?: string) => {
    if (!target) return;
    if (message.toolName === 'edit_file') {
      vscode?.postMessage({ type: 'open_file', text: target, values: { line: getFirstDiffLine(content), diff: true } });
      return;
    }
    vscode?.postMessage({ type: 'open_file', text: target });
  };

  return (
    <div className="group flex flex-col gap-1.5">
      <MessageHeader
        icon={<span className={cn('codicon', `codicon-${icon}`, 'text-vscode-focusBorder shrink-0')} />}
        title={title}
        timestamp={message.ts}
      />

      <div className="ml-6 text-sm">
        <div className="border border-vscode-editorGroup-border rounded-md overflow-hidden bg-vscode-input-background">
          {visibleSections.map((section, index) => {
            const sectionStatus = section.status ?? message.toolStatus;
            const approvalMessage = section.approvalMessage;
            const hasSecApproval = approvalMessage !== undefined;

            return (
              <Fragment key={index}>
                <ToolSection
                  section={section}
                  defaultOpen={false}
                  isFirst={index === 0}
                  isLast={index === visibleSections.length - 1 && !hasMore && !hasSecApproval}
                  showTimer={message.toolName === 'execute_command' || (message.toolName === 'spawn_subagent' && section.content !== undefined)}
                  isRunning={sectionStatus === 'running'}
                  isActive={sectionStatus === 'running'}
                  startTs={section.ts ?? message.ts}
                  duration={section.duration}
                  onOpenFile={openFile}
                />
                {approvalMessage && (
                  <div className="p-2 bg-vscode-editorWarning-background/10 flex flex-col gap-2">
                    <div className="flex items-center gap-2 select-none">
                      <button onClick={() => onApproveTool(approvalMessage.id)} className="action-button flex-1">
                        <Play size={12} fill="currentColor" /> Approve
                      </button>
                      <button onClick={() => onDenyTool(approvalMessage.id)} className="action-button action-button-secondary flex-1">
                        <X size={12} /> Deny
                      </button>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}

          {hasMore && (
            <Tooltip content={isExpanded ? 'Collapse' : `Show ${hiddenCount} more item${hiddenCount === 1 ? '' : 's'}`}>
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                className="action-button w-full rounded-none! cursor-pointer"
              >
                <span className={cn('codicon', isExpanded ? 'codicon-chevron-up' : 'codicon-chevron-down', !isExpanded && 'mr-1')} />
                {!isExpanded && `+${hiddenCount} more`}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};
