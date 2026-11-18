/**
 * End to end: the real `strutvane` bin, run by Node as a child process, against throwaway
 * projects. These check what only a real process can show: output, exit codes, Windows argument
 * quoting, and signals.
 */
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BIN,
  installFramework,
  makeProject,
  readReport,
  removeDir,
  runBin,
  tempDir,
  waitForFile,
} from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

function base(): string {
  const dir = tempDir()
  dirs.push(dir)
  return dir
}

describe('strutvane bin', () => {
  it('outside a project: prints the pointer to the installer and exits 0', () => {
    const result = runBin([], { cwd: base() })
    expect(result.status).toBe(0)
    expect(String(result.stdout)).toMatch(/npm create strutvane@(next|latest) my-app/)
  })

  it('outside a project: an unknown command exits non-zero with the reason on stderr', () => {
    const result = runBin(['migrate'], { cwd: base() })
    expect(result.status).toBe(2)
    expect(String(result.stdout)).toBe('')
    expect(String(result.stderr)).toContain('needs a Strutvane project')
  })

  it('--version prints the version from package.json', () => {
    const result = runBin(['--version'], { cwd: base() })
    expect(result.status).toBe(0)
    expect(String(result.stdout)).toMatch(/^strutvane \d+\.\d+\.\d+/)
  })

  it('inside a project: runs strut.js and passes its output and exit code through', () => {
    const root = makeProject(join(base(), 'blog'))
    const ok = runBin(['make:model', 'Invoice'], { cwd: root })
    expect(ok.status).toBe(0)
    const report = JSON.parse(String(ok.stdout))
    expect(report).toMatchObject({ label: 'strut.js', args: ['make:model', 'Invoice'], depth: '1' })
    expect(report.cwd).toBe(root)
    expect(runBin(['exit', '42'], { cwd: root }).status).toBe(42)
  })

  it('attack: arguments survive the real process boundary unchanged (Windows quoting too)', () => {
    const top = base()
    const root = makeProject(join(top, 'my app (dev)'))
    const out = join(top, 'report.json')
    const args = [
      'a b',
      '"double"',
      'tail\\',
      'tail\\"',
      'a&b|c<d>e^f',
      '%COMSPEC%',
      '$(id)',
      '',
      '--import=./x.mjs',
    ]
    const result = runBin(args, { cwd: root, env: { STRUT_TEST_OUT: out } })
    expect(result.status).toBe(0)
    expect(readReport(out).args).toEqual(args)
  })

  it('inside a project without strut.js: runs the installed framework bin', () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    const pkg = installFramework(root)
    const result = runBin(['list'], { cwd: root })
    expect(result.status).toBe(0)
    expect(JSON.parse(String(result.stdout))).toMatchObject({
      label: 'framework',
      args: ['list'],
      script: realpathSync.native(join(pkg, 'dist', 'console', 'bin.mjs')),
    })
  })

  it.runIf(process.platform !== 'win32')(
    'POSIX: a child killed by a signal makes the guard die of the same signal',
    () => {
      const root = makeProject(join(base(), 'blog'))
      const result = runBin(['signal', 'SIGTERM'], { cwd: root })
      expect(result.signal).toBe('SIGTERM')
      expect(result.status).toBeNull()
    },
  )

  it.runIf(process.platform === 'win32')(
    'Windows: a terminated child comes back as its exit code',
    () => {
      const root = makeProject(join(base(), 'blog'))
      const result = runBin(['signal', 'SIGTERM'], { cwd: root })
      expect(result.status).toBe(1)
    },
  )

  it.runIf(process.platform !== 'win32')(
    'POSIX: SIGTERM sent to the guard reaches the child, and the guard follows it',
    async () => {
      const top = base()
      const root = makeProject(join(top, 'blog'))
      const out = join(top, 'report.json')
      const env: NodeJS.ProcessEnv = { ...process.env, STRUT_TEST_OUT: out }
      delete env['STRUTVANE_NPX_DEPTH']
      const guard = spawn(process.execPath, [BIN, 'wait'], { cwd: root, env, stdio: 'ignore' })
      const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        guard.once('exit', (code, signal) => resolve({ code, signal })),
      )
      await waitForFile(`${out}.ready`)
      guard.kill('SIGTERM')
      expect(await ended).toEqual({ code: null, signal: 'SIGTERM' })
      expect(existsSync(`${out}.release`)).toBe(false)
    },
  )
})
