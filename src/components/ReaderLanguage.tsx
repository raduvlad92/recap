import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { readerCatalogues, readerLocale, translator, type TranslationKey, type TranslationParams } from './ui';

/** Presentation only; stored reader and source data never pass through this context. */
export const ReaderLanguage = createContext('en');
export function useReaderLanguage() {
  const locale = readerLocale(useContext(ReaderLanguage));
  return { locale, t: translator(locale) };
}

/** Rich substitutions stay in their translated sentence order without HTML injection. */
export function ReaderText<K extends TranslationKey>({ message, values }: { message: K; values: { [P in keyof TranslationParams<K>]: ReactNode } }) {
  const { locale } = useReaderLanguage();
  const parts = readerCatalogues[locale][message].split(/(\{\w+\})/g);
  return <>{parts.map((part, index) => <Fragment key={index}>{/^\{\w+\}$/.test(part) ? values[part.slice(1, -1) as keyof typeof values] : part}</Fragment>)}</>;
}
