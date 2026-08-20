import { cn } from 'cnfast';
import { Play, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

import { buildToolSections, getDiffStat, getFileToolMeta, getFirstDiffLine } from '@pi-code/shared/utilities/tool';
import { CodeBlock } from '@pi-code/webview/components/chat/CodeBlock';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useElapsedSeconds } from '@pi-code/webview/hooks/useElapsedSeconds';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';
import { formatDuration } from '@pi-code/webview/utilities/common';

import type { FC } from 'react';
import type { ChatMessage, ToolSection } from '@pi-code/shared/core/types';

interface ToolMessageProps {
  readonly message: ChatMessage;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
}

const ElapsedTimer: FC<{ startTs: number; isRunning: boolean; isActive: boolean; duration?: number; revealOnHover?: boolean }> = ({
  startTs,
  isRunning,
  isActive,
  duration,
  revealOnHover,
}) => {
  const elapsed = useElapsedSeconds(startTs, isActive && duration === undefined);
  const displaySeconds = duration !== undefined ? duration : elapsed;
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs font-mono text-vscode-descriptionForeground tabular-nums',
        revealOnHover && 'hidden group-hover:inline-flex',
      )}
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
  readonly isActive?: boolean;
  readonly isRunning: boolean;
  readonly isWaiting?: boolean;
  readonly startTs: number;
  readonly duration?: number;
  readonly revealTimerOnHover?: boolean;
  readonly onOpenFile: (path: string, content?: string) => void;
}

const ToolSection: FC<ToolSectionProps> = ({
  section: { title, subtitle, content, language, openPath, status },
  defaultOpen,
  isFirst,
  isLast,
  showTimer,
  isActive,
  isRunning,
  isWaiting,
  startTs,
  duration,
  revealTimerOnHover,
  onOpenFile,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = !!content && content.trim() !== '';
  const isApproval = status === 'approval';

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
        ) : isRunning && !isWaiting ? (
          <Spinner className="text-vscode-focusBorder" />
        ) : isApproval || isWaiting ? (
          <span className="codicon codicon-clock text-vscode-descriptionForeground shrink-0" />
        ) : (
          <div className="w-3.5 h-3.5 shrink-0" />
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
          <ElapsedTimer
            startTs={startTs}
            isActive={isActive ?? isRunning}
            isRunning={isRunning}
            duration={duration}
            revealOnHover={revealTimerOnHover}
          />
        ) : null}
      </div>

      {hasContent && (
        <Accordion open={open}>
          <div className="border-t border-vscode-editorGroup-border/30 p-2 pt-0">
            <CodeBlock source={content} language={language ?? 'text'} />
          </div>
        </Accordion>
      )}
    </div>
  );
};

function appendElapsed(subtitle: string | undefined, duration: number): string {
  const elapsed = formatDuration(duration);
  return subtitle ? `${subtitle} · ${elapsed}` : elapsed;
}

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

  const openFile = (target: string, content?: string) => {
    if (!target) return;
    if (message.toolName === 'edit_file') {
      useChatStore.getState().openFile(target, { line: getFirstDiffLine(content), diff: true });
      return;
    }
    useChatStore.getState().openFile(target);
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
          {sections.map((section, index) => {
            const sectionStatus = section.status ?? message.toolStatus;
            const approvalMessage = section.approvalMessage;
            const hasSecApproval = approvalMessage !== undefined;

            const isRunning = sectionStatus === 'running';
            const isWaiting = isRunning && message.toolName === 'spawn_subagent' && !section.content;
            const isSubagent = message.toolName === 'spawn_subagent';
            const isDone = !isRunning && section.duration !== undefined;
            const subagentDone = isSubagent && isDone;
            const showTimer = message.toolName === 'execute_command' || (isSubagent && section.content !== undefined);
            const displaySection = subagentDone ? { ...section, subtitle: appendElapsed(section.subtitle, section.duration) } : section;

            const item = (
              <Fragment key={index}>
                <ToolSection
                  section={displaySection}
                  defaultOpen={false}
                  isFirst={index === 0}
                  isLast={index === (isExpanded ? sections.length - 1 : 0) && !hasMore && !hasSecApproval}
                  showTimer={showTimer && !subagentDone}
                  isActive={isRunning}
                  isRunning={isRunning}
                  isWaiting={isWaiting}
                  startTs={section.ts ?? message.ts}
                  duration={section.duration}
                  revealTimerOnHover={showTimer && isDone}
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

            if (index === 0) return item;
            return (
              <Accordion key={index} open={isExpanded}>
                {item}
              </Accordion>
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
