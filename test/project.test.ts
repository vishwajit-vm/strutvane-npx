import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findProject } from '../src/project.ts'
import {
  factsFor,
  linkedParent,
  makeProject,
  projectManifest,
  removeDir,
  reporter,
  tempDir,
  write,
} from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

/** A temp folder used as "home", so every search stays inside it. */
function home(): string {
  const dir = tempDir()
  dirs.push(dir)
  return dir
}

describe('findProject', () => {
  it('finds the project from its root and from any folder below it', () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    const deep = join(root, 'app', 'models', 'nested')
    mkdirSync(deep, { recursive: true })
    expect(findProject(root, factsFor(base))).toEqual({ kind: 'project', root })
    expect(findProject(deep, factsFor(base))).toEqual({ kind: 'project', root })
  })

  it('a package.json listing the framework is enough (no strut.js needed)', () => {
    const base = home()
    const root = makeProject(join(base, 'api'), { strut: false })
    expect(findProject(root, factsFor(base))).toEqual({ kind: 'project', root })
  })

  it('the nearest project wins over one further up', () => {
    const base = home()
    const outer = makeProject(join(base, 'outer'))
    const inner = makeProject(join(outer, 'apps', 'inner'))
    expect(findProject(join(inner, 'src'), factsFor(base))).toEqual({
      kind: 'project',
      root: inner,
    })
  })

  it('walks past package.json files that do not list the framework', () => {
    const base = home()
    const root = makeProject(join(base, 'shop'))
    const tool = join(root, 'tools', 'script')
    write(join(tool, 'package.json'), JSON.stringify({ name: 'script', dependencies: {} }))
    expect(findProject(tool, factsFor(base))).toEqual({ kind: 'project', root })
  })

  it('attack: a planted strut.js (no framework in package.json) stops the search and is refused', () => {
    const base = home()
    const root = makeProject(join(base, 'shop'))
    const uploads = join(root, 'storage', 'uploads')
    write(join(uploads, 'strut.js'), reporter('planted'))
    expect(findProject(uploads, factsFor(base))).toEqual({
      kind: 'untrusted',
      dir: uploads,
      reason: 'strut-without-framework',
    })
  })

  it('attack: a strut.js that is a folder or a broken link still counts as a marker (refused)', () => {
    const base = home()
    const dir = join(base, 'odd')
    mkdirSync(join(dir, 'strut.js'), { recursive: true })
    expect(findProject(dir, factsFor(base))).toMatchObject({ kind: 'untrusted' })
  })

  it('attack: a project above home is never used (planted in a shared parent folder)', () => {
    const base = home()
    makeProject(base) // package.json + strut.js in the folder ABOVE "home"
    const userHome = join(base, 'users', 'ana')
    const work = join(userHome, 'notes')
    mkdirSync(work, { recursive: true })
    expect(findProject(work, factsFor(userHome))).toEqual({ kind: 'none', start: work })
  })

  it('attack: a project planted in the temp directory itself is never used', () => {
    const base = home()
    makeProject(base)
    const below = join(base, 'download-123')
    mkdirSync(below, { recursive: true })
    const facts = { home: join(base, 'h'), temp: base, uid: undefined }
    expect(findProject(below, facts)).toEqual({ kind: 'none', start: below })
  })

  it('attack: directory traversal in the start path is resolved before searching', () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    const elsewhere = join(base, 'elsewhere')
    mkdirSync(elsewhere, { recursive: true })
    const sneaky = join(root, 'app', '..', '..', 'elsewhere')
    expect(findProject(sneaky, factsFor(base))).toEqual({ kind: 'none', start: elsewhere })
  })

  it('attack (POSIX rule): a project owned by another user is refused', () => {
    const base = home()
    const root = makeProject(join(base, 'theirs'))
    const otherUid = statSync(root).uid + 4242
    expect(findProject(root, factsFor(base, otherUid))).toEqual({
      kind: 'untrusted',
      dir: root,
      reason: 'not-owned',
    })
  })

  it('reports where the search started when nothing is found', () => {
    const base = home()
    const empty = join(base, 'empty')
    mkdirSync(empty, { recursive: true })
    writeFileSync(join(empty, 'package.json'), projectManifest({ dependencies: {} }))
    expect(findProject(empty, factsFor(base))).toEqual({ kind: 'none', start: empty })
  })
})

// macOS: os.tmpdir() is `/var/folders/…`, but `/var` is a link to `/private/var`, so the same
// folder has two spellings. Simulated on every OS with a linked parent folder (a junction on
// Windows): the rules must hold whichever spelling the search or the facts use.
describe('findProject: paths that pass through a linked parent folder', () => {
  it('finds the project under the linked spelling, keeping that spelling', () => {
    const base = home()
    const { link } = linkedParent(base)
    const root = makeProject(join(link, 'blog'))
    const deep = join(root, 'app', 'models')
    mkdirSync(deep, { recursive: true })
    expect(findProject(deep, factsFor(base))).toEqual({ kind: 'project', root })
  })

  it('attack: a project planted in the temp directory is never used, whichever spelling', () => {
    const base = home()
    const { link, real } = linkedParent(base)
    makeProject(link) // in the "temp directory" itself
    const below = join(link, 'download-123')
    mkdirSync(below, { recursive: true })
    const h = join(base, 'h')
    // The temp directory named by its link, the search walking real paths, and the reverse.
    for (const [temp, start] of [
      [link, join(real, 'download-123')],
      [real, below],
      [link, below],
    ] as const) {
      expect(findProject(start, { home: h, temp, uid: undefined }), `${temp} / ${start}`).toEqual({
        kind: 'none',
        start,
      })
    }
  })

  it('attack: a project above home is never used, when home is spelled through a link', () => {
    const base = home()
    const { link, real } = linkedParent(base)
    makeProject(join(real, 'users')) // planted in the folder above "home"
    const work = join(link, 'users', 'ana', 'notes')
    mkdirSync(work, { recursive: true })
    for (const userHome of [join(link, 'users', 'ana'), join(real, 'users', 'ana')]) {
      expect(findProject(work, factsFor(userHome))).toEqual({ kind: 'none', start: work })
      const realWork = join(real, 'users', 'ana', 'notes')
      expect(findProject(realWork, factsFor(userHome))).toEqual({ kind: 'none', start: realWork })
    }
  })
})
