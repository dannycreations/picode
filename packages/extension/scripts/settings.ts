import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, exit } from 'node:process';

import { getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';

import type { SettingKey } from '@pi-code/shared/core/settings';

const packageDir = resolve(import.meta.dirname, '..');
const manifestPath = join(packageDir, 'package.json');

export interface ConfigurationProperty {
  readonly type: 'boolean' | 'number' | 'array';
  readonly items?: { readonly type: 'string' };
  readonly default: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly description?: string;
  readonly markdownDescription?: string;
}

interface ManifestSettings {
  readonly properties: Record<string, ConfigurationProperty>;
  readonly restricted: readonly string[];
}

function buildProperty(key: SettingKey): ConfigurationProperty {
  const spec = getSettingSpec(key);
  // Backticks are the only markup used in schema descriptions, so plain text
  // stays on `description` and keeps the settings UI free of markdown parsing.
  const text = spec.description.includes('`') ? { markdownDescription: spec.description } : { description: spec.description };

  switch (spec.type) {
    case 'boolean':
      return { type: 'boolean', default: spec.default, ...text };
    case 'number':
      return { type: 'number', default: spec.default, minimum: spec.minimum, maximum: spec.maximum, ...text };
    case 'string[]':
      return { type: 'array', items: { type: 'string' }, default: [...spec.default], ...text };
  }
}

export function buildManifestSettings(prefix: string): ManifestSettings {
  const properties: Record<string, ConfigurationProperty> = {};
  const restricted: string[] = [];

  for (const key of SETTING_KEYS) {
    const id = `${prefix}.${key}`;
    properties[id] = buildProperty(key);
    if (getSettingSpec(key).restricted) restricted.push(id);
  }

  return { properties, restricted };
}

interface Manifest {
  name: string;
  capabilities: { untrustedWorkspaces: { restrictedConfigurations: unknown } };
  contributes: { configuration: { properties: unknown } };
}

function readManifest(): { raw: string; manifest: Manifest } {
  const raw = readFileSync(manifestPath, 'utf8');
  return { raw, manifest: JSON.parse(raw) as Manifest };
}

async function format(source: string): Promise<string> {
  try {
    const prettier = await import('prettier');
    const options = await prettier.resolveConfig(manifestPath);
    return await prettier.format(source, { ...options, filepath: manifestPath });
  } catch {
    return source;
  }
}

export function diffManifestSettings(manifest: Manifest): readonly string[] {
  const expected = buildManifestSettings(manifest.name);
  const problems: string[] = [];

  const actualProperties = (manifest.contributes.configuration.properties ?? {}) as Record<string, unknown>;
  for (const [id, property] of Object.entries(expected.properties)) {
    const actual = actualProperties[id];
    if (actual === undefined) {
      problems.push(`missing "${id}"`);
    } else if (JSON.stringify(actual) !== JSON.stringify(property)) {
      problems.push(`stale "${id}"\n    expected: ${JSON.stringify(property)}\n    actual:   ${JSON.stringify(actual)}`);
    }
  }
  for (const id of Object.keys(actualProperties)) {
    if (!(id in expected.properties)) problems.push(`unknown "${id}" is not declared in SETTINGS_SCHEMA`);
  }
  if (Object.keys(actualProperties).join() !== Object.keys(expected.properties).join()) {
    problems.push('configuration properties are out of schema order');
  }

  const actualRestricted = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations;
  if (JSON.stringify(actualRestricted) !== JSON.stringify(expected.restricted)) {
    problems.push(
      `restrictedConfigurations is out of sync\n    expected: ${JSON.stringify(expected.restricted)}\n    actual:   ${JSON.stringify(actualRestricted)}`,
    );
  }

  return problems;
}

async function main(): Promise<void> {
  const isCheck = argv.includes('--check');
  const { raw, manifest } = readManifest();
  const problems = diffManifestSettings(manifest);

  if (isCheck) {
    if (problems.length === 0) {
      console.log('Manifest settings match the shared schema.');
      return;
    }
    console.error(`package.json is out of sync with @pi-code/shared/core/settings:\n  - ${problems.join('\n  - ')}`);
    console.error('\nRun "pnpm --filter pi-code run check:settings" to regenerate the manifest.');
    exit(1);
  }

  const expected = buildManifestSettings(manifest.name);
  manifest.capabilities.untrustedWorkspaces.restrictedConfigurations = expected.restricted;
  manifest.contributes.configuration.properties = expected.properties;

  const next = await format(`${JSON.stringify(manifest, null, 2)}\n`);
  if (next === raw) {
    console.log('Manifest settings already up to date.');
    return;
  }

  writeFileSync(manifestPath, next);
  console.log(`Updated ${SETTING_KEYS.length} settings in package.json.`);
}

if (resolve(argv[1] ?? '') === resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
