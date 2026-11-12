import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTimezone, fmtSmart, fmtDay, fmtDateTime, fmtSpan, fmtSize, fmtDuration, plural, dayKey } from './util';

const NOW = Date.UTC(2026, 9, 21, 12, 0);
const H = 3_600_000, D = 24 * H;

describe('даты в поясе пользователя', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); setTimezone('Europe/Moscow'); });
  afterEach(() => vi.useRealTimers());

  it('fmtSmart: время, «вчера», день недели, дата, дата с годом', () => {
    expect(fmtSmart(NOW - H)).toBe('14:00');
    expect(fmtSmart(NOW - D)).toBe('вчера');
    expect(fmtSmart(NOW - 3 * D)).toBe('вс');
    expect(fmtSmart(NOW - 30 * D)).toBe('21 сент');
    expect(fmtSmart(Date.UTC(2025, 9, 20, 12))).toBe('20.10.25');
    expect(fmtSmart(null)).toBe('');
  });

  it('fmtDay и fmtDateTime', () => {
    expect(fmtDay(NOW)).toBe('Сегодня');
    expect(fmtDay(NOW - D)).toBe('Вчера');
    expect(fmtDay(NOW - 2 * D)).toBe('Понедельник, 19 октября');
    expect(fmtDay(NOW - 30 * D)).toBe('21 сентября');
    expect(fmtDay(Date.UTC(2025, 9, 20, 12))).toBe('20 октября 2025');
    expect(fmtDateTime(NOW - D)).toBe('вчера в 15:00');
  });

  it('день считается в поясе пользователя, а не устройства', () => {
    const lateUtc = Date.UTC(2026, 9, 20, 22, 30);
    expect(dayKey(lateUtc)).toBe('2026-10-21');
    setTimezone('UTC');
    expect(dayKey(lateUtc)).toBe('2026-10-20');
  });
});

describe('числа и промежутки', () => {
  it('fmtSpan', () => {
    expect(fmtSpan(8_000)).toBe('8 сек');
    expect(fmtSpan(4 * 60_000)).toBe('4 мин');
    expect(fmtSpan(80 * 60_000)).toBe('1 ч 20 мин');
    expect(fmtSpan(2 * H)).toBe('2 ч');
    expect(fmtSpan(26 * H)).toBe('1 дн 2 ч');
    expect(fmtSpan(8 * D + H)).toBe('8 дн');
    expect(fmtSpan(null)).toBe('—');
  });

  it('plural', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, 'w.file'))).toEqual(['файл', 'файла', 'файлов', 'файлов', 'файл', 'файла', 'файлов', 'файлов']);
  });

  it('fmtSize и fmtDuration', () => {
    expect(fmtSize(500)).toBe('500 Б');
    expect(fmtSize(2048)).toBe('2 КБ');
    expect(fmtSize(1.5 * 1024 * 1024)).toBe('1,5 МБ');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(3725)).toBe('1:02:05');
  });
});
