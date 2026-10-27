// Runs before dev/build/start/test. The native SQLite module is built for one Node version, and loading it
// under another one crashes the server silently, so stop early and say what to do instead.
import { readFileSync } from 'node:fs';

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const required = Number(/\d+/.exec(engines.node)[0]);
const current = Number(process.versions.node.split('.')[0]);

if (current < required) {
  console.error(`\nThis project needs Node ${required} or newer, but this terminal is running ${process.version}.`);
  console.error('Fix: run `nvm install && nvm use` (it reads .nvmrc), then try again.\n');
  process.exit(1);
}
