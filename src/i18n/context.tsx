import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Locale } from '../shared';
import { detectInitialLocale, saveLocale } from './detect';
import { enMessages } from './en';
import { koMessages } from './ko';
import type { Messages } from './types';

export const MESSAGES_BY_LOCALE: Readonly<Record<Locale, Messages>> = {
  ko: koMessages,
  en: enMessages,
};

export function getMessages(locale: Locale): Messages {
  return MESSAGES_BY_LOCALE[locale];
}

export interface I18nContextValue {
  locale: Locale;
  t: Messages;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'ko',
  t: koMessages,
  setLocale: () => {},
  toggleLocale: () => {},
});

export interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? detectInitialLocale(),
  );

  const setLocale = useCallback((next: Locale) => {
    saveLocale(next);
    setLocaleState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === 'ko' ? 'en' : 'ko';
      saveLocale(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.lang = locale;
    document.title = MESSAGES_BY_LOCALE[locale].meta.title;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: MESSAGES_BY_LOCALE[locale],
      setLocale,
      toggleLocale,
    }),
    [locale, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, toggleLocale, t } = useI18n();
  return (
    <button
      type="button"
      className={className ? `btn-lang-toggle ${className}` : 'btn-lang-toggle'}
      data-testid="language-toggle"
      data-locale={locale}
      aria-label={t.common.switchLanguageAria}
      onClick={toggleLocale}
    >
      <span className="lang-opt" data-active={locale === 'ko' ? 'true' : 'false'}>
        KO
      </span>
      <span className="lang-sep" aria-hidden="true">
        /
      </span>
      <span className="lang-opt" data-active={locale === 'en' ? 'true' : 'false'}>
        EN
      </span>
    </button>
  );
}
