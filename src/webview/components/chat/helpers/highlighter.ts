import { bundledLanguages, bundledThemes, createHighlighter } from 'shiki';

import type { BundledLanguage, BundledTheme, Highlighter } from 'shiki';

export type ExtendedLanguage = BundledLanguage | 'txt';

const LANGUAGE_ALIASES: Record<string, ExtendedLanguage> = {
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
  if (!language) return 'txt';

  const normalizedInput = language.toLowerCase();

  if (normalizedInput in bundledLanguages) {
    return normalizedInput as BundledLanguage;
  }

  if (normalizedInput in LANGUAGE_ALIASES) {
    return LANGUAGE_ALIASES[normalizedInput];
  }

  if (language !== 'txt' && !warnedLanguages.has(language)) {
    console.warn(`[Shiki] Unrecognized language '${language}', defaulting to 'txt'.`);
    warnedLanguages.add(language);
  }

  return 'txt';
}

const INITIAL_LANGUAGES: BundledLanguage[] = ['shell'];

class ShikiHighlighterManager {
  private instance: Highlighter | null = null;
  private initPromise: Promise<Highlighter> | null = null;
  private readonly loadedLanguages = new Set<ExtendedLanguage>(['txt']);
  private readonly pendingLanguageLoads = new Map<ExtendedLanguage, Promise<void>>();

  public isLoaded(language: string): boolean {
    return this.loadedLanguages.has(normalizeLanguage(language));
  }

  private async initialize(): Promise<Highlighter> {
    if (this.instance) return this.instance;

    if (!this.initPromise) {
      this.initPromise = createHighlighter({
        themes: Object.keys(bundledThemes) as BundledTheme[],
        langs: INITIAL_LANGUAGES,
      }).then((instance) => {
        this.instance = instance;
        INITIAL_LANGUAGES.forEach((lang) => this.loadedLanguages.add(lang));
        return instance;
      });
    }

    return this.initPromise;
  }

  public async getHighlighter(language?: string): Promise<Highlighter> {
    try {
      const instance = await this.initialize();
      const targetLang = normalizeLanguage(language);

      if (this.loadedLanguages.has(targetLang)) {
        return instance;
      }

      let loadPromise = this.pendingLanguageLoads.get(targetLang);

      if (!loadPromise) {
        loadPromise = (async () => {
          try {
            await instance.loadLanguage(targetLang as BundledLanguage);
            this.loadedLanguages.add(targetLang);
          } catch (error) {
            console.error(`[Shiki] Failed to load language '${targetLang}':`, error);
            throw error;
          } finally {
            this.pendingLanguageLoads.delete(targetLang);
          }
        })();

        this.pendingLanguageLoads.set(targetLang, loadPromise);
      }

      await loadPromise;
      return instance;
    } catch (error) {
      console.error('[Shiki] Error in getHighlighter:', error);
      throw error;
    }
  }
}

const shikiManager = new ShikiHighlighterManager();

export const isLanguageLoaded = (language: string): boolean => {
  return shikiManager.isLoaded(language);
};

export const getHighlighter = async (language?: string): Promise<Highlighter> => {
  return shikiManager.getHighlighter(language);
};
