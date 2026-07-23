export const defaultLanguage = "hu" as const;

export type Language = "hu" | "en";
export type DocumentLanguageTarget = { lang: string };

export function synchronizeDocumentLanguage(
  language: Language,
  target: DocumentLanguageTarget,
): void {
  target.lang = language;
}

export function applyLanguageSelection(
  language: Language,
  target: DocumentLanguageTarget,
  updateLanguage: (language: Language) => void,
): void {
  synchronizeDocumentLanguage(language, target);
  updateLanguage(language);
}
