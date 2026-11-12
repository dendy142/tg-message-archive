import { describe, it, expect } from "vitest";
import { dictionaries, t, pluralForm, langFromCode } from "../tgcloud/lib/i18n.js";

const params = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("i18n бота", () => {
  it("en покрывает все ключи ru и те же параметры", () => {
    const { ru, en } = dictionaries;
    const missing = Object.keys(ru).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    const extra = Object.keys(en).filter((k) => !(k in ru));
    expect(extra).toEqual([]);
    const mismatched = Object.keys(ru).filter((k) => JSON.stringify(params(ru[k])) !== JSON.stringify(params(en[k])));
    expect(mismatched).toEqual([]);
  });

  it("формы слов и подстановки", () => {
    expect([1, 2, 5, 21].map((n) => pluralForm(n, "файл|файла|файлов", "ru"))).toEqual(["файл", "файла", "файлов", "файл"]);
    expect([1, 2, 21].map((n) => pluralForm(n, "file|files", "en"))).toEqual(["file", "files", "files"]);
    expect(t("xx", "common.contact")).toBe(t("ru", "common.contact"));
    expect(t("ru", "нет.такого")).toBe("нет.такого");
  });

  it("язык по language_code", () => {
    expect(["ru", "uk", "be", "kk", "ru-RU"].map(langFromCode)).toEqual(["ru", "ru", "ru", "ru", "ru"]);
    expect(["en", "de", "", undefined, "kz"].map(langFromCode)).toEqual(["en", "en", "en", "en", "en"]);
  });
});
