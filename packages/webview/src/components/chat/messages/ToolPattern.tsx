import { cn } from 'cnfast';
import { Check, CheckCheck, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';

import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

interface ToolPatternProps {
  readonly patterns: readonly string[];
  readonly allowedPatterns: readonly string[];
  readonly deniedPatterns: readonly string[];
  readonly onToggleAllow: (pattern: string) => void;
  readonly onToggleDeny: (pattern: string) => void;
}

export const ToolPattern = ({ patterns, allowedPatterns, deniedPatterns, onToggleAllow, onToggleDeny }: ToolPatternProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusOf = (pattern: string): 'allowed' | 'denied' | 'none' =>
    allowedPatterns.includes(pattern) ? 'allowed' : deniedPatterns.includes(pattern) ? 'denied' : 'none';

  return (
    <div className="border-t border-vscode-editorGroup-border/30 bg-vscode-input-background">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? 'Collapse patterns' : 'Manage auto-approved patterns'}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-vscode-list-hoverBackground transition-colors cursor-pointer"
      >
        <span className={cn('text-sm flex-1 text-left', isExpanded ? 'text-vscode-foreground' : 'text-vscode-descriptionForeground')}>
          <CheckCheck className="size-3 inline-block mr-2" />
          Manage auto-approved patterns
        </span>
        <ChevronUp className={cn('size-4 transition-transform text-vscode-descriptionForeground', !isExpanded && '-rotate-180')} />
      </button>

      <Accordion open={isExpanded}>
        <div className="pl-2 pr-2 pt-1 pb-2 space-y-2">
          {patterns.map((pattern) => {
            const status = statusOf(pattern);

            return (
              <div key={pattern} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 font-mono text-xs text-vscode-foreground px-1.5 py-1.5">
                  <Tooltip content={pattern}>
                    <span className="inline-block max-w-full truncate">{pattern}</span>
                  </Tooltip>
                </span>
                <div className="flex items-center gap-1">
                  <Tooltip content={status === 'allowed' ? 'Remove from allowed' : 'Add to allowed'}>
                    <button
                      type="button"
                      onClick={() => onToggleAllow(pattern)}
                      aria-label={status === 'allowed' ? 'Remove from allowed' : 'Add to allowed'}
                      className={cn('p-1 rounded transition-all cursor-pointer', {
                        'bg-vscode-charts-green/15 text-vscode-charts-green hover:bg-vscode-charts-green/25': status === 'allowed',
                        'text-vscode-descriptionForeground hover:text-vscode-charts-green hover:bg-vscode-list-hoverBackground': status !== 'allowed',
                      })}
                    >
                      <Check className="size-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content={status === 'denied' ? 'Remove from denied' : 'Add to denied'}>
                    <button
                      type="button"
                      onClick={() => onToggleDeny(pattern)}
                      aria-label={status === 'denied' ? 'Remove from denied' : 'Add to denied'}
                      className={cn('p-1 rounded transition-all cursor-pointer', {
                        'bg-vscode-charts-red/15 text-vscode-charts-red hover:bg-vscode-charts-red/25': status === 'denied',
                        'text-vscode-descriptionForeground hover:text-vscode-charts-red hover:bg-vscode-list-hoverBackground': status !== 'denied',
                      })}
                    >
                      <X className="size-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </Accordion>
    </div>
  );
};
