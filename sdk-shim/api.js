// Локальная замена sdk/api: вызовы Bot API пишутся в журнал и отвечают заглушкой.

export class BotApiError extends Error {
  /**
   * @param {string} method
   * @param {number} code
   * @param {string} description
   * @param {Record<string, any>} [parameters]
   */
  constructor(method, code, description, parameters) {
    super(`${method}: ${code} ${description}`);
    this.name = "BotApiError";
    this.method = method;
    this.code = code;
    this.description = description;
    this.parameters = parameters ?? {};
  }
}

export class InputFile {
  /**
   * @param {Uint8Array | ArrayBuffer} bytes
   * @param {string} filename
   * @param {{ type?: string }} [opts]
   */
  constructor(bytes, filename, opts = {}) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.filename = filename;
    this.type = opts.type;
  }
}

let nextMessageId = 1000;

function defaultResult(method, params) {
  if (method === "getMe") return { id: 42, is_bot: true, first_name: "Archive", username: "archive_test_bot" };
  if (method === "createForumTopic") return { message_thread_id: nextMessageId++, name: params.name, icon_color: 0 };
  if (method === "savePreparedKeyboardButton" || method === "savePreparedInlineMessage") return { id: `prep_${nextMessageId++}` };
  if (method === "getFileContent") return new Uint8Array([1, 2, 3]);
  if (method === "getChat") return { id: params.chat_id, type: "supergroup", is_forum: true, title: "Архив" };
  if (method === "getChatMember") return { status: "administrator", can_manage_topics: true, user: { id: params.user_id } };
  if (method === "getBusinessConnection") return null;
  if (method === "sendMediaGroup") return (params.media ?? []).map(() => ({ message_id: nextMessageId++, chat: { id: params.chat_id } }));
  if (/^(send|copy|forward)/.test(method)) return { message_id: nextMessageId++, chat: { id: params.chat_id }, date: Math.floor(Date.now() / 1000) };
  return true;
}

export const apiMock = {
  /** @type {{ method: string, params: any }[]} */
  calls: [],
  /** @type {Map<string, (params: any) => any>} */
  handlers: new Map(),
  /** @param {string} method @param {(params: any) => any} fn */
  on(method, fn) { this.handlers.set(method, fn); return this; },
  reset() { this.calls = []; this.handlers.clear(); },
  /** @param {string} method */
  callsOf(method) { return this.calls.filter((c) => c.method === method).map((c) => c.params); },
};

/** @type {Record<string, (params?: any) => Promise<any>>} */
export const api = /** @type {any} */ (new Proxy({}, {
  get(_, method) {
    if (typeof method !== "string" || method === "then") return undefined;
    return async (params = {}) => {
      apiMock.calls.push({ method, params });
      const h = apiMock.handlers.get(method);
      return h ? h(params) : defaultResult(method, params);
    };
  },
}));

export default api;
