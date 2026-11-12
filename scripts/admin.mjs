// Команды оператора из консоли и CI: npm run admin -- '<json>' (список — в tgcloud/lib/admin.js).
// `tgcloud run` не запускает модули lib/, поэтому на время вызова создаётся вход endpoints/adminRun.js;
// он принимает только одноразовый ключ из --ctx и удаляется после запуска.
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../tgcloud/endpoints/adminRun.js', import.meta.url));
const CLI = fileURLToPath(new URL('../node_modules/@tgcloud/cli/bin/tgcloud.js', import.meta.url));

const args = process.argv[2] ?? '{}';
const key = randomBytes(24).toString('hex');

writeFileSync(ENTRY, `// Временный вход scripts/admin.mjs для \`tgcloud run\`. Не коммитить и не выкладывать.
import { runFromCli } from '../lib/admin.js';

export default (input, ctx) => runFromCli(input, ctx, '${key}');
`);

// Ctrl+C достаётся и tgcloud; сами дожидаемся его выхода и убираем вход.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {});

let code;
try {
  const r = spawnSync(process.execPath, [CLI, 'run', 'endpoints/adminRun', args, '--ctx', JSON.stringify({ adminKey: key })], { stdio: 'inherit' });
  if (r.error) console.error(r.error);
  code = r.status ?? 1;
} finally {
  rmSync(ENTRY, { force: true });
}
process.exit(code);
