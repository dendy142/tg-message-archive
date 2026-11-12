import { beforeEach, afterEach } from "vitest";
import { makeTestDb } from "../sdk-shim/testdb.js";
import { apiMock } from "../sdk-shim/api.js";

export function useFreshDb() {
  beforeEach(async () => { await makeTestDb(); apiMock.reset(); });
  afterEach(() => { apiMock.reset(); });
}

let seq = 100;
export function bizMessage(over: Record<string, any> = {}) {
  const id = over.message_id ?? seq++;
  return {
    business_connection_id: "bc1",
    message_id: id,
    date: Math.floor((over.date ?? Date.now()) / 1000),
    chat: { id: 555, type: "private", first_name: "Иван", last_name: "П" },
    from: { id: 555, first_name: "Иван", last_name: "П" },
    text: "привет",
    ...over,
  };
}

export function wrap(kind: string, payload: any, updateId = seq++) {
  return { update: { update_id: updateId, [kind]: payload } };
}
