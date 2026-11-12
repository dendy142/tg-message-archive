# Сторонние компоненты

Исходный код проекта распространяется по лицензии MIT — см. [LICENSE](LICENSE). Ниже — чужой
код, который попадает в репозиторий или в собранный Mini App, и его лицензии.

## В собранном Mini App

`npm run build` собирает в `dist/` приложение вместе с npm-зависимостями. Точные версии — в
`package-lock.json`, тексты лицензий — в `node_modules/<пакет>/` после `npm ci`.

| Библиотека | Лицензия | Исходники |
|------------|----------|-----------|
| `react`, `react-dom`, `scheduler` | MIT | <https://github.com/react/react> |
| `ogg-opus-decoder`, `opus-decoder`, `@wasm-audio-decoders/common` | MIT | <https://github.com/eshaz/wasm-audio-decoders> |
| `simple-yenc` | MIT | <https://github.com/eshaz/simple-yenc> |
| `@eshaz/web-worker` | Apache-2.0 | <https://github.com/eshaz/web-worker> |
| `codec-parser` | LGPL-3.0-or-later | <https://github.com/eshaz/codec-parser> |

- `opus-decoder` содержит WebAssembly-сборку [libopus](https://github.com/xiph/opus)
  (BSD-3-Clause, Xiph.Org Foundation).
- `codec-parser` (разбор контейнера Ogg для голосовых сообщений) подключён как обычная
  npm-зависимость, без изменений. Исходники Mini App и сценарий сборки открыты, поэтому
  библиотеку можно заменить своей версией и пересобрать приложение: `npm ci && npm run build`.
- `@wasm-audio-decoders/opus-ml` есть в дереве зависимостей, но в сборку не входит
  (`vite.config.ts`, `external`).

`telegram-web-app.js` приложение загружает с `telegram.org` и с собой не несёт.

## В репозитории

- `AGENTS.md` и `docs/tgcloud-sdk.md` основаны на шаблонах пакета
  [`@tgcloud/cli`](https://www.npmjs.com/package/@tgcloud/cli) — MIT, © 2026 Telegram Messenger.

Инструменты разработки (Vite, TypeScript, Vitest, Playwright, ESLint и др.) используются только
при сборке и тестах и в состав приложения не входят.
