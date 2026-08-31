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
pnpm --filter pi-code run check
pnpm --filter @pi-code/webview run test
```

## Environment

- **Runtime**: Node.js
- **Package Manager**: pnpm (workspace monorepo, `packages/*`)

| Package            | Location             | Role                                            |
| ------------------ | -------------------- | ----------------------------------------------- |
| `pi-code`          | `packages/extension` | VS Code extension host and agent runtime        |
| `@pi-code/webview` | `packages/webview`   | React UI rendered inside the chat webview       |
| `@pi-code/shared`  | `shared`             | Environment-agnostic contracts and pure helpers |

- `packages/extension/shared` is the shared module, imported as `@pi-code/shared/*` by both packages. It must stay platform-agnostic: no `vscode` or DOM runtime imports, and node-originated types are allowed only as `import type`. Runtime code here is reused by the extension and the webview, so keep it free of editor- or browser-specific behavior.
- Anything touching the editor belongs in `packages/extension`, anything touching the browser belongs in `packages/webview`.
