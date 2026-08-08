# Pi Code Development Guide

## Commands

Run from the workspace root; every command fans out over all packages.

```cmd
:: Build and emit bin/pi-code-<version>.vsix
pnpm run build

:: Format, then type check the root scripts and all packages
pnpm run check

:: Run every package test suite
pnpm run test
```

Scope a command to one package with a filter:

```cmd
pnpm --filter @pi-code/webview run test
pnpm --filter pi-code run check
```

## Environment

- **Runtime**: Node.js
- **Package Manager**: pnpm (workspace monorepo, `packages/*`)

## Workspace

| Package            | Location             | Role                                                                  |
| ------------------ | -------------------- | --------------------------------------------------------------------- |
| `pi-code`          | `packages/extension` | VS Code extension host: manifest, commands, agent runtime, tool calls |
| `@pi-code/webview` | `packages/webview`   | React UI rendered inside the chat webview                             |
| `@pi-code/shared`  | `packages/shared`    | Environment-agnostic contracts and pure helpers used by both sides    |

`packages/shared` must stay free of `vscode`, Node, and DOM APIs so both runtimes can
consume it. Anything touching the editor belongs in `packages/extension`; anything
touching the browser belongs in `packages/webview`.

## Reference

Inspect local context repositories to align design, logic, and integration patterns:

- **Kilocode** (`./context/kilocode/AGENTS.md`): Primary reference for product design, user experience, system workflows, and feature implementations.
- **Pi Agent** (`./context/pi/AGENTS.md` and `./context/pi/packages/coding-agent/`): Primary reference for backend architecture, core agent logic, and `@earendil-works/pi-coding-agent` dependencies.
- **Visual Studio Code** (`./context/vscode/`): Reference for extension architecture, editor UI components, and VS Code API integrations.
