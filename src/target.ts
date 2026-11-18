/**
 * What to run for a trusted project root, and the checks that keep it inside that root.
 *
 * `node strut <args>` runs the project's `strut.js`. So the guard runs that same file, with the
 * same Node, when it is there. Without a `strut.js` (a project made by hand, or one whose
 * `strut.js` was deleted) it runs what `strut.js` would run for a framework command: the
 * `strutvane` program of the project's own installed `@strutvane/framework`. Never a second copy,
 * and never anything fetched.
 *
 * Every path is checked on its **real** location (links resolved), and must stay inside the
 * project root:
 * - the root itself must not be a link (a link can make an innocent-looking folder run code from
 *   anywhere); the user is told the real folder to open instead;
 * - `strut.js` must be a regular file, not a link;
 * - `node_modules/@strutvane/framework` must really be inside the root (an `npm link` or a
 *   planted junction pointing elsewhere is refused), must be named `@strutvane/framework`, and its
 *   `bin` must be a plain relative `.js`/`.mjs`/`.cjs` path that stays inside the package.
 *
 * The file that runs is handed to Node by its real path, so what was checked is what runs.
 *
 * @module
 */
import { lstatSync, realpathSync, statSync } from 'node:fs'
import { join, posix, resolve, win32 } from 'node:path'
import { isInside } from './boundary.ts'
import { FRAMEWORK_PACKAGE, readJsonObject } from './manifest.ts'
import { STRUT_FILE } from './project.ts'

/** The name of the framework's program in its package.json `bin`. */
export const FRAMEWORK_BIN = 'strutvane'

/** Why a trusted project root still cannot be run. */
export type RefusalReason =
  /** The project root disappeared or cannot be read since it was found. */
  | 'root-unreadable'
  /** The project root is a symbolic link or junction. */
  | 'root-is-link'
  /** `strut.js` is a link, or not a regular file. */
  | 'strut-not-file'
  /** `strut.js`'s real location is outside the project root. */
  | 'strut-outside-root'
  /** No `strut.js`, and `@strutvane/framework` is not installed in the project. */
  | 'framework-missing'
  /** `node_modules/@strutvane/framework` really lives outside the project root. */
  | 'framework-outside-root'
  /** The installed package is not `@strutvane/framework`, or has no usable `strutvane` bin. */
  | 'framework-invalid'

/** The outcome of resolving what to run. */
export type Target =
  | {
      readonly kind: 'run'
      /** The project root (as found; the child's working directory). */
      readonly root: string
      /** Real path of the script Node runs. */
      readonly script: string
      /** Which of the two kinds of script it is. */
      readonly via: 'strut.js' | 'framework'
    }
  | {
      readonly kind: 'refused'
      readonly reason: RefusalReason
      /** The path the refusal is about (printed in the message). */
      readonly path: string
      /** The real location, when it helps the user (for `root-is-link`). */
      readonly realPath?: string
    }

/** Scripts the guard may hand to Node. */
const SCRIPT_EXTENSION = /\.[cm]?js$/

/**
 * Whether a package.json `bin` value is a plain relative path to a script: not empty, no NUL, not
 * absolute on any platform (`/x`, `C:\x`, `\\server\share\x`), not drive-relative (`C:x`), no `..`
 * segment, and ending in `.js`, `.mjs` or `.cjs`.
 *
 * Why so strict: the value comes from a file inside `node_modules`, and becomes a path Node runs.
 *
 * @example
 * isSafeBinPath('dist/console/bin.mjs') // true
 * isSafeBinPath('..\\..\\evil.js') // false
 */
export function isSafeBinPath(bin: string): boolean {
  if (bin === '' || bin.length > 512 || bin.includes('\0')) return false
  if (posix.isAbsolute(bin) || win32.isAbsolute(bin) || /^[A-Za-z]:/.test(bin)) return false
  if (bin.split(/[\\/]/).includes('..')) return false
  return SCRIPT_EXTENSION.test(bin)
}

/** The `strutvane` entry of a manifest's `bin` (a string `bin` counts as the package's only one). */
export function frameworkBin(manifest: Readonly<Record<string, unknown>>): string | undefined {
  const bin = manifest['bin']
  if (typeof bin === 'string') return bin
  if (typeof bin !== 'object' || bin === null || Array.isArray(bin)) return undefined
  if (!Object.hasOwn(bin, FRAMEWORK_BIN)) return undefined
  const entry = (bin as Record<string, unknown>)[FRAMEWORK_BIN]
  return typeof entry === 'string' ? entry : undefined
}

/** `lstat`, or `undefined` when the path does not exist (or cannot be read). */
function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/** The real path, or `undefined` when it cannot be resolved (missing, broken link, no access). */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    return undefined
  }
}

/**
 * Decide what to run for the trusted project root `root` (see the module documentation).
 *
 * @example
 * resolveTarget('/srv/blog') // { kind: 'run', root: '/srv/blog', script: '/srv/blog/strut.js', via: 'strut.js' }
 */
export function resolveTarget(root: string): Target {
  const rootStats = lstatOrUndefined(root)
  const realRoot = realOrUndefined(root)
  if (rootStats === undefined || realRoot === undefined) {
    return { kind: 'refused', reason: 'root-unreadable', path: root }
  }
  if (rootStats.isSymbolicLink()) {
    return { kind: 'refused', reason: 'root-is-link', path: root, realPath: realRoot }
  }

  const strut = join(root, STRUT_FILE)
  const strutStats = lstatOrUndefined(strut)
  if (strutStats !== undefined) {
    if (strutStats.isSymbolicLink() || !strutStats.isFile()) {
      return { kind: 'refused', reason: 'strut-not-file', path: strut }
    }
    const real = realOrUndefined(strut)
    if (real === undefined || !isInside(realRoot, real)) {
      return { kind: 'refused', reason: 'strut-outside-root', path: strut }
    }
    return { kind: 'run', root, script: real, via: 'strut.js' }
  }

  return frameworkTarget(root, realRoot)
}

/** The framework's own `strutvane` program, for a project without `strut.js`. */
function frameworkTarget(root: string, realRoot: string): Target {
  const dir = join(root, 'node_modules', ...FRAMEWORK_PACKAGE.split('/'))
  if (lstatOrUndefined(dir) === undefined) {
    return { kind: 'refused', reason: 'framework-missing', path: dir }
  }
  const realDir = realOrUndefined(dir)
  if (realDir === undefined || !isInside(realRoot, realDir)) {
    return { kind: 'refused', reason: 'framework-outside-root', path: dir }
  }
  const manifest = readJsonObject(join(realDir, 'package.json'))
  const bin = manifest === undefined ? undefined : frameworkBin(manifest)
  if (manifest?.['name'] !== FRAMEWORK_PACKAGE || bin === undefined || !isSafeBinPath(bin)) {
    return { kind: 'refused', reason: 'framework-invalid', path: dir }
  }
  const real = realOrUndefined(resolve(realDir, bin))
  if (real === undefined || !isInside(realDir, real) || !isRegularFile(real)) {
    return { kind: 'refused', reason: 'framework-invalid', path: dir }
  }
  return { kind: 'run', root, script: real, via: 'framework' }
}

/** Whether `path` is a regular file (following links). */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
