import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const contextDir = join(rootDir, 'context');

interface Repo {
  readonly name: string;
  readonly url: string;
}

const REPOS: Repo[] = [
  { name: 'kilocode', url: 'https://github.com/Kilo-Org/kilocode-legacy' },
  { name: 'pi', url: 'https://github.com/earendil-works/pi' },
  { name: 'vscode', url: 'https://github.com/microsoft/vscode' },
];

function run(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function syncRepo(repo: Repo): void {
  const repoDir = join(contextDir, repo.name);

  if (existsSync(repoDir)) {
    console.log(`[${repo.name}] Resetting to latest 2 commits...`);
    run('git fetch --depth=2 origin', repoDir);
    run('git reset --hard FETCH_HEAD', repoDir);
  } else {
    console.log(`[${repo.name}] Cloning latest 2 commits...`);
    run(`git clone --depth=2 "${repo.url}" "${repoDir}"`, rootDir);
  }

  console.log(`[${repo.name}] Done.`);
}

async function main(): Promise<void> {
  for (const repo of REPOS) {
    try {
      syncRepo(repo);
    } catch (err) {
      console.error(`[${repo.name}] Failed:`, err);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
