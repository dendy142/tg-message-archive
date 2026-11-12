import { describe, it, expect, beforeEach } from "vitest";
import { useFreshDb, bizMessage } from "./helpers.js";
import { apiMock, BotApiError } from "../sdk-shim/api.js";
import { onNewMessage, onConnection } from "../tgcloud/lib/events.js";
import { refreshAvatar } from "../tgcloud/lib/links.js";
import { getMeta } from "../tgcloud/lib/repo/state.js";
import contact from "../tgcloud/endpoints/contact.js";
import fileEp from "../tgcloud/endpoints/file.js";

const ctx = { initData: { user: { id: 999 } } };
const DAY = 86_400_000;

describe("фото собеседника", () => {
  useFreshDb();
  beforeEach(async () => {
    await onConnection({ id: "bc1", user_chat_id: 999, is_enabled: true, rights: {} });
    await onNewMessage(bizMessage({ message_id: 1, from: { id: 555, first_name: "Иван", username: "ivan" } }), "bc1");
  });

  it("профиль: фото, @username и его история; файл фото отдаётся", async () => {
    apiMock.on("getUserProfilePhotos", () => ({ total_count: 1, photos: [[{ file_id: "s", width: 80, height: 80 }, { file_id: "m", width: 320, height: 320 }]] }));
    const c = await contact({ chatId: 555 }, ctx);
    expect(c).toMatchObject({ hasPhoto: true, username: "ivan", usernames: ["ivan"] });
    const f = await fileEp({ kind: "avatar", chatId: 555 }, ctx);
    expect(f.mime).toBe("image/jpeg");
    expect(apiMock.callsOf("getFileContent")[0]).toBe("m");
  });

  it("не чаще раза в сутки; после серии отказов больше не спрашиваем", async () => {
    apiMock.on("getUserProfilePhotos", () => { throw new BotApiError("getUserProfilePhotos", 400, "Bad Request: user not found"); });
    const t = Date.now();
    await refreshAvatar(999, 555, t);
    await refreshAvatar(999, 555, t + 1000);
    expect(apiMock.callsOf("getUserProfilePhotos")).toHaveLength(1);
    for (let i = 1; i <= 5; i++) await refreshAvatar(999, 555, t + i * 2 * DAY);
    expect(await getMeta("cap_profile_photos")).toBe("false");
    const calls = apiMock.callsOf("getUserProfilePhotos").length;
    await refreshAvatar(999, 555, t + 30 * DAY);
    expect(apiMock.callsOf("getUserProfilePhotos")).toHaveLength(calls);
  });
});
