/** Supported output languages: setting code → full name injected into the prompt. */
export const LANGUAGES: Record<string, string> = {
    'pt-br': 'Brazilian Portuguese',
    'en-us': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'ja': 'Japanese',
    'zh-cn': 'Simplified Chinese',
};

export const DEFAULT_LANGUAGE = 'en-us';

/** Map a setting code (e.g. `pt-br`) to the full language name (e.g. `Brazilian Portuguese`). */
export function resolveLanguage(code: string | undefined): string {
    return LANGUAGES[code ?? DEFAULT_LANGUAGE] ?? LANGUAGES[DEFAULT_LANGUAGE];
}
