import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { highlight } from './EventRow';
import { Diff } from './Diff';
import { isOpaqueScriptError } from './ErrorBoundary';

describe('highlight', () => {
  it('без учёта регистра и ё/е, спецсимволы запроса не ломают регэксп', () => {
    const { container } = render(<p>{highlight('Ёлка, ЕЛКА и (ёж)', ['елка', '(ёж'])}</p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Ёлка', 'ЕЛКА', '(ёж']);
  });
  it('пустой запрос — текст как есть', () => {
    expect(highlight('текст', [' '])).toBe('текст');
  });
});

describe('Diff', () => {
  it('удалённое — del, добавленное — ins, общее — span', () => {
    const { container } = render(<Diff parts={[{ op: 'eq', text: 'Привет ' }, { op: 'del', text: 'мир' }, { op: 'ins', text: 'всем' }]} />);
    expect(container.querySelector('del')?.textContent).toBe('мир');
    expect(container.querySelector('ins')?.textContent).toBe('всем');
    expect(container.textContent).toBe('Привет мирвсем');
  });
  it('пустой дифф', () => {
    const { container } = render(<Diff parts={[]} />);
    expect(container.textContent).toBe('пусто');
  });
});

describe("isOpaqueScriptError", () => {
  it("«Script error.» без объекта ошибки — чужой скрипт, не отчитываемся; настоящие ошибки — да", () => {
    expect(isOpaqueScriptError({ error: null, message: "Script error." })).toBe(true);
    expect(isOpaqueScriptError({ message: "Script error" })).toBe(true);
    expect(isOpaqueScriptError({ error: new Error("x"), message: "Script error." })).toBe(false);
    expect(isOpaqueScriptError({ error: null, message: "Uncaught TypeError: a is undefined" })).toBe(false);
  });
});
