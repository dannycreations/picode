# Pi Code Development Guide

## Commands

Run from the workspace root; every command fans out over all packages.

```cmd
:: Build and emit bin/pi-code-<version>.vsix
pnpm run build

:: Format, then static check the root scripts and all packages
pnpm run check

:: Run every package test suite
pnpm run test

:: Scope a command to one package with a filter
pnpm --filter @pi-code/webview run test
pnpm --filter pi-code run check
```

## Environment

- **Runtime**: Node.js
- **Package Manager**: pnpm (workspace monorepo, `packages/*`)

| Package            | Location             | Role                                                                  |
| ------------------ | -------------------- | --------------------------------------------------------------------- |
| `pi-code`          | `packages/extension` | VS Code extension host: manifest, commands, agent runtime, tool calls |
| `@pi-code/webview` | `packages/webview`   | React UI rendered inside the chat webview                             |
| `@pi-code/shared`  | `packages/shared`    | Environment-agnostic contracts and pure helpers used by both sides    |

- `packages/shared` must stay free of `vscode`, Node, and DOM APIs so both runtimes can consume it.
- Anything touching the editor belongs in `packages/extension`, anything touching the browser belongs in `packages/webview`.
