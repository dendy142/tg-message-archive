import { describe, it, expect } from "vitest";
import { tzOffsetMinutes, ymd, midnightOf, startOfDay, isValidTimeZone, parseUserDate, periodCutoff } from "../tgcloud/lib/util.js";
import { inQuietHours, parseHm } from "../tgcloud/lib/view.js";

const iso = (d: Date | null) => d?.toISOString() ?? null;
const BERLIN = "Europe/Berlin";

describe("parseUserDate", () => {
  const now = new Date("2026-06-15T10:30:00Z");

  it("31.02 и прочие несуществующие даты — null", () => {
    for (const s of ["31.02", "30.02.2024", "29.02.2025", "31.04", "31.06.2026", "2025-02-31", "0.5", "5.0", "32.01", "1.13"]) {
      expect(parseUserDate(s, "UTC", now), s).toBeNull();
    }
  });

  it("корректные даты: ДД.ММ.ГГГГ, ДД.ММ, ISO, разделители . / -", () => {
    expect(iso(parseUserDate("31.12.2025", "UTC", now))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(parseUserDate("2025-12-31", "UTC", now))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(parseUserDate("31/12/2025", "UTC", now))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(parseUserDate("31-12-2025", "UTC", now))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(parseUserDate("5.3.2025", "UTC", now))).toBe("2025-03-05T00:00:00.000Z");
  });

  it("високосный день: 29.02.2024 существует", () => {
    expect(iso(parseUserDate("29.02.2024", "UTC", now))).toBe("2024-02-29T00:00:00.000Z");
    expect(iso(parseUserDate("29.02", "UTC", new Date("2028-03-01T00:00:00Z")))).toBe("2028-02-29T00:00:00.000Z");
  });

  it("год опущен — берётся год «сейчас» в поясе пользователя", () => {
    expect(iso(parseUserDate("01.03", "UTC", now))).toBe("2026-03-01T00:00:00.000Z");
    const nye = new Date("2026-12-31T23:30:00Z");
    expect(iso(parseUserDate("01.03", "UTC", nye))).toBe("2026-03-01T00:00:00.000Z");
    expect(iso(parseUserDate("01.03", "Asia/Tokyo", nye))).toBe("2027-02-28T15:00:00.000Z");
  });

  it("двузначный год — 20ГГ", () => {
    expect(iso(parseUserDate("31.12.25", "UTC", now))).toBe("2025-12-31T00:00:00.000Z");
    expect(iso(parseUserDate("1.1.05", "UTC", now))).toBe("2005-01-01T00:00:00.000Z");
  });

  it("результат — полночь даты в поясе пользователя, а не в UTC", () => {
    expect(iso(parseUserDate("15.06.2026", BERLIN, now))).toBe("2026-06-14T22:00:00.000Z");
    expect(iso(parseUserDate("15.01.2026", BERLIN, now))).toBe("2026-01-14T23:00:00.000Z");
    expect(iso(parseUserDate("15.06.2026", "Asia/Tashkent", now))).toBe("2026-06-14T19:00:00.000Z");
  });

  it("«сегодня» / «вчера» (и today / yesterday), регистр и пробелы не важны", () => {
    expect(iso(parseUserDate("сегодня", "UTC", now))).toBe("2026-06-15T00:00:00.000Z");
    expect(iso(parseUserDate("вчера", "UTC", now))).toBe("2026-06-14T00:00:00.000Z");
    expect(iso(parseUserDate("  Вчера ", "UTC", now))).toBe("2026-06-14T00:00:00.000Z");
    expect(iso(parseUserDate("TODAY", "UTC", now))).toBe("2026-06-15T00:00:00.000Z");
    expect(iso(parseUserDate("yesterday", "UTC", now))).toBe("2026-06-14T00:00:00.000Z");
  });

  it("«сегодня» считается по поясу: за полночь по UTC в Алматы уже следующий день", () => {
    const late = new Date("2026-06-15T20:00:00Z");
    expect(iso(parseUserDate("сегодня", "UTC", late))).toBe("2026-06-15T00:00:00.000Z");
    expect(iso(parseUserDate("сегодня", "Asia/Tashkent", late))).toBe("2026-06-15T19:00:00.000Z");
    expect(iso(parseUserDate("вчера", "Asia/Tashkent", late))).toBe("2026-06-14T19:00:00.000Z");
  });

  it("«вчера» через границу месяца и года", () => {
    expect(iso(parseUserDate("вчера", "UTC", new Date("2026-03-01T05:00:00Z")))).toBe("2026-02-28T00:00:00.000Z");
    expect(iso(parseUserDate("вчера", "UTC", new Date("2027-01-01T05:00:00Z")))).toBe("2026-12-31T00:00:00.000Z");
  });

  it("мусор, пустая строка и неподдерживаемые слова — null", () => {
    for (const s of ["", "   ", "abc", "завтра", "позавчера", "31.12.2025 12:00", "2025/12/31", "1.1.1", "31.12.202", "12345", "1.1.1969", "1.1.3000", "31..12"]) {
      expect(parseUserDate(s, "UTC", now), JSON.stringify(s)).toBeNull();
    }
  });
});

describe("midnightOf: переход на летнее время в Europe/Berlin", () => {
  it("смещения: зима +60, лето +120", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), BERLIN)).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), BERLIN)).toBe(120);
  });

  it("март 2026 (последнее воскресенье — 29-е): суббота и воскресенье в +1, понедельник уже в +2", () => {
    expect(iso(midnightOf(2026, 3, 28, BERLIN))).toBe("2026-03-27T23:00:00.000Z");
    expect(iso(midnightOf(2026, 3, 29, BERLIN))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(midnightOf(2026, 3, 30, BERLIN))).toBe("2026-03-29T22:00:00.000Z");
  });

  it("март: день перехода короче суток — 23 часа", () => {
    const len = midnightOf(2026, 3, 30, BERLIN).getTime() - midnightOf(2026, 3, 29, BERLIN).getTime();
    expect(len).toBe(23 * 3600_000);
  });

  it("октябрь 2026 (последнее воскресенье — 25-е): воскресенье в +2, понедельник в +1", () => {
    expect(iso(midnightOf(2026, 10, 24, BERLIN))).toBe("2026-10-23T22:00:00.000Z");
    expect(iso(midnightOf(2026, 10, 25, BERLIN))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(midnightOf(2026, 10, 26, BERLIN))).toBe("2026-10-25T23:00:00.000Z");
  });

  it("октябрь: день перехода длиннее суток — 25 часов", () => {
    const len = midnightOf(2026, 10, 26, BERLIN).getTime() - midnightOf(2026, 10, 25, BERLIN).getTime();
    expect(len).toBe(25 * 3600_000);
  });

  it("другие годы: 2025 (30 марта, 26 октября) и 2024 (31 марта, 27 октября)", () => {
    expect(iso(midnightOf(2025, 3, 31, BERLIN))).toBe("2025-03-30T22:00:00.000Z");
    expect(iso(midnightOf(2025, 10, 27, BERLIN))).toBe("2025-10-26T23:00:00.000Z");
    expect(iso(midnightOf(2024, 3, 31, BERLIN))).toBe("2024-03-30T23:00:00.000Z");
    expect(iso(midnightOf(2024, 4, 1, BERLIN))).toBe("2024-03-31T22:00:00.000Z");
    expect(iso(midnightOf(2024, 10, 28, BERLIN))).toBe("2024-10-27T23:00:00.000Z");
  });

  it("результат — именно локальная полночь: ymd и часы в поясе совпадают", () => {
    for (const [y, m, d] of [[2026, 3, 29], [2026, 3, 30], [2026, 10, 25], [2026, 10, 26]] as const) {
      const at = midnightOf(y, m, d, BERLIN);
      expect(ymd(at, BERLIN)).toEqual([y, m, d]);
      expect(new Intl.DateTimeFormat("en-GB", { timeZone: BERLIN, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(at)).toBe("00:00");
    }
  });

  it("переполнение дня нормализуется: 32 марта = 1 апреля, 0-е число = последний день предыдущего месяца", () => {
    expect(iso(midnightOf(2026, 3, 32, BERLIN))).toBe(iso(midnightOf(2026, 4, 1, BERLIN)));
    expect(iso(midnightOf(2026, 3, 0, BERLIN))).toBe(iso(midnightOf(2026, 2, 28, BERLIN)));
  });

  it("UTC переходов не знает: сутки всегда 24 часа", () => {
    expect(midnightOf(2026, 3, 30, "UTC").getTime() - midnightOf(2026, 3, 29, "UTC").getTime()).toBe(24 * 3600_000);
  });
});

describe("startOfDay / periodCutoff через границу DST", () => {
  it("startOfDay(daysBack) в понедельник после перехода в марте", () => {
    const now = new Date("2026-03-30T10:00:00Z");
    expect(iso(startOfDay(now, BERLIN))).toBe("2026-03-29T22:00:00.000Z");
    expect(iso(startOfDay(now, BERLIN, 1))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(startOfDay(now, BERLIN, 2))).toBe("2026-03-27T23:00:00.000Z");
  });

  it("startOfDay в октябре: «вчера» от понедельника — 25-часовое воскресенье", () => {
    const now = new Date("2026-10-26T10:00:00Z");
    expect(iso(startOfDay(now, BERLIN))).toBe("2026-10-25T23:00:00.000Z");
    expect(iso(startOfDay(now, BERLIN, 1))).toBe("2026-10-24T22:00:00.000Z");
  });

  it("момент сразу после полуночи по UTC в ночь перехода относится к правильному дню", () => {
    expect(iso(startOfDay(new Date("2026-03-29T00:30:00Z"), BERLIN))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(startOfDay(new Date("2026-03-29T01:30:00Z"), BERLIN))).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(startOfDay(new Date("2026-10-25T00:30:00Z"), BERLIN))).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(startOfDay(new Date("2026-10-25T01:30:00Z"), BERLIN))).toBe("2026-10-24T22:00:00.000Z");
  });

  it("periodCutoff: today — полночь в поясе, 7d/30d — скользящие сутки, all — null", () => {
    const now = new Date("2026-03-30T10:00:00Z");
    expect(iso(periodCutoff("today", BERLIN, now))).toBe("2026-03-29T22:00:00.000Z");
    expect(periodCutoff("7d", BERLIN, now)!.getTime()).toBe(now.getTime() - 7 * 86_400_000);
    expect(periodCutoff("30d", BERLIN, now)!.getTime()).toBe(now.getTime() - 30 * 86_400_000);
    expect(periodCutoff("all", BERLIN, now)).toBeNull();
  });

  it("isValidTimeZone", () => {
    expect(isValidTimeZone(BERLIN)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("parseHm", () => {
  it("«ЧЧ:ММ» → минуты от полуночи, мусор → null", () => {
    expect(parseHm("23:30")).toBe(23 * 60 + 30);
    expect(parseHm("7:05")).toBe(7 * 60 + 5);
    expect(parseHm("00:00")).toBe(0);
    for (const s of ["24:00", "12:60", "1230", "ab:cd", "", null, undefined, 5]) expect(parseHm(s), String(s)).toBeNull();
  });
});

describe("inQuietHours", () => {
  const at = (hhmm: string, day = "2026-06-15") => new Date(`${day}T${hhmm}:00Z`);
  const night = { from: "23:00", to: "08:00" };

  it("интервал через полночь: вечер и утро внутри, день снаружи", () => {
    expect(inQuietHours(night, "UTC", at("23:30"))).toBe(true);
    expect(inQuietHours(night, "UTC", at("00:00"))).toBe(true);
    expect(inQuietHours(night, "UTC", at("03:15"))).toBe(true);
    expect(inQuietHours(night, "UTC", at("12:00"))).toBe(false);
    expect(inQuietHours(night, "UTC", at("22:59"))).toBe(false);
  });

  it("границы: from включительно, to исключительно", () => {
    expect(inQuietHours(night, "UTC", at("23:00"))).toBe(true);
    expect(inQuietHours(night, "UTC", at("07:59"))).toBe(true);
    expect(inQuietHours(night, "UTC", at("08:00"))).toBe(false);
  });

  it("обычный интервал в пределах суток", () => {
    const day = { from: "13:00", to: "15:00" };
    expect(inQuietHours(day, "UTC", at("12:59"))).toBe(false);
    expect(inQuietHours(day, "UTC", at("13:00"))).toBe(true);
    expect(inQuietHours(day, "UTC", at("14:59"))).toBe(true);
    expect(inQuietHours(day, "UTC", at("15:00"))).toBe(false);
  });

  it("from === to, пустые и кривые настройки — тихих часов нет", () => {
    expect(inQuietHours({ from: "22:00", to: "22:00" }, "UTC", at("22:00"))).toBe(false);
    expect(inQuietHours(null, "UTC", at("03:00"))).toBe(false);
    expect(inQuietHours(undefined, "UTC", at("03:00"))).toBe(false);
    expect(inQuietHours({}, "UTC", at("03:00"))).toBe(false);
    expect(inQuietHours({ from: "23:00" }, "UTC", at("03:00"))).toBe(false);
    expect(inQuietHours({ from: "25:00", to: "08:00" }, "UTC", at("03:00"))).toBe(false);
  });

  it("учитывает пояс пользователя: 18:30 UTC — это 23:30 в Алматы (+5)", () => {
    const now = at("18:30");
    expect(inQuietHours(night, "UTC", now)).toBe(false);
    expect(inQuietHours(night, "Asia/Tashkent", now)).toBe(true);
  });

  it("пояс с летним временем: одно и то же UTC-время зимой и летом попадает по-разному", () => {
    expect(inQuietHours(night, BERLIN, at("21:30", "2026-07-01"))).toBe(true);
    expect(inQuietHours(night, BERLIN, at("21:30", "2026-01-15"))).toBe(false);
  });

  it("через переход DST в Берлине: интервал 01:00–04:00 в ночь на 29 марта", () => {
    const q = { from: "01:00", to: "04:00" };
    expect(inQuietHours(q, BERLIN, new Date("2026-03-29T00:30:00Z"))).toBe(true);
    expect(inQuietHours(q, BERLIN, new Date("2026-03-29T01:30:00Z"))).toBe(true);
    expect(inQuietHours(q, BERLIN, new Date("2026-03-29T02:30:00Z"))).toBe(false);
  });

  it("неверный пояс не роняет: считается по UTC", () => {
    expect(inQuietHours(night, "Mars/Olympus", at("23:30"))).toBe(true);
    expect(inQuietHours(night, "Mars/Olympus", at("12:00"))).toBe(false);
  });
});
