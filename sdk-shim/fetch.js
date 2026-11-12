// Локальная замена sdk/fetch: обычный fetch + хелперы тела, как на платформе.

/** @type {typeof globalThis.fetch & { body: { json(v: unknown): any, form(v: Record<string, string>): any, text(v: string): any } }} */
export const fetch = /** @type {any} */ (Object.assign(
  (/** @type {any} */ input, /** @type {any} */ init = {}) => {
    const body = init.body;
    if (body && typeof body === "object" && "__sdkBody" in body) {
      return globalThis.fetch(input, { ...init, body: body.value, headers: { "Content-Type": body.type, ...(init.headers ?? {}) } });
    }
    return globalThis.fetch(input, init);
  },
  {
    body: {
      json: (/** @type {unknown} */ v) => ({ __sdkBody: true, type: "application/json", value: JSON.stringify(v) }),
      form: (/** @type {Record<string, string>} */ v) => ({ __sdkBody: true, type: "application/x-www-form-urlencoded", value: new URLSearchParams(v).toString() }),
      text: (/** @type {string} */ v) => ({ __sdkBody: true, type: "text/plain", value: v }),
    },
  },
));

export const FormData = globalThis.FormData;

export default fetch;
