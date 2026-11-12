import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PinPad } from './PinPad';

describe('PinPad', () => {
  it('resetKey очищает ввод', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<PinPad onSubmit={onSubmit} resetKey={0} />);
    for (const d of '00') fireEvent.click(screen.getByRole('button', { name: d }));
    expect(screen.getByLabelText('Введено цифр: 2')).toBeTruthy();
    rerender(<PinPad onSubmit={onSubmit} resetKey={1} />);
    expect(screen.getByLabelText('Введено цифр: 0')).toBeTruthy();
  });

  it('на 6-й цифре отправляет сам, «Готово» недоступно до 4 цифр', () => {
    const onSubmit = vi.fn();
    render(<PinPad onSubmit={onSubmit} />);
    expect((screen.getByRole('button', { name: 'Готово' }) as HTMLButtonElement).disabled).toBe(true);
    for (const d of '123456') fireEvent.click(screen.getByRole('button', { name: d }));
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });
});
