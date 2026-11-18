import { mkdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isForbiddenProjectDir,
  isInside,
  isOwnedByCurrentUser,
  processBoundary,
} from '../src/boundary.ts'
import { factsFor, removeDir, tempDir } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

describe('isInside', () => {
  const root = join(tmpdir(), 'app')

  it('accepts the folder itself and anything below it', () => {
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join(root, 'strut.js'))).toBe(true)
    expect(isInside(root, join(root, 'node_modules', '@strutvane', 'framework'))).toBe(true)
  })

  it('accepts a folder whose name only starts with two dots', () => {
    expect(isInside(root, join(root, '..cache', 'x.js'))).toBe(true)
  })

  it('refuses the parent, siblings and a sibling sharing the prefix (app-evil)', () => {
    expect(isInside(root, dirname(root))).toBe(false)
    expect(isInside(root, join(dirname(root), 'other', 'strut.js'))).toBe(false)
    expect(isInside(root, `${root}-evil`)).toBe(false)
    expect(isInside(root, join(`${root}-evil`, 'strut.js'))).toBe(false)
  })

  it('refuses traversal written into the path', () => {
    expect(isInside(root, join(root, '..', '..', 'etc', 'passwd'))).toBe(false)
  })

  it.runIf(process.platform === 'win32')('Windows: ignores case, refuses another drive', () => {
    expect(isInside('C:\\Users\\Ana\\App', 'c:\\users\\ana\\app\\strut.js')).toBe(true)
    expect(isInside('C:\\Users\\Ana\\App', 'D:\\Users\\Ana\\App\\strut.js')).toBe(false)
    expect(isInside('C:\\Users\\Ana\\App', '\\\\server\\share\\App\\strut.js')).toBe(false)
  })
})

describe('isForbiddenProjectDir', () => {
  it('forbids a file-system or drive root', () => {
    const root = parse(process.cwd()).root
    expect(isForbiddenProjectDir(root, processBoundary())).toBe(true)
  })

  it('forbids the temp directory itself, but not a folder inside it', () => {
    const base = tempDir()
    dirs.push(base)
    const facts = { home: base, temp: base, uid: undefined }
    expect(isForbiddenProjectDir(base, facts)).toBe(true)
    expect(isForbiddenProjectDir(join(base, 'project'), facts)).toBe(false)
    expect(isForbiddenProjectDir(base, { ...facts, temp: join(base, 'elsewhere') })).toBe(false)
  })

  it('forbids folders above home, never home itself or below it', () => {
    const base = tempDir()
    dirs.push(base)
    const home = join(base, 'users', 'ana')
    mkdirSync(home, { recursive: true })
    const facts = factsFor(home)
    expect(isForbiddenProjectDir(join(base, 'users'), facts)).toBe(true)
    expect(isForbiddenProjectDir(base, facts)).toBe(true)
    expect(isForbiddenProjectDir(home, facts)).toBe(false)
    expect(isForbiddenProjectDir(join(home, 'code', 'blog'), facts)).toBe(false)
  })

  it('uses the real process facts by default', () => {
    const facts = processBoundary()
    expect(facts.home).toBe(homedir())
    expect(facts.temp).toBe(tmpdir())
    expect(isForbiddenProjectDir(tmpdir(), facts)).toBe(true)
  })
})

describe('isOwnedByCurrentUser', () => {
  it('is always true without a uid (Windows)', () => {
    expect(isOwnedByCurrentUser('/does/not/matter', factsFor(tmpdir()))).toBe(true)
  })

  it("compares the folder's owner with the uid", () => {
    const base = tempDir()
    dirs.push(base)
    const owner = statSync(base).uid
    expect(isOwnedByCurrentUser(base, factsFor(base, owner))).toBe(true)
    expect(isOwnedByCurrentUser(base, factsFor(base, owner + 4242))).toBe(false)
  })

  it('a missing folder belongs to nobody', () => {
    expect(isOwnedByCurrentUser(join(tmpdir(), 'strutvane-missing-x'), factsFor(tmpdir(), 0))).toBe(
      false,
    )
  })
})
