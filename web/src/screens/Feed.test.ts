import { describe, it, expect, beforeAll } from 'vitest';
import { groupFeed } from './Feed';
import { setTimezone } from '../util';
import type { EventView } from '../types';

const T = Date.UTC(2026, 9, 21, 9);
const ev = (id: number, eventAt: number) => ({ id, eventAt, date: eventAt }) as unknown as EventView;

beforeAll(() => setTimezone('UTC'));

describe('groupFeed', () => {
  it('разделитель перед первым просмотренным, один раз', () => {
    const items = [ev(1, T + 3000), ev(2, T + 2000), ev(3, T + 1000), ev(4, T)];
    const g = groupFeed(items, 'events', T + 1500);
    expect(g.map((x) => [x.sep, x.items.map((e) => e.id)])).toEqual([[false, [1, 2]], [true, [3, 4]]]);
  });
  it('всё новое или всё просмотренное — без разделителя', () => {
    const items = [ev(1, T + 2000), ev(2, T + 1000)];
    expect(groupFeed(items, 'events', T).some((x) => x.sep)).toBe(false);
    expect(groupFeed(items, 'events', T + 5000).some((x) => x.sep)).toBe(false);
    expect(groupFeed(items, 'events', 0).some((x) => x.sep)).toBe(false);
  });
  it('в других лентах разделителя нет; группы по дням', () => {
    const items = [ev(1, T), ev(2, T - 86_400_000)];
    const g = groupFeed(items, 'deleted', T - 1);
    expect(g.map((x) => [x.key, x.sep])).toEqual([['2026-10-21', false], ['2026-10-20', false]]);
  });
});
