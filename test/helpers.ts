/**
 * Throwaway projects for the tests: a temp folder with a package.json, a stand-in `strut.js` and,
 * optionally, a stand-in `@strutvane/framework`. Nothing here touches the network.
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoundaryFacts } from '../src/boundary.ts'

/** The guard's entry point, run by Node's type stripping in the end-to-end tests. */
export const BIN: string = fileURLToPath(new URL('../src/bin.ts', import.meta.url))

/**
 * The stand-in for a project's `strut.js` (and for the framework's bin). It reports what it got
 * (arguments, working directory, its own path, the guard's environment markers) as JSON, to the
 * file named by STRUT_TEST_OUT or to stdout, then:
 * - `exit <n>`: exits with n;
 * - `signal <name>`: kills itself with that signal;
 * - `wait`: writes `<out>.ready` and waits (up to 20 s) for `<out>.release` to appear, then exits 0;
 *   with STRUT_TEST_OUT unset it prints `ready` and waits for a signal.
 */
export const REPORTER: string = `import { existsSync, writeFileSync } from 'node:fs'
const [mode, value] = process.argv.slice(2)
const report = JSON.stringify({
  label: LABEL,
  args: process.argv.slice(2),
  cwd: process.cwd(),
  script: import.meta.filename,
  depth: process.env.STRUTVANE_NPX_DEPTH ?? null,
  noDefault: process.env.NoDefaultCurrentDirectoryInExePath ?? null,
})
const out = process.env.STRUT_TEST_OUT
if (out) writeFileSync(out, report)
else if (mode !== 'wait') process.stdout.write(report)
if (mode === 'exit') process.exit(Number(value))
if (mode === 'signal') process.kill(process.pid, value)
if (mode === 'wait') {
  if (out) writeFileSync(out + '.ready', 'ready')
  else process.stdout.write('ready\\n')
  const started = Date.now()
  const timer = setInterval(() => {
    if ((out && existsSync(out + '.release')) || Date.now() - started > 20000) {
      clearInterval(timer)
      process.exit(0)
    }
  }, 25)
}
`

/** What the reporter wrote. */
export interface Report {
  readonly label: string
  readonly args: string[]
  readonly cwd: string
  readonly script: string
  readonly depth: string | null
  readonly noDefault: string | null
}

/** A reporter script labelled `label`. */
export function reporter(label: string): string {
  return REPORTER.replace('LABEL', JSON.stringify(label))
}

/** A fresh temp folder with links resolved (so paths compare equal to what the guard sees). */
export function tempDir(prefix = 'strutvane-npx-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
}

/** Remove a temp folder (best effort; Windows may hold a file briefly). */
export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

/** Write a file, creating its folders. */
export function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A package.json that makes `dir` a Strutvane project. */
export function projectManifest(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'demo-app',
    private: true,
    type: 'module',
    dependencies: { '@strutvane/framework': '^0.2.0-next.0' },
    ...extra,
  })
}

/** Make `dir` a project: package.json, and (unless `strut: false`) a reporter `strut.js`. */
export function makeProject(dir: string, options: { strut?: boolean } = {}): string {
  write(join(dir, 'package.json'), projectManifest())
  if (options.strut !== false) write(join(dir, 'strut.js'), reporter('strut.js'))
  return dir
}

/** Install a stand-in `@strutvane/framework` under `dir/node_modules` (or at `at`). */
export function installFramework(
  dir: string,
  manifest: Record<string, unknown> = {},
  at: string = join(dir, 'node_modules', '@strutvane', 'framework'),
): string {
  write(
    join(at, 'package.json'),
    JSON.stringify({
      name: '@strutvane/framework',
      version: '0.2.0-next.0',
      type: 'module',
      bin: { strutvane: 'dist/console/bin.mjs', 'strutvane-cli': 'dist/console/bin.mjs' },
      ...manifest,
    }),
  )
  write(join(at, 'dist', 'console', 'bin.mjs'), reporter('framework'))
  return at
}

/** Read the reporter's output file. */
export function readReport(path: string): Report {
  return JSON.parse(readFileSync(path, 'utf8')) as Report
}

/** Boundary facts that keep every search inside `base`: home is `base`, temp is elsewhere. */
export function factsFor(base: string, uid?: number): BoundaryFacts {
  return { home: base, temp: join(base, '..', 'not-the-temp-dir'), uid }
}

/**
 * Create a directory link. Junctions on Windows (no admin rights needed), symlinks elsewhere.
 */
export function linkDir(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Create a file symlink, or return `false` when the OS refuses (Windows without Developer Mode
 * or admin rights), so the test can skip itself with the reason.
 */
export function tryLinkFile(target: string, path: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(target, path, 'file')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false
    throw error
  }
}

/** Wait until `path` exists (polling), or fail after `ms`. */
export async function waitForFile(path: string, ms = 15_000): Promise<void> {
  const until = Date.now() + ms
  while (!existsSync(path)) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${path}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Run the guard's bin with Node (type stripping), synchronously. */
export function runBin(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['STRUTVANE_NPX_DEPTH']
  Object.assign(env, options.env)
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    timeout: 25_000,
    windowsHide: true,
  })
}
