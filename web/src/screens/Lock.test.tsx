import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Lock } from './Lock';
import { serverless } from '../test/tg';

const type = (pin: string) => { for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d })); };

describe('Lock (PIN)', () => {
  it('неверный, затем верный PIN', async () => {
    serverless.handler = (_n, input) => ((input as { pin: string }).pin === '1234' ? { ok: true } : { ok: false, left: 3 });
    const onUnlock = vi.fn();
    render(<Lock mode="pin" onUnlock={onUnlock} />);
    type('0000');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Неверный PIN. Осталось 3 попытки')).toBeTruthy();
    expect(onUnlock).not.toHaveBeenCalled();
    await screen.findByLabelText('Введено цифр: 0');
    type('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(serverless.calls).toHaveLength(2));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(serverless.calls.map((c) => c.input)).toEqual([{ verify: true, pin: '0000' }, { verify: true, pin: '1234' }]);
  });

  it('после блокировки — обратный отсчёт вместо клавиатуры', async () => {
    serverless.handler = () => ({ ok: false, left: 0, lockedUntilMs: Date.now() + 60_000 });
    render(<Lock mode="pin" onUnlock={() => {}} />);
    type('9999');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/Слишком много попыток/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
  });
});
