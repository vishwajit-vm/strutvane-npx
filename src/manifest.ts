/**
 * Reading `package.json` files the guard does not control.
 *
 * Every manifest read here is untrusted input (it may be in a folder someone else wrote), so the
 * reader is lenient (any problem means "no manifest") and bounded (a huge file is not read).
 * Nothing in a manifest is ever executed; it only decides what is trusted.
 *
 * @module
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The package that marks a Strutvane project, and whose `strutvane` program runs commands. */
export const FRAMEWORK_PACKAGE = '@strutvane/framework'

/** Manifests larger than this are not read (1 MiB; real ones are a few KiB). */
export const MAX_MANIFEST_BYTES: number = 1024 * 1024

/** A parsed JSON object. */
export type JsonObject = Readonly<Record<string, unknown>>

/**
 * Read a JSON object file. Returns `undefined` when it is missing, not a regular file, larger than
 * {@link MAX_MANIFEST_BYTES}, not valid JSON, or not an object.
 *
 * @example
 * readJsonObject('/srv/app/package.json')?.['name'] // 'my-app'
 */
export function readJsonObject(path: string): JsonObject | undefined {
  try {
    const stats = statSync(path)
    if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) return undefined
    const text = readFileSync(path, 'utf8')
    const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : undefined
  } catch {
    return undefined
  }
}

/** `<dir>/package.json`, read with {@link readJsonObject}. */
export function readManifest(dir: string): JsonObject | undefined {
  return readJsonObject(join(dir, 'package.json'))
}

/**
 * Whether a manifest lists `@strutvane/framework` in `dependencies` or `devDependencies` (as an
 * own property with a string range). That is what makes a folder a Strutvane project.
 *
 * Why only those two fields: an optional or peer dependency is not installed for the app itself,
 * and the framework's own project detection uses the same two.
 *
 * @example
 * declaresFramework({ dependencies: { '@strutvane/framework': '^0.2.0-next.0' } }) // true
 */
export function declaresFramework(manifest: JsonObject | undefined): boolean {
  if (manifest === undefined) return false
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = manifest[field]
    return (
      typeof deps === 'object' &&
      deps !== null &&
      !Array.isArray(deps) &&
      Object.hasOwn(deps, FRAMEWORK_PACKAGE) &&
      typeof (deps as Record<string, unknown>)[FRAMEWORK_PACKAGE] === 'string'
    )
  })
}
