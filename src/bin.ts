#!/usr/bin/env node
/**
 * The `strutvane` executable (`npx strutvane <command>`). All decisions live in `main.ts`
 * (tested); this file only connects them to the real process: arguments, output, the exit code,
 * and re-raising a signal the child died of.
 *
 * It is the one file in this package allowed to print with `console` (package.json
 * `strutvane.allowConsole`).
 *
 * @module
 */
import { main } from './main.ts'
import { ownVersion } from './version.ts'

const outcome = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  execPath: process.execPath,
  platform: process.platform,
  nodeVersion: process.versions.node,
  version: ownVersion(),
  stdinIsTTY: process.stdin.isTTY === true,
  // biome-ignore lint/suspicious/noConsole: the bin entry prints help and the version to stdout
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
})

process.exitCode = outcome.exitCode
// The child was killed by a signal: die of the same signal, so the shell (or CI) that started us
// sees exactly that. Windows has no such thing; there the exit code (128 + signal) stands.
if ('signal' in outcome && process.platform !== 'win32') process.kill(process.pid, outcome.signal)
