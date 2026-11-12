// Шаблоны: {name} — параметр; {n|файл|файла|файлов} — форма слова по n (ru: one|few|many, en: one|other).
import ru, { type Key } from './ru';
import en from './en';

export type Lang = 'ru' | 'en';
export type { Key };
type Params = Record<string, string | number | null | undefined>;

const DICTS: Record<Lang, Record<Key, string>> = { ru, en };
const ORDER: Record<Lang, Intl.LDMLPluralRule[]> = { ru: ['one', 'few', 'many'], en: ['one', 'other'] };
const rules: Partial<Record<Lang, Intl.PluralRules>> = {};

let LANG: Lang = 'ru';
export function setLang(l: string | null | undefined) {
  LANG = l === 'en' ? 'en' : 'ru';
  try { document.documentElement.lang = LANG; } catch { /* вне браузера */ }
}
export const getLang = () => LANG;
/** Локаль для Intl (даты, числа). en-GB — 24-часовое время, как в остальном интерфейсе. */
export const locale = (l: Lang = LANG) => (l === 'en' ? 'en-GB' : 'ru-RU');

export const langFromCode = (code: string | null | undefined): Lang => (/^(ru|uk|be|kk)\b/i.test(code ?? '') ? 'ru' : 'en');

export function pluralForm(n: number, forms: string, l: Lang = LANG): string {
  const list = forms.split('|');
  const r = (rules[l] ??= new Intl.PluralRules(locale(l)));
  let cat = r.select(Math.abs(n));
  if (l === 'ru' && cat === 'other') cat = 'many'; // дроби — как «многие»
  const i = ORDER[l].indexOf(cat);
  return list[i >= 0 ? i : list.length - 1] ?? list[0];
}

export function format(tpl: string, params: Params = {}, l: Lang = LANG): string {
  return tpl.replace(/\{(\w+)(\|[^{}]*)?\}/g, (m, name: string, forms?: string) => {
    const v = params[name];
    if (forms) return pluralForm(Number(v ?? 0), forms.slice(1), l);
    return v == null ? '' : String(v);
  });
}

export function t(key: Key, params?: Params): string {
  const tpl = DICTS[LANG][key] ?? DICTS.ru[key] ?? key;
  return params ? format(tpl, params) : tpl;
}
