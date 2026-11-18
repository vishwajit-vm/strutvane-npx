/**
 * Everything the guard says. One place, so the wording stays consistent and every value from
 * outside (paths, arguments, versions) is made safe to print first.
 *
 * Messages say what happened and how to fix it (ecosystem standard), in plain words.
 *
 * @module
 */
import type { UntrustedReason } from './project.ts'
import type { RefusalReason } from './target.ts'

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * Text from outside the guard (a path, an argument, a version from a file it does not control),
 * made safe for a terminal: control characters (ANSI escapes, line breaks) removed and the length
 * capped, so a crafted folder or argument can't rewrite the screen or fake a message.
 *
 * @example
 * printable('a\u001b[2Jb') // 'a[2Jb'
 */
export function printable(text: string, max = 200): string {
  const clean = text.replace(CONTROL, '')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * The dist-tag to name in `npm create strutvane@<tag>`: `next` while this package is a
 * pre-release (before 1.0 the core train is published under `next`, decision #128), `latest`
 * otherwise. The same rule as create-strutvane's `releaseTag()`.
 *
 * @example
 * releaseTag('0.2.0-next.0') // 'next'
 * releaseTag('1.0.0') // 'latest'
 */
export function releaseTag(version: string): 'next' | 'latest' {
  return version.includes('-') ? 'next' : 'latest'
}

/** `npm create strutvane@<tag> <name>`, the one command that makes a project. */
export function createCommand(version: string, name = 'my-app'): string {
  return `npm create strutvane@${releaseTag(version)} ${name}`
}

/** A project name worth echoing back in a suggestion (otherwise the placeholder is shown). */
const SIMPLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** Commands people type to make a new project. */
export const CREATE_WORDS: ReadonlySet<string> = new Set(['new', 'create', 'init'])

/** `strutvane <version>`. */
export function versionText(version: string): string {
  return `strutvane ${printable(version, 64)}`
}

/** What `npx strutvane` does, and how to make a project. Printed for `help` outside a project. */
export function helpText(version: string, start: string): string {
  return [
    `${versionText(version)}: run Strutvane project commands with npx.`,
    '',
    `No Strutvane project was found in ${printable(start)} or the folders above it.`,
    '',
    'Create a new app:',
    `  ${createCommand(version)}`,
    '',
    'Inside a project, `npx strutvane <command>` runs exactly what `node strut <command>` runs,',
    "with the project's own @strutvane/framework (try `node strut list` there). A project is a",
    'folder whose package.json lists @strutvane/framework.',
    '',
    'This command never installs or downloads anything.',
  ].join('\n')
}

/** A project command was typed outside a project. */
export function noProjectText(version: string, command: string, start: string): string {
  const word = printable(command, 60)
  return [
    `strutvane: "${word}" needs a Strutvane project, and none was found in ${printable(start)}`,
    '  or the folders above it (a project is a folder whose package.json lists',
    '  @strutvane/framework; the search never goes above your home folder).',
    '',
    `  Create one with:  ${createCommand(version)}`,
    '  Then run commands inside it:  node strut list',
  ].join('\n')
}

/** `new`, `create` or `init` was typed: point to the installer instead of running anything. */
export function createText(version: string, name: string | undefined): string {
  const shown = name !== undefined && SIMPLE_NAME.test(name) ? name : '<name>'
  return [
    'strutvane: new projects are made by the installer, which asks how you want the app set up:',
    '',
    `  ${createCommand(version, shown)}`,
  ].join('\n')
}

/** A candidate project folder was found but is not trusted. */
export function untrustedText(dir: string, reason: UntrustedReason): string {
  const where = printable(dir)
  if (reason === 'not-owned') {
    return [
      `strutvane: ${where} looks like a Strutvane project, but it belongs to another user.`,
      '  Refusing to run code from it. Run the command as the folder owner, or fix its ownership.',
    ].join('\n')
  }
  return [
    `strutvane: ${where} has a strut.js, but its package.json does not list @strutvane/framework,`,
    '  so it is not a Strutvane project and its strut.js was not run.',
    '  If it is your project, add the framework (npm install @strutvane/framework) and try again;',
    '  otherwise run the command from your project folder.',
  ].join('\n')
}

/** Why a trusted project still can't be run, and the fix. */
export function refusalText(reason: RefusalReason, path: string, realPath?: string): string {
  const where = printable(path)
  switch (reason) {
    case 'root-unreadable':
      return `strutvane: the project folder ${where} can no longer be read. Check it exists and try again.`
    case 'root-is-link':
      return [
        `strutvane: the project folder ${where} is a link${realPath === undefined ? '' : ` to ${printable(realPath)}`}.`,
        '  Refusing to run code through a link: open the real folder and run the command there.',
      ].join('\n')
    case 'strut-not-file':
      return [
        `strutvane: ${where} is a link or not a regular file, so it was not run.`,
        '  Restore strut.js from git (or from a new project made with npm create strutvane).',
      ].join('\n')
    case 'strut-outside-root':
      return `strutvane: ${where} really lives outside the project folder, so it was not run.`
    case 'framework-missing':
      return [
        `strutvane: the project's dependencies are not installed (${where} is missing).`,
        '  Run: npm install    (or npm run setup in a project made by create-strutvane)',
      ].join('\n')
    case 'framework-outside-root':
      return [
        `strutvane: ${where} points outside the project folder (a link or junction), so it was not run.`,
        '  Install the framework into the project instead: npm install',
      ].join('\n')
    case 'framework-invalid':
      return [
        `strutvane: ${where} is not a usable @strutvane/framework (wrong name, or no safe "strutvane" program).`,
        '  Reinstall it: npm install',
      ].join('\n')
  }
}

/** The guard was started again by the project it started (a `strut.js` calling `npx strutvane`). */
export function loopText(): string {
  return [
    'strutvane: npx strutvane was started again from inside the command it ran, so it stopped',
    '  instead of looping. Call `node strut` (not `npx strutvane`) from strut.js and project scripts.',
  ].join('\n')
}

/** Node is older than the minimum. */
export function nodeTooOldText(found: string, minimum: string): string {
  return [
    `strutvane: Node.js ${printable(found, 32)} is too old; Strutvane needs Node.js ${minimum} or newer.`,
    '  Install a current LTS from https://nodejs.org and try again.',
  ].join('\n')
}

/** The child could not be started at all. */
export function startFailedText(script: string, message: string): string {
  return `strutvane: could not start ${printable(script)}: ${printable(message)}`
}
