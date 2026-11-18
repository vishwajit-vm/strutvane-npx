/**
 * Running the project's script as a child process, and passing its result back.
 *
 * - **No shell, ever.** The program is the running Node (`process.execPath`) and the arguments go
 *   in an array, so `a&b`, `$(x)`, `; rm -rf ~` or `%PATH%` reach `strut.js` as plain text on
 *   every platform. Arguments come after the script path, so `--import=x.mjs` or `--require x`
 *   are the script's arguments, never Node options.
 * - **Exit codes** come back unchanged. When the child is killed by a signal, the caller re-raises
 *   that signal on itself (see `bin.ts`), so a parent shell or CI sees what really happened;
 *   where that is not possible (Windows) the exit code is the shell convention 128 + signal.
 * - **Signals** sent to this process are forwarded to the child, so `kill <pid>` or a supervisor
 *   stopping the guard stops the command too, and the guard never exits before the child: see
 *   {@link shouldForward} for which ones and why.
 *
 * @module
 */
import { spawn } from 'node:child_process'
import { constants } from 'node:os'

/** Signals the guard listens for while a child runs. */
export const HANDLED_SIGNALS: readonly NodeJS.Signals[] = Object.freeze([
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGBREAK',
])

/**
 * Whether a signal received by the guard is passed on to the child.
 *
 * - **Windows: never.** A console Ctrl+C or Ctrl+Break already reaches every process attached to
 *   the console, the child included, and "sending" a signal to a Windows process terminates it
 *   outright, which would deny `strut.js` its own clean-up. The guard only keeps a listener so it
 *   is not the one to die first.
 * - **Ctrl+C at a terminal (POSIX, `SIGINT` with stdin a TTY): not forwarded.** The terminal
 *   sends it to the whole foreground process group, so the child already has it; a second copy
 *   can turn "stop gracefully" into "force quit" in commands that count presses (a dev server).
 * - **Everything else is forwarded** (`SIGTERM`, `SIGHUP`, and `SIGINT` without a terminal, e.g.
 *   from a supervisor or `kill -INT`), since only the guard received it.
 *
 * @example
 * shouldForward('SIGTERM', 'linux', true) // true
 * shouldForward('SIGINT', 'linux', true) // false
 */
export function shouldForward(
  signal: NodeJS.Signals,
  platform: NodeJS.Platform,
  stdinIsTTY: boolean,
): boolean {
  if (platform === 'win32') return false
  if (signal === 'SIGINT' && stdinIsTTY) return false
  return true
}

/** The exit code that stands for death by `signal` (128 + its number; 1 when unknown). */
export function signalExitCode(signal: NodeJS.Signals): number {
  const number = constants.signals[signal]
  return typeof number === 'number' ? 128 + number : 1
}

/** How a child process ended. */
export type ChildOutcome =
  | { readonly kind: 'exit'; readonly code: number }
  | { readonly kind: 'signal'; readonly signal: NodeJS.Signals }
  | { readonly kind: 'error'; readonly message: string }

/** Where signals come from (the real `process`, or a test's event emitter). */
export interface SignalSource {
  on(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
  off(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown
}

/** What {@link runChild} needs to start the child. */
export interface ChildRequest {
  /** The Node executable (normally `process.execPath`). */
  readonly execPath: string
  /** The script to run (a real path, checked by `target.ts`). */
  readonly script: string
  /** The user's arguments, passed through exactly. */
  readonly args: readonly string[]
  /** The child's working directory (the project root). */
  readonly cwd: string
  /** The child's environment. */
  readonly env: NodeJS.ProcessEnv
  /** The platform, for {@link shouldForward}. */
  readonly platform: NodeJS.Platform
  /** Whether stdin is a terminal, for {@link shouldForward}. */
  readonly stdinIsTTY: boolean
  /** Where signals arrive (default: `process`). */
  readonly signals?: SignalSource
  /** The child's stdio (default `inherit`: the child talks to the user's terminal directly). */
  readonly stdio?: 'inherit' | 'pipe' | 'ignore'
}

/** Starts the child and resolves with how it ended. Injectable so tests can stand in. */
export type ChildRunner = (request: ChildRequest) => Promise<ChildOutcome>

/**
 * Run `node <script> <args...>` with no shell, forward signals while it runs, and resolve with
 * how it ended. Never rejects: a child that cannot start resolves as `{ kind: 'error' }`.
 *
 * @example
 * await runChild({ execPath: process.execPath, script: '/srv/blog/strut.js', args: ['migrate'], ... })
 * // { kind: 'exit', code: 0 }
 */
export const runChild: ChildRunner = (request) =>
  new Promise((resolvePromise) => {
    const signals = request.signals ?? process
    let settled = false
    const child = spawn(request.execPath, [request.script, ...request.args], {
      cwd: request.cwd,
      env: request.env,
      stdio: request.stdio ?? 'inherit',
      shell: false,
      windowsHide: true,
    })
    const onSignal = (signal: NodeJS.Signals): void => {
      if (child.exitCode !== null || child.signalCode !== null) return
      if (shouldForward(signal, request.platform, request.stdinIsTTY)) child.kill(signal)
    }
    for (const signal of HANDLED_SIGNALS) signals.on(signal, onSignal)
    const finish = (outcome: ChildOutcome): void => {
      if (settled) return
      settled = true
      for (const signal of HANDLED_SIGNALS) signals.off(signal, onSignal)
      resolvePromise(outcome)
    }
    child.once('error', (error) => finish({ kind: 'error', message: error.message }))
    child.once('exit', (code, signal) => {
      if (signal !== null) finish({ kind: 'signal', signal })
      else finish({ kind: 'exit', code: code ?? 1 })
    })
  })
