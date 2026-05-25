/**
 * contexts/I18nContext.tsx
 *
 * Global i18n / multilanguage system.
 * Supports: es (Español), en (English), pt (Português), fr (Français).
 * Persisted to AsyncStorage so language selection survives app restarts.
 *
 * Usage:
 *   const { t, language, setLanguage } = useI18n();
 *   t('profile.editProfile')           // "Editar perfil"
 *   t('boost.boostActivatedMsg', { hours: '24' })  // template interpolation
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Locale bundles (static imports so Metro bundles them) ─────────────────────
import es from '@/locales/es.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';
import fr from '@/locales/fr.json';

export type Language = 'es' | 'en' | 'pt' | 'fr';

const LOCALES: Record<Language, Record<string, any>> = { es, en, pt, fr };
const STORAGE_KEY = '@clipdag_language';
const DEFAULT_LANG: Language = 'es';

export const AVAILABLE_LANGUAGES: { key: Language; label: string; flag: string }[] = [
  { key: 'es', label: 'Español',    flag: '🇪🇸' },
  { key: 'en', label: 'English',    flag: '🇺🇸' },
  { key: 'pt', label: 'Português',  flag: '🇧🇷' },
  { key: 'fr', label: 'Français',   flag: '🇫🇷' },
];

// ── Deep getter helper ────────────────────────────────────────────────────────
function deepGet(obj: Record<string, any>, path: string): string | undefined {
  return path.split('.').reduce((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as any)[k];
    return undefined;
  }, obj as any);
}

// ── Simple template interpolation: {{key}} → value ───────────────────────────
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return Object.entries(params).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
    str,
  );
}

// ── Context type ──────────────────────────────────────────────────────────────
interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
  isLoading: boolean;
}

const I18nContext = createContext<I18nContextType>({
  language: DEFAULT_LANG,
  setLanguage: async () => {},
  t: (k) => k,
  isLoading: true,
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLang] = useState<Language>(DEFAULT_LANG);
  const [isLoading, setIsLoading] = useState(true);

  // Load persisted language on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored && stored in LOCALES) setLang(stored as Language);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLang(lang);
    try { await AsyncStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const locale = LOCALES[language] ?? LOCALES[DEFAULT_LANG];
    const val = deepGet(locale, key) ?? deepGet(LOCALES[DEFAULT_LANG], key) ?? key;
    return typeof val === 'string' ? interpolate(val, params) : key;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isLoading }}>
      {children}
    </I18nContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
