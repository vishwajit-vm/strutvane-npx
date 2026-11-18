/**
 * Finding the Strutvane project for a working directory.
 *
 * From the working directory upwards, the **nearest** folder that holds a `strut.js` or whose
 * package.json lists `@strutvane/framework` is the candidate, and the search ends there (an
 * ancestor further up is never considered, so a project can't be hijacked from above). The
 * candidate is trusted only when:
 * - its package.json lists `@strutvane/framework` (a `strut.js` on its own is not enough: anyone
 *   can drop a file called `strut.js` into a folder);
 * - it passes the boundary rules of `boundary.ts` (never a root, the temp directory or a folder
 *   above home; owned by the current user on POSIX).
 *
 * Only files are read here; nothing is run.
 *
 * @module
 */
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { type BoundaryFacts, isForbiddenProjectDir, isOwnedByCurrentUser } from './boundary.ts'
import { declaresFramework, readManifest } from './manifest.ts'

/** The file that `node strut` runs, in the project root. */
export const STRUT_FILE = 'strut.js'

/** Why a candidate folder was found but not trusted. */
export type UntrustedReason =
  /** It has a `strut.js` but its package.json does not list `@strutvane/framework`. */
  | 'strut-without-framework'
  /** POSIX: the folder belongs to another user. */
  | 'not-owned'

/** The outcome of the search. */
export type ProjectSearch =
  /** A trusted project root (not yet checked for links; see `target.ts`). */
  | { readonly kind: 'project'; readonly root: string }
  /** A candidate was found and refused. */
  | { readonly kind: 'untrusted'; readonly dir: string; readonly reason: UntrustedReason }
  /** No candidate between `start` and the first boundary. */
  | { readonly kind: 'none'; readonly start: string }

/** Whether `path` exists in any form (a file, a folder, a link, even a broken link). */
function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Find the project for `start` (see the module documentation for the rules).
 *
 * @example
 * findProject('/home/ana/blog/app/models', facts) // { kind: 'project', root: '/home/ana/blog' }
 */
export function findProject(start: string, facts: BoundaryFacts): ProjectSearch {
  const from = resolve(start)
  let dir = from
  for (;;) {
    if (isForbiddenProjectDir(dir, facts)) return { kind: 'none', start: from }
    const declares = declaresFramework(readManifest(dir))
    if (declares || exists(join(dir, STRUT_FILE))) {
      if (!declares) return { kind: 'untrusted', dir, reason: 'strut-without-framework' }
      if (!isOwnedByCurrentUser(dir, facts)) return { kind: 'untrusted', dir, reason: 'not-owned' }
      return { kind: 'project', root: dir }
    }
    const parent = dirname(dir)
    if (parent === dir) return { kind: 'none', start: from }
    dir = parent
  }
}
