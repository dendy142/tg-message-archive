// Локальная замена корневого sdk платформы.
export { db } from "./db.js";
export { api, BotApiError, InputFile } from "./api.js";
export { fetch, FormData } from "./fetch.js";

export class EndpointError extends Error {
  /**
   * @param {string} description
   * @param {Record<string, any>} [parameters]
   */
  constructor(description, parameters) {
    if (typeof description !== "string") throw new TypeError("EndpointError description must be a string");
    super(description);
    this.name = "EndpointError";
    this.description = description;
    this.parameters = parameters ?? {};
  }
}
