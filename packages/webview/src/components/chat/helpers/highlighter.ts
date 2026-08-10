import { bundledLanguages, bundledLanguagesAlias, createHighlighter } from 'shiki';

import { logger } from '@pi-code/shared/core/logger';

import type { BundledLanguage, Highlighter } from 'shiki';

export type ExtendedLanguage = BundledLanguage | 'txt';

const warnedLanguages = new Set<string>();

export function normalizeLanguage(language: string | undefined): ExtendedLanguage {
  if (!language) return 'txt';

  const normalizedInput = language.toLowerCase();

  if (normalizedInput in bundledLanguages) {
    return normalizedInput as BundledLanguage;
  }

  const aliased = bundledLanguagesAlias[normalizedInput];
  if (typeof aliased === 'string' && aliased in bundledLanguages) {
    return aliased as BundledLanguage;
  }

  if (language !== 'txt' && !warnedLanguages.has(language)) {
    logger.warn(`Unrecognized language '${language}', defaulting to 'txt'.`);
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

  private async initialize(): Promise<Highlighter> {
    if (this.instance) return this.instance;

    if (!this.initPromise) {
      this.initPromise = createHighlighter({
        themes: ['github-light', 'github-dark'],
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
            logger.error(`Failed to load language '${targetLang}':`, error);
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
      logger.error('Error in getHighlighter:', error);
      throw error;
    }
  }
}

const shikiManager = new ShikiHighlighterManager();

export async function getHighlighter(language?: string): Promise<Highlighter> {
  return shikiManager.getHighlighter(language);
}
