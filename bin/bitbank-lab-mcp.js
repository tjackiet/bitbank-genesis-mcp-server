#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, '..', 'src', 'server.ts');

const require = createRequire(import.meta.url);
const tsxImportUrl = pathToFileURL(require.resolve('tsx')).href;

const child = spawn(process.execPath, ['--import', tsxImportUrl, serverPath], {
  stdio: 'inherit',
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
