import './preflight.js'; // first: Node version check, before ink and friends load
import { parseArgs } from 'node:util';
import fsp from 'node:fs/promises';
import { render } from 'ink';
import { App } from './app/App.js';
import { Runtime } from './app/runtime.js';
import { APP_NAME, BROWSER_PROFILE_DIR, CMD, DEFAULT_MAX_MINUTES, VERSION } from './config.js';
import { clearSession } from './core/auth.js';

const USAGE = `${APP_NAME} v${VERSION} — official SoundCloud free downloads only

  ${CMD}                       scan a curator's followings, then download
  ${CMD} logout                forget the saved SoundCloud session
  ${CMD} --max-minutes <n>     skip tracks longer than n minutes (default ${DEFAULT_MAX_MINUTES})
  ${CMD} --help | --version
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'max-minutes': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.version) {
  console.log(VERSION);
  process.exit(0);
}
if (positionals[0] === 'logout') {
  const removed = await clearSession();
  await fsp.rm(BROWSER_PROFILE_DIR, { recursive: true, force: true });
  console.log(removed ? 'Logged out: session removed.' : 'No saved session.');
  process.exit(0);
}
if (positionals.length) {
  console.error(`Unknown command "${positionals[0]}".\n\n${USAGE}`);
  process.exit(2);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error(`${CMD} is interactive: run it from a terminal.`);
  process.exit(2);
}

const maxMinutes = Number(values['max-minutes'] ?? process.env.CRATE_MAX_MINUTES ?? DEFAULT_MAX_MINUTES);
if (!(maxMinutes > 0)) {
  console.error('--max-minutes must be a positive number.');
  process.exit(2);
}

const runtime = new Runtime(maxMinutes);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => runtime.abort.abort());

let exitCode = 0;
const { waitUntilExit } = render(<App runtime={runtime} onExit={(code) => (exitCode = code)} />, { exitOnCtrlC: false });
await waitUntilExit();
await runtime.shutdown();
process.exit(exitCode);
