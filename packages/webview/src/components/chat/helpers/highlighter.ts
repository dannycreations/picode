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

let instance: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<ExtendedLanguage>(['txt']);
const pendingLanguageLoads = new Map<ExtendedLanguage, Promise<void>>();

async function initialize(): Promise<Highlighter> {
  if (instance) return instance;

  if (!initPromise) {
    initPromise = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: INITIAL_LANGUAGES,
    }).then((created) => {
      instance = created;
      INITIAL_LANGUAGES.forEach((lang) => loadedLanguages.add(lang));
      return created;
    });
  }

  return initPromise;
}

export async function getHighlighter(language?: string): Promise<Highlighter> {
  try {
    const highlighter = await initialize();
    const targetLang = normalizeLanguage(language);

    if (loadedLanguages.has(targetLang)) {
      return highlighter;
    }

    let loadPromise = pendingLanguageLoads.get(targetLang);

    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          await highlighter.loadLanguage(targetLang as BundledLanguage);
          loadedLanguages.add(targetLang);
        } catch (error) {
          logger.error(`Failed to load language '${targetLang}':`, error);
          throw error;
        } finally {
          pendingLanguageLoads.delete(targetLang);
        }
      })();

      pendingLanguageLoads.set(targetLang, loadPromise);
    }

    await loadPromise;
    return highlighter;
  } catch (error) {
    logger.error('Error in getHighlighter:', error);
    throw error;
  }
}
