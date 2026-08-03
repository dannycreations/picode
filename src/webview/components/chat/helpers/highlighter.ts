import { bundledLanguages, bundledThemes, createHighlighter } from 'shiki';

import type { BundledLanguage, BundledTheme, Highlighter } from 'shiki';

export type ExtendedLanguage = BundledLanguage | 'txt';

const languageAliases: Record<string, ExtendedLanguage> = {
  text: 'txt',
  plaintext: 'txt',
  plain: 'txt',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shellscript: 'shell',
  'shell-script': 'shell',
  console: 'shell',
  terminal: 'shell',
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  ts: 'typescript',
  py: 'python',
  python3: 'python',
  py3: 'python',
  rb: 'ruby',
  md: 'markdown',
  cpp: 'c++',
  cc: 'c++',
  cs: 'c#',
  csharp: 'c#',
  htm: 'html',
  yml: 'yaml',
  dockerfile: 'docker',
  styles: 'css',
  style: 'css',
  jsonc: 'json',
  json5: 'json',
  xaml: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  mysql: 'sql',
  postgresql: 'sql',
  postgres: 'sql',
  pgsql: 'sql',
  plsql: 'sql',
  oracle: 'sql',
};

const warnedLanguages = new Set<string>();

export function normalizeLanguage(language: string | undefined): ExtendedLanguage {
  if (language === undefined) {
    return 'txt';
  }

  const normalizedInput = language.toLowerCase();

  if (normalizedInput in bundledLanguages) {
    return normalizedInput as BundledLanguage;
  }

  if (normalizedInput in languageAliases) {
    return languageAliases[normalizedInput];
  }

  if (language !== 'txt' && !warnedLanguages.has(language)) {
    console.warn(`[Shiki] Unrecognized language '${language}', defaulting to txt.`);
    warnedLanguages.add(language);
  }

  return 'txt';
}

export const isLanguageLoaded = (language: string): boolean => {
  return state.loadedLanguages.has(normalizeLanguage(language));
};

const initialLanguages: BundledLanguage[] = ['shell'];

const state: {
  instance: Highlighter | null;
  instanceInitPromise: Promise<Highlighter> | null;
  loadedLanguages: Set<ExtendedLanguage>;
  pendingLanguageLoads: Map<ExtendedLanguage, Promise<void>>;
} = {
  instance: null,
  instanceInitPromise: null,
  loadedLanguages: new Set<ExtendedLanguage>(['txt']),
  pendingLanguageLoads: new Map(),
};

export const getHighlighter = async (language?: string): Promise<Highlighter> => {
  try {
    const shikilang = normalizeLanguage(language);

    if (!state.instanceInitPromise) {
      state.instanceInitPromise = (async () => {
        const instance = await createHighlighter({
          themes: Object.keys(bundledThemes) as BundledTheme[],
          langs: initialLanguages,
        });

        state.instance = instance;
        initialLanguages.forEach((lang) => state.loadedLanguages.add(lang));
        return instance;
      })();
    }

    const instance = await state.instanceInitPromise;

    if (!state.loadedLanguages.has(shikilang)) {
      let loadingPromise = state.pendingLanguageLoads.get(shikilang);

      if (!loadingPromise) {
        loadingPromise = (async () => {
          try {
            await instance.loadLanguage(shikilang as BundledLanguage);
            state.loadedLanguages.add(shikilang);
          } catch (error) {
            console.error(`[Shiki] Failed to load language ${shikilang}:`, error);
            throw error;
          } finally {
            state.pendingLanguageLoads.delete(shikilang);
          }
        })();

        state.pendingLanguageLoads.set(shikilang, loadingPromise);
      }

      await loadingPromise;
    }

    return instance;
  } catch (error) {
    console.error('[Shiki] Error in getHighlighter:', error);
    throw error;
  }
};
