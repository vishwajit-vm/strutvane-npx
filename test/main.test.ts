import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChildRequest, ChildRunner } from '../src/child.ts'
import {
  childEnvironment,
  DEPTH_ENV,
  depthOf,
  EXIT,
  type GuardEnvironment,
  main,
} from '../src/main.ts'
import {
  factsFor,
  installFramework,
  linkDir,
  makeProject,
  readReport,
  removeDir,
  reporter,
  tempDir,
  write,
} from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

function home(): string {
  const dir = tempDir()
  dirs.push(dir)
  return dir
}

/** A guard environment rooted at `cwd`, with output captured. */
function environment(cwd: string, base: string, extra: Partial<GuardEnvironment> = {}) {
  const out: string[] = []
  const err: string[] = []
  const report = join(base, 'report.json')
  const env: GuardEnvironment = {
    cwd,
    env: { PATH: process.env['PATH'] ?? '', STRUT_TEST_OUT: report },
    execPath: process.execPath,
    platform: process.platform,
    nodeVersion: '24.3.0',
    version: '0.2.0-next.0',
    stdinIsTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    boundary: factsFor(base),
    ...extra,
  }
  return { env, out, err, report }
}

/** A runner that records the request and answers with `outcome`. */
function fakeRunner(outcome: Awaited<ReturnType<ChildRunner>>) {
  const requests: ChildRequest[] = []
  const run: ChildRunner = async (request) => {
    requests.push(request)
    return outcome
  }
  return { run, requests }
}

describe('main: outside a project (prints only, never runs or downloads anything)', () => {
  it('help, --help, -h and no command print the pointer to the installer (exit 0)', async () => {
    const base = home()
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const { env, out, err } = environment(base, base)
      expect(await main(argv, env)).toEqual({ exitCode: EXIT.OK })
      expect(err).toEqual([])
      expect(out.join('\n')).toContain('npm create strutvane@next my-app')
      expect(out.join('\n')).toContain('never installs or downloads')
    }
  })

  it('--version prints this package version (exit 0)', async () => {
    const base = home()
    for (const flag of ['--version', '-v', '-V']) {
      const { env, out } = environment(base, base)
      expect(await main([flag], env)).toEqual({ exitCode: EXIT.OK })
      expect(out).toEqual(['strutvane 0.2.0-next.0'])
    }
  })

  it('new/create/init point to npm create with the name (exit 2, nothing fetched)', async () => {
    const base = home()
    const { env, err, out } = environment(base, base)
    expect(await main(['new', 'blog'], env)).toEqual({ exitCode: EXIT.USAGE })
    expect(out).toEqual([])
    expect(err.join('\n')).toContain('npm create strutvane@next blog')
  })

  it('attack: a hostile project name is never echoed into the suggested command', async () => {
    const base = home()
    const { env, err } = environment(base, base)
    await main(['create', 'x; rm -rf ~'], env)
    expect(err.join('\n')).toContain('npm create strutvane@next <name>')
    expect(err.join('\n')).not.toContain('rm -rf')
  })

  it('an unknown or project command exits 2 and explains', async () => {
    const base = home()
    const { env, err } = environment(base, base)
    expect(await main(['migrate', '--force'], env)).toEqual({ exitCode: EXIT.USAGE })
    expect(err.join('\n')).toContain('"migrate" needs a Strutvane project')
  })

  it('attack: terminal escape sequences in the command are not printed', async () => {
    const base = home()
    const { env, err } = environment(base, base)
    await main(['\u001b[2J\u001b]0;pwned\u0007x'], env)
    expect(err.join('\n')).not.toContain('\u001b')
    expect(err.join('\n')).not.toContain('\u0007')
  })

  it('says the latest tag for a stable version', async () => {
    const base = home()
    const { env, out } = environment(base, base, { version: '1.0.0' })
    await main([], env)
    expect(out.join('\n')).toContain('npm create strutvane@latest my-app')
  })
})

describe('main: inside a project', () => {
  it('runs strut.js with the arguments exactly as typed, from the project root', async () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    const deep = join(root, 'app', 'models')
    mkdirSync(deep, { recursive: true })
    const { env, report } = environment(deep, base)
    const args = ['make:model', 'Invoice', '--force', 'a&b']
    expect(await main(args, env)).toEqual({ exitCode: 0 })
    const got = readReport(report)
    expect(got.label).toBe('strut.js')
    expect(got.args).toEqual(args)
    expect(got.cwd).toBe(root)
    expect(got.script).toBe(realpathSync.native(join(root, 'strut.js')))
    expect(got.depth).toBe('1')
  })

  it('hands every argument to the project, --version and help included', async () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    for (const argv of [['--version'], ['help'], []]) {
      const { env, report, out } = environment(root, base)
      await main(argv, env)
      expect(readReport(report).args).toEqual(argv)
      expect(out).toEqual([])
    }
  })

  it("passes the project's exit code through", async () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    const { env } = environment(root, base)
    expect(await main(['exit', '6'], env)).toEqual({ exitCode: 6 })
  })

  it("without strut.js, runs the installed framework's own strutvane program", async () => {
    const base = home()
    const root = makeProject(join(base, 'api'), { strut: false })
    installFramework(root)
    const { env, report } = environment(root, base)
    expect(await main(['list'], env)).toEqual({ exitCode: 0 })
    expect(readReport(report)).toMatchObject({ label: 'framework', args: ['list'] })
  })

  it('a child killed by a signal comes back as that signal, with 128 + n as the fallback', async () => {
    const base = home()
    makeProject(join(base, 'blog'))
    const { run } = fakeRunner({ kind: 'signal', signal: 'SIGTERM' })
    const { env } = environment(join(base, 'blog'), base, { run })
    expect(await main([], env)).toEqual({ signal: 'SIGTERM', exitCode: 143 })
  })

  it('a child that cannot start is reported (exit 1)', async () => {
    const base = home()
    makeProject(join(base, 'blog'))
    const { run } = fakeRunner({ kind: 'error', message: 'spawn EACCES' })
    const { env, err } = environment(join(base, 'blog'), base, { run })
    expect(await main([], env)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('spawn EACCES')
  })

  it('hands the runner the platform, terminal state and guarded environment', async () => {
    const base = home()
    const root = makeProject(join(base, 'blog'))
    const { run, requests } = fakeRunner({ kind: 'exit', code: 0 })
    const { env } = environment(root, base, { run, platform: 'win32', stdinIsTTY: true })
    await main(['x'], env)
    expect(requests[0]).toMatchObject({
      execPath: process.execPath,
      args: ['x'],
      cwd: root,
      platform: 'win32',
      stdinIsTTY: true,
    })
    expect(requests[0]?.env[DEPTH_ENV]).toBe('1')
    expect(requests[0]?.env['NoDefaultCurrentDirectoryInExePath']).toBe('1')
  })
})

describe('main: refusals (nothing runs, exit 1)', () => {
  it('Node older than 24.3', async () => {
    const base = home()
    const { env, err } = environment(base, base, { nodeVersion: '22.12.0' })
    expect(await main([], env)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('Node.js 22.12.0 is too old')
  })

  it('attack: started again by the command it started (loop)', async () => {
    const base = home()
    makeProject(join(base, 'blog'))
    const { env, err } = environment(join(base, 'blog'), base)
    const looped = { ...env, env: { ...env.env, [DEPTH_ENV]: '1' } }
    expect(await main([], looped)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('instead of looping')
  })

  it('attack: a planted strut.js without the framework in package.json', async () => {
    const base = home()
    const dir = join(base, 'downloads', 'archive')
    write(join(dir, 'strut.js'), reporter('planted'))
    const { env, err, report } = environment(dir, base)
    expect(await main(['migrate'], env)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('was not run')
    expect(() => readReport(report)).toThrow()
  })

  it('attack: a project root reached through a link', async () => {
    const base = home()
    const real = makeProject(join(base, 'real'))
    const link = join(base, 'link')
    linkDir(real, link)
    const { env, err, report } = environment(link, base)
    expect(await main([], env)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('is a link to')
    expect(() => readReport(report)).toThrow()
  })

  it('a project whose dependencies are not installed', async () => {
    const base = home()
    const root = makeProject(join(base, 'api'), { strut: false })
    const { env, err } = environment(root, base)
    expect(await main(['list'], env)).toEqual({ exitCode: EXIT.FAILURE })
    expect(err.join('\n')).toContain('npm install')
  })
})

describe('environment helpers', () => {
  it('childEnvironment keeps the user environment and adds the guard markers', () => {
    expect(childEnvironment({ A: '1' }, 'linux', 0)).toEqual({ A: '1', [DEPTH_ENV]: '1' })
    expect(childEnvironment({ A: '1' }, 'win32', 0)).toEqual({
      A: '1',
      NoDefaultCurrentDirectoryInExePath: '1',
      [DEPTH_ENV]: '1',
    })
  })

  it('depthOf reads small numbers and treats anything else as 0', () => {
    expect(depthOf({})).toBe(0)
    expect(depthOf({ [DEPTH_ENV]: '2' })).toBe(2)
    expect(depthOf({ [DEPTH_ENV]: 'x' })).toBe(0)
    expect(depthOf({ [DEPTH_ENV]: '-1' })).toBe(0)
    expect(depthOf({ [DEPTH_ENV]: '99999' })).toBe(0)
  })
})
