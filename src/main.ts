/**
 * `npx strutvane <args>`: the whole decision, with every process fact injected so it can be
 * tested without touching the real process.
 *
 * 1. Node older than {@link MIN_NODE}: say so, exit 1.
 * 2. Started again by the command it started (`STRUTVANE_NPX_DEPTH`): stop, exit 1, no loop.
 * 3. Find the project (`project.ts`) and what to run in it (`target.ts`).
 *    - Found and trusted: run it with the user's arguments exactly as typed, and hand back its
 *      exit code or signal. Every argument goes to the project, `--version` and `help` included,
 *      because that is what `node strut` does.
 *    - Found but untrusted or refused: say why and how to fix it, exit 1. Nothing runs.
 *    - Not found: `help` / `--help` / no command prints help (exit 0), `--version` prints this
 *      package's version (exit 0), `new` / `create` / `init` prints the installer command, and
 *      anything else explains that it needs a project. Those last two exit 2: nothing was done.
 *
 * Nothing is ever installed or downloaded; outside a project the guard only prints.
 *
 * @module
 */
import { type BoundaryFacts, processBoundary } from './boundary.ts'
import { type ChildRunner, runChild, signalExitCode } from './child.ts'
import {
  CREATE_WORDS,
  createText,
  helpText,
  loopText,
  nodeTooOldText,
  noProjectText,
  refusalText,
  startFailedText,
  untrustedText,
  versionText,
} from './messages.ts'
import { findProject } from './project.ts'
import { resolveTarget } from './target.ts'
import { isNodeSupported, MIN_NODE } from './version.ts'

/** Exit codes of the guard itself (the project's own codes pass through unchanged). */
export const EXIT: Readonly<{ OK: 0; FAILURE: 1; USAGE: 2 }> = Object.freeze({
  OK: 0,
  /** Refused to run (untrusted folder, link, missing or invalid framework, loop, old Node). */
  FAILURE: 1,
  /** Outside a project: the command needs one (or is `new`), so nothing was done. */
  USAGE: 2,
})

/** Counts how deep `npx strutvane` is nested inside itself (guards against loops). */
export const DEPTH_ENV = 'STRUTVANE_NPX_DEPTH'

/** How the guard should end. */
export type Outcome =
  | { readonly exitCode: number }
  /** The child died of `signal`: re-raise it (or exit with `exitCode` where that is impossible). */
  | { readonly signal: NodeJS.Signals; readonly exitCode: number }

/** Process facts the guard needs (injectable for tests). */
export interface GuardEnvironment {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly execPath: string
  readonly platform: NodeJS.Platform
  /** `process.versions.node`. */
  readonly nodeVersion: string
  /** This package's version. */
  readonly version: string
  readonly stdinIsTTY: boolean
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** Project boundary facts. Default: this process's. */
  readonly boundary?: BoundaryFacts
  /** Starts the child. Default: {@link runChild}. */
  readonly run?: ChildRunner
}

/** Flags that ask for this package's version outside a project. */
const VERSION_FLAGS: ReadonlySet<string> = new Set(['--version', '-v', '-V'])
/** Words and flags that ask for help outside a project. */
const HELP_WORDS: ReadonlySet<string> = new Set(['help', '--help', '-h'])

/**
 * The child's environment: the user's, plus the nesting depth and, on Windows,
 * `NoDefaultCurrentDirectoryInExePath`, so a `.cmd` the project starts through cmd.exe can't pick
 * up a program planted in the working directory before PATH.
 */
export function childEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  depth: number,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ...(platform === 'win32' ? { NoDefaultCurrentDirectoryInExePath: '1' } : {}),
    [DEPTH_ENV]: String(depth + 1),
  }
}

/** The nesting depth from the environment (anything unexpected counts as 0). */
export function depthOf(env: NodeJS.ProcessEnv): number {
  const value = env[DEPTH_ENV]
  return value !== undefined && /^\d{1,3}$/.test(value) ? Number(value) : 0
}

/**
 * Run the guard for `argv` (the arguments after `strutvane`). Never throws for expected
 * situations; returns how to end.
 *
 * @example
 * await main(['migrate'], environment) // { exitCode: 0 } after `node strut migrate` succeeded
 */
export async function main(argv: readonly string[], env: GuardEnvironment): Promise<Outcome> {
  if (!isNodeSupported(env.nodeVersion)) {
    env.stderr(nodeTooOldText(env.nodeVersion, MIN_NODE))
    return { exitCode: EXIT.FAILURE }
  }
  const depth = depthOf(env.env)
  if (depth >= 1) {
    env.stderr(loopText())
    return { exitCode: EXIT.FAILURE }
  }

  const search = findProject(env.cwd, env.boundary ?? processBoundary())
  if (search.kind === 'untrusted') {
    env.stderr(untrustedText(search.dir, search.reason))
    return { exitCode: EXIT.FAILURE }
  }
  if (search.kind === 'none') return outside(argv, search.start, env)

  const target = resolveTarget(search.root)
  if (target.kind === 'refused') {
    env.stderr(refusalText(target.reason, target.path, target.realPath))
    return { exitCode: EXIT.FAILURE }
  }

  const run = env.run ?? runChild
  const outcome = await run({
    execPath: env.execPath,
    script: target.script,
    args: argv,
    cwd: target.root,
    env: childEnvironment(env.env, env.platform, depth),
    platform: env.platform,
    stdinIsTTY: env.stdinIsTTY,
  })
  switch (outcome.kind) {
    case 'exit':
      return { exitCode: outcome.code }
    case 'signal':
      return { signal: outcome.signal, exitCode: signalExitCode(outcome.signal) }
    case 'error':
      env.stderr(startFailedText(target.script, outcome.message))
      return { exitCode: EXIT.FAILURE }
  }
}

/** Outside a project: only print (help, version, the installer command, or why not). */
function outside(argv: readonly string[], start: string, env: GuardEnvironment): Outcome {
  const [first, second] = argv
  if (first === undefined || HELP_WORDS.has(first)) {
    env.stdout(helpText(env.version, start))
    return { exitCode: EXIT.OK }
  }
  if (VERSION_FLAGS.has(first)) {
    env.stdout(versionText(env.version))
    return { exitCode: EXIT.OK }
  }
  if (CREATE_WORDS.has(first)) {
    env.stderr(createText(env.version, second))
    return { exitCode: EXIT.USAGE }
  }
  env.stderr(noProjectText(env.version, first, start))
  return { exitCode: EXIT.USAGE }
}
