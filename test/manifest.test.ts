import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  declaresFramework,
  MAX_MANIFEST_BYTES,
  readJsonObject,
  readManifest,
} from '../src/manifest.ts'
import { removeDir, tempDir } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

function base(): string {
  const dir = tempDir()
  dirs.push(dir)
  return dir
}

describe('declaresFramework', () => {
  it('accepts dependencies and devDependencies with a string range', () => {
    expect(declaresFramework({ dependencies: { '@strutvane/framework': '^0.2.0-next.0' } })).toBe(
      true,
    )
    expect(declaresFramework({ devDependencies: { '@strutvane/framework': '0.2.0' } })).toBe(true)
  })

  it('ignores optional and peer dependencies (not installed for the app itself)', () => {
    expect(declaresFramework({ optionalDependencies: { '@strutvane/framework': '^0.2' } })).toBe(
      false,
    )
    expect(declaresFramework({ peerDependencies: { '@strutvane/framework': '^0.2' } })).toBe(false)
  })

  it('refuses look-alikes: other packages, non-string ranges, arrays, inherited keys', () => {
    expect(declaresFramework(undefined)).toBe(false)
    expect(declaresFramework({})).toBe(false)
    expect(declaresFramework({ dependencies: { '@strutvane/core': '^0.1' } })).toBe(false)
    expect(declaresFramework({ dependencies: { '@strutvane/framework': 2 } })).toBe(false)
    expect(declaresFramework({ dependencies: ['@strutvane/framework'] })).toBe(false)
    expect(declaresFramework({ dependencies: null })).toBe(false)
    const inherited = Object.create({ '@strutvane/framework': '^0.2' }) as Record<string, unknown>
    expect(declaresFramework({ dependencies: inherited })).toBe(false)
  })

  it('is not fooled by __proto__ in JSON', () => {
    const parsed = JSON.parse(
      '{"dependencies":{"__proto__":{"@strutvane/framework":"^0.2"}}}',
    ) as Record<string, unknown>
    expect(declaresFramework(parsed)).toBe(false)
  })
})

describe('readJsonObject', () => {
  it('reads an object, with or without a byte-order mark', () => {
    const dir = base()
    writeFileSync(join(dir, 'a.json'), '{"name":"a"}')
    writeFileSync(join(dir, 'b.json'), '﻿{"name":"b"}')
    expect(readJsonObject(join(dir, 'a.json'))).toEqual({ name: 'a' })
    expect(readJsonObject(join(dir, 'b.json'))).toEqual({ name: 'b' })
  })

  it('returns undefined for anything that is not a JSON object file', () => {
    const dir = base()
    writeFileSync(join(dir, 'broken.json'), '{"name":')
    writeFileSync(join(dir, 'array.json'), '[1,2]')
    writeFileSync(join(dir, 'null.json'), 'null')
    mkdirSync(join(dir, 'folder.json'))
    expect(readJsonObject(join(dir, 'broken.json'))).toBeUndefined()
    expect(readJsonObject(join(dir, 'array.json'))).toBeUndefined()
    expect(readJsonObject(join(dir, 'null.json'))).toBeUndefined()
    expect(readJsonObject(join(dir, 'folder.json'))).toBeUndefined()
    expect(readJsonObject(join(dir, 'missing.json'))).toBeUndefined()
  })

  it('does not read a file larger than the limit', () => {
    const dir = base()
    const padding = ' '.repeat(MAX_MANIFEST_BYTES)
    writeFileSync(join(dir, 'package.json'), `{"name":"huge"}${padding}`)
    expect(readManifest(dir)).toBeUndefined()
  })
})
