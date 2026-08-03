import type { FC } from 'react';

export const ChatLogo: FC = () => {
  return (
    <div className="flex items-center justify-center w-14 h-14 mx-auto my-2" data-testid="pi-code-logo">
      <svg
        className="w-full h-full text-[var(--vscode-focusBorder,rgba(0,122,204,0.85))] dark:text-[var(--vscode-focusBorder,rgba(0,122,204,0.85))]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="2" width="20" height="20" rx="4" />
        <path d="m16 8-4 4 4 4" />
        <path d="M12 8v8" />
        <path d="m8 8 4 4-4 4" />
      </svg>
    </div>
  );
};
