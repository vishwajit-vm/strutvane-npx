/**
 * This package's own version, and the Node.js versions it supports.
 *
 * @module
 */
import { fileURLToPath } from 'node:url'
import { readJsonObject } from './manifest.ts'

/** The oldest Node.js the guard (and the framework it starts) supports: package.json `engines`. */
export const MIN_NODE = '24.3.0'

/**
 * This package's version, read from its own package.json (one folder up from both `src/` and
 * `dist/`), so it can never drift from what was published. `0.0.0` if it cannot be read.
 *
 * @example
 * ownVersion() // '0.2.0-next.0'
 */
export function ownVersion(manifestUrl: URL = new URL('../package.json', import.meta.url)): string {
  const version = readJsonObject(fileURLToPath(manifestUrl))?.['version']
  return typeof version === 'string' ? version : '0.0.0'
}

/**
 * Whether `version` (`process.versions.node`, e.g. `24.3.0`) is at least `minimum`. Anything that
 * is not `major.minor.patch` counts as too old (fail closed).
 *
 * @example
 * isNodeSupported('24.3.0', '24.3.0') // true
 * isNodeSupported('22.12.0', '24.3.0') // false
 */
export function isNodeSupported(version: string, minimum: string = MIN_NODE): boolean {
  const parse = (v: string): number[] | undefined => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const have = parse(version)
  const need = parse(minimum)
  if (have === undefined || need === undefined) return false
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0
    const b = need[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}
