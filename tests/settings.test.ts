import { describe, it, expect } from "vitest";
import { useFreshDb } from "./helpers.js";
import settings from "../tgcloud/endpoints/settings.js";
import bootstrap from "../tgcloud/endpoints/bootstrap.js";

const ctx = { initData: { user: { id: 999 } } };

describe("настройки: источник часового пояса", () => {
  useFreshDb();

  it("новые настройки — без источника; с устройства — auto; выбор руками — manual", async () => {
    expect((await bootstrap({}, ctx)).settings.tzSource).toBeNull();
    expect((await settings({ timezone: "Europe/Moscow", tzSource: "auto" }, ctx)).settings).toMatchObject({ timezone: "Europe/Moscow", tzSource: "auto" });
    expect((await settings({ timezone: "Asia/Tashkent" }, ctx)).settings.tzSource).toBe("manual");
  });
});
