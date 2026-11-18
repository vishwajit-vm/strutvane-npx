/**
 * The published manifest is part of the contract: these pin what makes `strutvane` a safe npx
 * guard (no dependencies, a single bin, no install scripts, ESM, Node 24.3+).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>

describe('package.json', () => {
  it('is the unscoped strutvane package with one bin', () => {
    expect(pkg['name']).toBe('strutvane')
    expect(pkg['bin']).toEqual({ strutvane: 'dist/bin.mjs' })
    expect(pkg['type']).toBe('module')
    expect(pkg['license']).toBe('MIT')
  })

  it('has zero runtime dependencies and no install scripts', () => {
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'bundleDependencies',
    ]) {
      expect(pkg[field], field).toBeUndefined()
    }
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(scripts[hook], hook).toBeUndefined()
    }
  })

  it('pins registry-exact dev dependencies (no ranges, no file:, link: or git specs)', () => {
    for (const [name, spec] of Object.entries(
      (pkg['devDependencies'] ?? {}) as Record<string, string>,
    )) {
      expect(spec, name).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    }
  })

  it('publishes only dist and the docs, on Node 24.3+, with npm 11.19+ for development', () => {
    expect(pkg['files']).toEqual(['dist', 'README.md', 'CHANGELOG.md', 'LICENSE'])
    expect(pkg['engines']).toEqual({ node: '>=24.3' })
    expect(pkg['devEngines']).toEqual({
      packageManager: { name: 'npm', version: '>=11.19.0', onFail: 'error' },
    })
    expect(pkg['publishConfig']).toEqual({ access: 'public', provenance: true })
  })

  it('lets only the bin entry print with console', () => {
    expect(pkg['strutvane']).toEqual({ allowConsole: ['src/bin.ts'] })
  })
})
