import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isNodeSupported, MIN_NODE, ownVersion } from '../src/version.ts'

describe('isNodeSupported', () => {
  it('compares major, minor and patch', () => {
    expect(isNodeSupported('24.3.0')).toBe(true)
    expect(isNodeSupported('24.21.0')).toBe(true)
    expect(isNodeSupported('26.0.0')).toBe(true)
    expect(isNodeSupported('24.2.9')).toBe(false)
    expect(isNodeSupported('22.12.0')).toBe(false)
    expect(isNodeSupported('24.3.1', '24.3.2')).toBe(false)
  })

  it('fails closed on anything that is not a version', () => {
    expect(isNodeSupported('')).toBe(false)
    expect(isNodeSupported('v24.3.0')).toBe(false)
    expect(isNodeSupported('24.3.0', 'x')).toBe(false)
  })

  it('matches the engines field', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.engines.node).toBe(`>=${MIN_NODE.replace(/\.0$/, '')}`)
  })
})

describe('ownVersion', () => {
  it('reads the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(ownVersion()).toBe(pkg.version)
  })

  it('falls back to 0.0.0 when the manifest cannot be read', () => {
    expect(ownVersion(new URL('./missing.json', import.meta.url))).toBe('0.0.0')
  })
})
