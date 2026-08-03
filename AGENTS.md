# Pi Code Development Guide

## Environment

- **Runtime**: Node.js
- **Package Manager**: pnpm
- **Import Path Aliases**:
  - Frontend modules: Use `@webview/`
  - Backend modules: Use `@extension/`

## Commands

```cmd
# Run static validation and type checks
pnpm run check
```

## Reference

Inspect local context repositories to align design, logic, and integration patterns:

- **Kilocode** (`./context/kilocode/AGENTS.md`): Primary reference for product design, user experience, system workflows, and feature implementations.
- **Pi Agent** (`./context/pi/AGENTS.md` and `./context/pi/packages/coding-agent/`): Primary reference for backend architecture, core agent logic, and `@earendil-works/pi-coding-agent` dependencies.
- **Visual Studio Code** (`./context/vscode/`): Reference for extension architecture, editor UI components, and VS Code API integrations.
