import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { formatCount, languages, readerCatalogues, readerLocale, readerMessage, translator, type TranslationKey } from '../src/components/ui';

const placeholders = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
const runtimeTranslator = (locale: string) => translator(locale) as (key: string, params?: Record<string, string | number>) => string;

describe('complete reader interface dictionaries', () => {
  it('keeps exactly the six existing choices', () => {
    expect(languages.map(language => language.id)).toEqual(['en', 'de', 'es', 'fr', 'it', 'pt-BR']);
    expect(Object.keys(readerCatalogues)).toEqual(languages.map(language => language.id));
  });
  it.each(languages)('$id has every key and the exact interpolation contract', ({ id }) => {
    const dictionary = readerCatalogues[id];
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(readerCatalogues.en).sort());
    for (const [key, english] of Object.entries(readerCatalogues.en)) {
      const value = dictionary[key as TranslationKey];
      expect(value.trim(), `${id}.${key}`).not.toBe('');
      expect(placeholders(value), `${id}.${key}`).toEqual(placeholders(english));
      const args = Object.fromEntries(placeholders(english).map(name => [name, `[${name}:<&$>{kept}]`]));
      const rendered = runtimeTranslator(id)(key, args);
      for (const arg of Object.values(args)) expect(rendered, `${id}.${key}`).toContain(arg);
      expect(rendered, `${id}.${key}`).not.toMatch(/\{(?:count|date|name|title|sources|updates|detail)\}(?!\])/);
    }
  });
  it('rejects missing translations in a known locale instead of silently using English', () => {
    const dictionary = readerCatalogues.de as Record<string, string>;
    const saved = dictionary.dailyTitle;
    try {
      delete dictionary.dailyTitle;
      expect(() => translator('de')('dailyTitle')).toThrow('Missing reader translation: de.dailyTitle');
    } finally { dictionary.dailyTitle = saved; }
    expect(() => runtimeTranslator('fr')('not-a-reader-key')).toThrow('Missing reader translation');
    expect(readerLocale('toString')).toBe('en');
    expect(readerLocale('unsupported')).toBe('en');
  });
  it('rejects missing, misspelled and extra interpolation values', () => {
    const t = runtimeTranslator('it');
    expect(() => t('dailyCounts')).toThrow('Invalid reader interpolation');
    expect(() => t('dailyCounts', { sources: 1, update: 2 })).toThrow('Invalid reader interpolation');
    expect(() => t('dailyCounts', { sources: 1, updates: 2, unexpected: 3 })).toThrow('Invalid reader interpolation');
    expect(t('viewCreator', { name: '<script>{count}$&</script>' })).toContain('<script>{count}$&</script>');
  });
  it.each([
    ['en', '12,345.6'], ['de', '12.345,6'], ['es', '12.345,6'],
    ['fr', '12\u202f345,6'], ['it', '12.345,6'], ['pt-BR', '12.345,6'],
  ])('formats numeric values for %s', (locale, expected) => {
    expect(formatCount(12345.6, locale)).toBe(expected);
    expect(translator(locale)('selectedCount', { count: 12345.6 })).toContain(expected);
  });
  it.each(languages)('localizes known application errors without rewriting unknown evidence ($id)', ({ id }) => {
    const t = translator(id);
    expect(readerMessage(readerCatalogues.en.youtubeChannelLink, id)).toBe(t('youtubeChannelLink'));
    expect(readerMessage(readerCatalogues.en.cloudTabConflict, id)).toBe(t('cloudTabConflict'));
    expect(readerMessage('This workspace allows 12345 followed sources. Remove a source before adding another.', id)).toBe(t('sourceLimit', { count: 12345 }));
    const diagnostic = 'Exact supplier diagnostic <&> {name}: original wording';
    expect(readerMessage('Cloud save failed: ' + diagnostic, id)).toBe(t('cloudSaveFailed', { detail: diagnostic }));
    expect(readerMessage(diagnostic, id)).toBe(diagnostic);
    expect(readerMessage(`Collected history could not be loaded: ${diagnostic} Your sources and collection are preserved. Retry to refresh history only.`, id)).toBe(t('archiveLoadFailed', { detail: diagnostic }));
    expect(readerMessage('12345 archived updates could not be displayed because their source or record is invalid. Your collection and other history are preserved.', id)).toBe(t('archiveRejected', { count: 12345 }));
  });
  it('keeps reader prose and accessibility labels out of JSX literals', () => {
    const files = ['../src/App.tsx', ...['AuthButton', 'CardSourcePanel', 'CollectionStatus', 'ContentProcessingStatus', 'DailyBriefingPanel', 'Modal', 'PostMedia', 'SocialPostCard', 'VideoKeywordStrip', 'YouTubeCard'].map(name => `../src/components/${name}.tsx`)];
    const literals: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isJsxText(node) && /[A-Za-z]{3}/.test(node.text) && node.text.trim() !== 'recap') literals.push(`${file}: ${node.text.trim()}`);
        if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'placeholder', 'alt'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer) && /[A-Za-z]{3}/.test(node.initializer.text) && node.initializer.text !== 'https://…') literals.push(`${file}: ${node.initializer.text}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(literals).toEqual([]);
  });
  it('preserves narrow toolbar, wrapped controls and readable long-source contracts', () => {
    // Structural/CSS contract only. Native 320/360px measurement belongs to parent verification.
    const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
    const cards = readFileSync(new URL('../src/components/source-cards.css', import.meta.url), 'utf8');
    const daily = readFileSync(new URL('../src/components/daily-briefing.css', import.meta.url), 'utf8');
    expect(css).toContain('grid-template-columns:minmax(0,1fr) minmax(0,1.25fr)');
    expect(css).toContain('.feed-toolbar .sort-control,.history-control{min-height:40px;min-width:0}');
    expect(css).toContain('.density-control{min-height:40px');
    expect(css).toContain('.collection-picker select{appearance:none');
    expect(cards).toContain('overflow-wrap:anywhere');
    expect(daily).toContain('flex-wrap:wrap');
    expect(daily).toContain('.daily-briefing-toolbar select{min-width:0;flex:1}');
    expect(daily).toContain('white-space:pre-wrap;overflow-wrap:anywhere');
  });
});

// These compile-time failures protect call sites as well as runtime catalogue parity.
if (false) {
  // @ts-expect-error Unknown labels cannot enter reader components.
  translator('de')('not-a-key');
  // @ts-expect-error Both counters are required.
  translator('de')('dailyCounts', { sources: 1 });
  // @ts-expect-error Typo in an interpolation name.
  translator('fr')('viewCreator', { nam: 'Creator' });
}
