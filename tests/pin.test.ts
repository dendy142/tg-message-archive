import { describe, it, expect } from "vitest";
import { useFreshDb, wrap } from "./helpers.js";
import { sha256, toHex, hashPin, checkPin } from "../tgcloud/lib/util.js";
import pin, { lockFor } from "../tgcloud/endpoints/pin.js";
import settings from "../tgcloud/endpoints/settings.js";
import callbackQuery from "../tgcloud/handlers/callback_query.js";
import { ensureSettings, updateSettings } from "../tgcloud/lib/repo/state.js";

const ctx = { initData: { user: { id: 999 } } };
const enc = (s: string) => new TextEncoder().encode(s);

describe("хеш", () => {
  it("SHA-256 по эталонным векторам", () => {
    expect(toHex(sha256(enc("")))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(toHex(sha256(enc("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(toHex(sha256(enc("a".repeat(1000))))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
  it("PIN: соль меняет хеш, проверка", () => {
    const h = hashPin("1234", "s1", 100);
    expect(h).not.toBe(hashPin("1234", "s2", 100));
    expect(checkPin("1234", "s1", h)).toBe(true);
    expect(checkPin("1235", "s1", h)).toBe(false);
  });
});

describe("endpoint pin", () => {
  useFreshDb();

  it("задать, проверить, сменить только с текущим, снять", async () => {
    expect((await pin({ set: true, pin: "1234" }, ctx)).settings).toMatchObject({ lockMode: "pin", hasPin: true, lockEnabled: true });
    expect((await pin({ verify: true, pin: "1234" }, ctx)).ok).toBe(true);
    await expect(pin({ set: true, pin: "5555", current: "0000" }, ctx)).rejects.toMatchObject({ parameters: { code: "WRONG_PIN" } });
    await pin({ set: true, pin: "5555", current: "1234" }, ctx);
    await expect(settings({ lockMode: "off" }, ctx)).rejects.toMatchObject({ parameters: { code: "PIN_SET" } });
    expect((await pin({ clear: true, pin: "5555", mode: "off" }, ctx)).settings).toMatchObject({ lockMode: "off", hasPin: false });
    await expect(pin({ set: true, pin: "12" }, ctx)).rejects.toMatchObject({ parameters: { code: "BAD_PIN" } });
  });

  it("после 5 неудач — пауза, удваивается; успех сбрасывает", async () => {
    await pin({ set: true, pin: "1234" }, ctx);
    for (let i = 0; i < 4; i++) expect((await pin({ verify: true, pin: "0000" }, ctx)).left).toBe(4 - i);
    const fifth = await pin({ verify: true, pin: "0000" }, ctx);
    expect(fifth.lockedUntilMs).toBeGreaterThan(Date.now());
    expect((await pin({ verify: true, pin: "1234" }, ctx)).ok).toBe(false);
    expect(lockFor(5)).toBe(60_000);
    expect(lockFor(6)).toBe(120_000);
    expect(lockFor(20)).toBe(30 * 60_000);
    await updateSettings(999, { pinLockedUntil: null });
    expect((await pin({ verify: true, pin: "1234" }, ctx)).ok).toBe(true);
    expect((await ensureSettings(999)).pinFailed).toBe(0);
  });

  it("/pin_reset → кнопка сбрасывает PIN", async () => {
    await pin({ set: true, pin: "1234" }, ctx);
    await callbackQuery({ id: "q", from: { id: 999 }, data: "pin:reset", message: { chat: { id: 999 }, message_id: 1 } }, wrap("callback_query", {}));
    const s = await ensureSettings(999);
    expect(s.pinHash).toBeNull();
    expect(s.lockMode).toBe("biometric");
  });
});
