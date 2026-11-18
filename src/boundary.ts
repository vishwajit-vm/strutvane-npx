/**
 * Which folders may ever be treated as a Strutvane project.
 *
 * Treating a folder as the project means running code from it (`strut.js`, or the framework in
 * its `node_modules`). So, walking up from the working directory, the search stops (with no
 * project) at a folder that:
 * - is a file-system or drive root,
 * - is the OS temp directory itself,
 * - is above the user's home directory,
 * because anyone able to write there (other users, an extracted archive) could otherwise plant a
 * project that applies to every folder below it. On POSIX the project folder must also belong to
 * the current user.
 *
 * These are the same rules as `@strutvane/framework`'s `console/project/boundary.ts`. This
 * package has no dependencies (it must work before anything is installed), so the rules are
 * mirrored here rather than imported. Keep the two in step.
 *
 * @module
 */
import { realpathSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Facts the rules depend on (injectable, so tests can place "home" and "temp" anywhere). */
export interface BoundaryFacts {
  /** The user's home directory. */
  readonly home: string
  /** The OS temp directory. */
  readonly temp: string
  /** The current uid on POSIX; `undefined` where ownership is not checked (Windows). */
  readonly uid: number | undefined
}

/**
 * The boundary facts of this process.
 *
 * @example
 * isForbiddenProjectDir('/tmp', processBoundary()) // true
 */
export function processBoundary(): BoundaryFacts {
  return {
    home: homedir(),
    temp: tmpdir(),
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
  }
}

/** Every spelling of a path worth comparing: as given, and with links resolved. */
function spellings(path: string): string[] {
  const out = [resolve(path)]
  try {
    out.push(realpathSync.native(path))
  } catch {
    // A path that does not exist has only its given spelling.
  }
  return out
}

/** Path equality; case-insensitive on Windows and macOS, whose file systems usually are. */
function samePath(a: string, b: string): boolean {
  const fold = process.platform === 'win32' || process.platform === 'darwin'
  const norm = (p: string): string => (fold ? resolve(p).toLowerCase() : resolve(p))
  return norm(a) === norm(b)
}

/**
 * Whether `child` is `parent` itself or lies inside it. Both should already be real paths (links
 * resolved), or a link inside `parent` could point anywhere.
 *
 * Why not `startsWith`: `/srv/app-evil` starts with `/srv/app`. `path.relative` compares whole
 * segments, and on Windows it ignores case and reports another drive as an absolute path.
 *
 * @example
 * isInside('/srv/app', '/srv/app/strut.js') // true
 * isInside('/srv/app', '/srv/app-evil/strut.js') // false
 */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  const first = rel.split(/[\\/]/)[0]
  return first !== '..'
}

/** Whether `ancestor` is a strict ancestor of `path`. */
function isStrictAncestor(ancestor: string, path: string): boolean {
  return !samePath(ancestor, path) && isInside(ancestor, path)
}

/**
 * A file-system or drive root, the temp directory itself, or a folder above home: never a
 * project, and the upward search stops there.
 *
 * @example
 * isForbiddenProjectDir('C:\\', facts) // true
 */
export function isForbiddenProjectDir(dir: string, facts: BoundaryFacts): boolean {
  for (const d of spellings(dir)) {
    if (dirname(d) === d) return true
    for (const temp of spellings(facts.temp)) if (samePath(d, temp)) return true
    for (const home of spellings(facts.home)) if (isStrictAncestor(d, home)) return true
  }
  return false
}

/**
 * POSIX only: whether `dir` belongs to the current user (always `true` without a uid, i.e. on
 * Windows). A missing folder is not owned by anyone: `false`.
 */
export function isOwnedByCurrentUser(dir: string, facts: BoundaryFacts): boolean {
  if (facts.uid === undefined) return true
  try {
    return statSync(dir).uid === facts.uid
  } catch {
    return false
  }
}
