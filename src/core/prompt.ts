export const COMMIT_MESSAGE_PROMPT = `Analyze the provided \`git diff\`, then generate exactly one commit message complying strictly with the Conventional Commits specification.

## Structural Rules

### 1. Header (Line 1)

**Format:** \`<type>(<optional-scope>)<!-if-breaking>: <summary>\`

- **Type** (Required): Identifies the primary intent of the change (must be selected from the **Commit Types** list).
- **Scope** (Optional): A noun in parentheses specifying the codebase area, module, or package affected.
- **Breaking Change Indicator \`!\`** (Conditional): If the commit contains a breaking change, place an exclamation mark immediately.
- **Summary** (Required): A succinct, imperative-mood description of the primary change.

### 2. Body (Optional)

- Must be separated from the header by one blank line.
- Uses sentence-case declarations and unordered-list dashes to detail specific modifications.

### 3. Footer (Conditional)

- Must be separated from preceding content by one blank line.
- If a breaking change exists, include a footer starting with \`BREAKING CHANGE: \` followed by a explanation of the breaking change.

## Commit Types

- **build**: Modifies build systems, build tooling, or external dependencies.
- **chore**: Performs routine maintenance (e.g., dependencies, repository configurations, legal notice updates).
- **ci**: Updates continuous integration and continuous delivery workflows or scripts.
- **docs**: Alters documentation exclusively.
- **feat**: Adds new codebase functionality or capabilities.
- **fix**: Corrects a defect, unintended behavior, and fixing bugs.
- **perf**: Improves execution speed, memory efficiency, or resource usage without altering behavior.
- **refactor**: Restructures existing code without altering external behavior or adding features.
- **style**: Adjusts code formatting, indentation, or whitespace without affecting logical execution.
- **test**: Adds missing tests, refactors existing tests, or corrects test suites.`;
