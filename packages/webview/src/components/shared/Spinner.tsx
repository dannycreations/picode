import type { FC } from 'react';

const SPINNER_STYLE = { fontSize: 14, width: 14, height: 14 };

export const Spinner: FC = () => (
  <span
    role="status"
    aria-label="Working"
    className="codicon codicon-loading codicon-modifier-spin shrink-0 text-vscode-focusBorder"
    style={SPINNER_STYLE}
  />
);
