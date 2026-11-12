// prebuild: пишет tgcloud/lib/version.js; локально только сверяет VERSION с package.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const target = new URL('../tgcloud/lib/version.js', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = process.env.GITHUB_SHA?.slice(0, 7);

const prev = existsSync(target) ? readFileSync(target, 'utf8') : '';
const keep = (name, fallback) => prev.match(new RegExp(`export const ${name} = (.+);`))?.[1] ?? fallback;
const commit = sha ? JSON.stringify(sha) : keep('COMMIT', '"dev"');
const builtAt = sha ? JSON.stringify(new Date().toISOString()) : keep('BUILT_AT', 'null');

const text = `// lib/version.js — версия сборки. Генерирует scripts/write-version.mjs (prebuild); не править.
export const VERSION = ${JSON.stringify(version)};
export const COMMIT = ${commit};
export const BUILT_AT = ${builtAt};
`;
if (text !== prev) writeFileSync(target, text);
console.log(`version ${version} (${JSON.parse(commit)})`);
