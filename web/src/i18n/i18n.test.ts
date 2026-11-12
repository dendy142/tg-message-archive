import { describe, it, expect, afterEach } from 'vitest';
import ru from './ru';
import en from './en';
import { t, setLang, format, langFromCode } from '.';
import { count, W } from '../util';

const params = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
afterEach(() => setLang('ru'));

describe('i18n интерфейса', () => {
  it('en: те же ключи и параметры, без пустых строк', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    const bad = (Object.keys(ru) as (keyof typeof ru)[]).filter((k) => !en[k] || JSON.stringify(params(ru[k])) !== JSON.stringify(params(en[k])));
    expect(bad).toEqual([]);
  });
  it('переключение языка и формы слов', () => {
    expect(count(5, W.file)).toBe('5 файлов');
    setLang('en');
    expect(count(1, W.file)).toBe('1 file');
    expect(count(5, W.file)).toBe('5 files');
    expect(t('common.atTime', { date: 'today', time: '10:00' })).toBe('today at 10:00');
    expect(format('{n} {n|файл|файла|файлов}', { n: 22 }, 'ru')).toBe('22 файла');
  });
  it('язык по language_code', () => {
    expect(langFromCode('uk')).toBe('ru');
    expect(langFromCode('es')).toBe('en');
  });
});
