import { cn } from 'cnfast';
import { CheckCircle, ChevronUp, Play, PocketKnife, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

import { CodeBlock } from '@pi-code/webview/components/chat/CodeBlock';
import { getDiffStat, getFirstDiffLine } from '@pi-code/webview/components/chat/messages/helpers/common';
import {
  FILE_TOOLS,
  getFileToolMeta,
  getToolDiffMeta,
  getToolFilePath,
  getToolLanguage,
} from '@pi-code/webview/components/chat/messages/helpers/tool';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ChatMessage, ReadFileSection } from '@pi-code/shared/core/types';

interface ToolMessageProps {
  readonly message: ChatMessage;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
}

export const ToolMessage: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  const isStructuredFileTool =
    message.toolName !== undefined && FILE_TOOLS.has(message.toolName) && (message.toolName !== 'read_file' || message.files !== undefined);

  if (isStructuredFileTool) {
    return <FileToolMessage message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />;
  }

  return <GenericToolMessage message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />;
};

const FileToolMessage: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { title, icon, language } = getFileToolMeta(message.toolName, message.toolStatus);
  const sections: ReadonlyArray<ReadFileSection> = message.files
    ? message.files.map((file) => ({ path: file.path, content: file.content }))
    : [{ path: getToolFilePath(message.toolArgs) ?? '', content: message.diff ?? '' }];
  const isRead = message.toolName === 'read_file';
  const hiddenCount = sections.length - 1;
  const hasMore = hiddenCount > 0;
  const hasApproval = message.toolStatus === 'approval';
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
          {visibleSections.map((section, index) => (
            <FileSectionCard
              key={index}
              section={section}
              language={isRead ? 'text' : language}
              defaultOpen={false}
              isFirst={index === 0}
              isLast={index === visibleSections.length - 1 && !hasMore && !hasApproval}
              onOpenFile={openFile}
            />
          ))}

          {hasMore && (
            <Tooltip content={isExpanded ? 'Collapse' : `Show ${hiddenCount} more file${hiddenCount === 1 ? '' : 's'}`}>
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

          <ApprovalControls message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />
        </div>
      </div>
    </div>
  );
};

interface FileSectionCardProps {
  readonly section: ReadFileSection;
  readonly language: string;
  readonly defaultOpen: boolean;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onOpenFile: (path: string, content?: string) => void;
}

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

const FileSectionCard: FC<FileSectionCardProps> = ({ section: { path, content }, language, defaultOpen, isFirst, isLast, onOpenFile }) => {
  const [open, setOpen] = useState(defaultOpen);

  const radiusClass = isFirst && isLast ? 'rounded-md' : isFirst ? 'rounded-t-md' : isLast ? 'rounded-b-md' : 'rounded-none';

  return (
    <div className={cn('border border-vscode-editorGroup-border overflow-hidden bg-vscode-input-background', radiusClass)}>
      <div className="p-2 flex items-center gap-2 select-none">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Collapse' : 'Expand'}
          className={cn(
            'codicon cursor-pointer text-vscode-descriptionForeground hover:text-vscode-foreground shrink-0',
            open ? 'codicon-chevron-up' : 'codicon-chevron-down',
          )}
        />
        {path ? (
          <Tooltip content={path}>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="font-mono text-xs text-vscode-foreground truncate hover:text-vscode-textLink cursor-pointer select-text"
            >
              {path}
            </button>
          </Tooltip>
        ) : (
          <span className="font-mono text-xs text-vscode-descriptionForeground truncate select-text">File</span>
        )}
        <div className="flex-grow" />
        {path && (
          <div className="flex items-center shrink-0">
            {language === 'diff' && <DiffStat content={content} className="group-hover:hidden" />}
            <span className="hidden group-hover:inline-flex">
              <Tooltip content="Open file">
                <button
                  type="button"
                  onClick={() => onOpenFile(path, content)}
                  aria-label="Open file"
                  className="codicon codicon-link-external text-vscode-descriptionForeground hover:text-vscode-foreground cursor-pointer"
                />
              </Tooltip>
            </span>
          </div>
        )}
      </div>

      {open && content && (
        <div className="border-t border-vscode-editorGroup-border/30 p-2 pt-0">
          <CodeBlock source={content} language={language} />
        </div>
      )}
    </div>
  );
};

const GenericToolMessage: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  const [isDiffExpanded, setIsDiffExpanded] = useState(false);
  const hasBottomBlock = message.toolStatus === 'approval';
  const { label: diffLabel, icon: diffIcon } = getToolDiffMeta(message.toolName);

  const renderToolStatusIcon = () => {
    switch (message.toolStatus) {
      case 'completed':
        return <CheckCircle size={14} className="text-vscode-charts-green shrink-0" />;
      case 'denied':
        return <ShieldAlert size={14} className="text-vscode-errorForeground shrink-0" />;
      case 'running':
        return <Spinner className="text-vscode-focusBorder" />;
      default:
        return <PocketKnife size={14} className="text-vscode-focusBorder shrink-0" />;
    }
  };

  return (
    <div className="group flex flex-col gap-1.5">
      <MessageHeader icon={renderToolStatusIcon()} title="Pi Execute" timestamp={message.ts} />

      <div className="ml-6 text-sm">
        <div className="border border-vscode-editorGroup-border rounded-md overflow-hidden bg-vscode-input-background">
          <div
            className={cn(
              'p-3 flex items-start gap-2 select-none',
              message.diff || hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : '',
            )}
          >
            <span className="codicon codicon-terminal text-vscode-focusBorder mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-vscode-foreground truncate select-text">{message.text}</div>
              {message.toolArgs && (
                <Tooltip content={message.toolArgs}>
                  <div className="mt-1 font-mono text-xs text-vscode-descriptionForeground truncate select-text">Arguments: {message.toolArgs}</div>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Diff / Result Accordion */}
          {message.diff && (
            <div className={hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : ''}>
              <button
                onClick={() => setIsDiffExpanded(!isDiffExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 bg-vscode-input-background text-muted border-none cursor-pointer text-left hover:bg-vscode-list-hoverBackground select-none"
              >
                <span className="font-semibold flex items-center gap-1.5">
                  <span className={cn('codicon', `codicon-${diffIcon}`, 'pr-0.5')} />
                  {diffLabel}
                </span>
                <ChevronUp size={12} className={cn('transition-transform duration-200', !isDiffExpanded && 'rotate-180')} />
              </button>
              {isDiffExpanded && (
                <div className="border-t border-vscode-editorGroup-border/30 p-2">
                  <CodeBlock source={message.diff} language={getToolLanguage(message.toolName)} />
                </div>
              )}
            </div>
          )}

          <ApprovalControls message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />
        </div>
      </div>
    </div>
  );
};

const ApprovalControls: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  if (message.toolStatus !== 'approval') return null;

  return (
    <div className="p-3 bg-vscode-editorWarning-background/10 flex flex-col gap-2">
      <div className="text-xs font-semibold text-vscode-foreground flex items-center gap-1.5 select-none">
        <span className="codicon codicon-question text-vscode-editorWarning-foreground" />
        {message.subagent ? (
          <>
            <span className="rounded bg-vscode-badge-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-vscode-badge-foreground">
              {message.subagent}
            </span>
            sub-agent request waiting for approval
          </>
        ) : (
          'Tool request waiting for approval'
        )}
      </div>
      <div className="flex items-center gap-2 select-none">
        <button onClick={() => onApproveTool(message.id)} className="action-button flex-1">
          <Play size={12} fill="currentColor" /> Approve
        </button>
        <button onClick={() => onDenyTool(message.id)} className="action-button action-button-secondary flex-1">
          <X size={12} /> Deny
        </button>
      </div>
    </div>
  );
};
