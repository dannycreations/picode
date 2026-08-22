import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@pi-code/webview/components/shared/DropdownMenu';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useClickOutside } from '@pi-code/webview/hooks/useClickOutside';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';

export const WorkspacePicker: FC = () => {
  const folders = useChatStore((state) => state.workspaceFolders);
  const activeWorkspace = useChatStore((state) => state.activeWorkspace);
  const selectWorkspace = useChatStore((state) => state.selectWorkspace);

  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useClickOutside(pickerRef, () => setOpen(false));

  if (folders.length < 2) return null;

  const activeFolder = folders.find((folder) => folder.path === activeWorkspace);

  return (
    <div className="relative" ref={pickerRef}>
      <Tooltip content={activeFolder?.path} side="bottom">
        <button
          onClick={() => setOpen(!open)}
          className="max-w-[180px] px-2 py-1 rounded flex items-center gap-1 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-list-hoverBackground cursor-pointer"
        >
          <span className="truncate leading-none">{activeFolder?.name ?? activeWorkspace}</span>
          <ChevronDown size={10} className="shrink-0" />
        </button>
      </Tooltip>

      {open && (
        <DropdownMenu side="right" openUp={false} widthClass="w-40 max-h-45 overflow-y-auto">
          {folders.map((folder) => (
            <DropdownMenuItem
              key={folder.path}
              label={folder.name}
              selected={folder.path === activeWorkspace}
              onSelect={() => {
                selectWorkspace(folder.path);
                setOpen(false);
              }}
            />
          ))}
        </DropdownMenu>
      )}
    </div>
  );
};
