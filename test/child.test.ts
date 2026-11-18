import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ChildRequest,
  HANDLED_SIGNALS,
  runChild,
  type SignalSource,
  shouldForward,
  signalExitCode,
} from '../src/child.ts'
import { readReport, removeDir, reporter, tempDir, waitForFile, write } from './helpers.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

/** A folder with the reporter script, and a request that runs it, reporting to `out`. */
function setup(args: readonly string[], extra: Partial<ChildRequest> = {}) {
  const dir = tempDir()
  dirs.push(dir)
  const script = join(dir, 'strut.mjs')
  write(script, reporter('strut.js'))
  const out = join(dir, 'report.json')
  const request: ChildRequest = {
    execPath: process.execPath,
    script,
    args,
    cwd: dir,
    env: { ...process.env, STRUT_TEST_OUT: out },
    platform: process.platform,
    stdinIsTTY: false,
    stdio: 'ignore',
    ...extra,
  }
  return { dir, out, request }
}

describe('shouldForward', () => {
  it('Windows: never (the console already delivers Ctrl+C; a "signal" would kill outright)', () => {
    for (const signal of HANDLED_SIGNALS) expect(shouldForward(signal, 'win32', false)).toBe(false)
  })

  it('POSIX: Ctrl+C at a terminal is not doubled; everything else is forwarded', () => {
    expect(shouldForward('SIGINT', 'linux', true)).toBe(false)
    expect(shouldForward('SIGINT', 'linux', false)).toBe(true)
    expect(shouldForward('SIGTERM', 'darwin', true)).toBe(true)
    expect(shouldForward('SIGHUP', 'linux', true)).toBe(true)
  })
})

describe('signalExitCode', () => {
  it('is 128 + the signal number', () => {
    expect(signalExitCode('SIGINT')).toBe(130)
    expect(signalExitCode('SIGTERM')).toBe(143)
  })

  it('is 1 for a signal this platform does not know', () => {
    expect(signalExitCode('SIGNOPE' as NodeJS.Signals)).toBe(1)
  })
})

describe('runChild', () => {
  it('passes the exit code through unchanged', async () => {
    for (const code of [0, 1, 3, 42, 130]) {
      const { request } = setup(['exit', String(code)])
      expect(await runChild(request)).toEqual({ kind: 'exit', code })
    }
  })

  it('attack: arguments reach the script exactly, with no shell in between', async () => {
    const tricky = [
      'a&b',
      'a|b',
      '$(touch pwned)',
      '`touch pwned`',
      '; rm -rf ~',
      '%PATH%',
      '!PATH!',
      '^&echo',
      '"quoted"',
      "it's",
      'back\\slash\\',
      'trailing\\"',
      'with space',
      '',
      'line\nbreak',
      '日本語',
      '<in >out',
      '*',
    ]
    const { out, dir, request } = setup(tricky)
    expect(await runChild(request)).toEqual({ kind: 'exit', code: 0 })
    expect(readReport(out).args).toEqual(tricky)
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('attack: Node options after the script are arguments, never Node options', async () => {
    const { out, dir, request } = setup([])
    const evil = join(dir, 'evil.mjs')
    write(
      evil,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(join(dir, 'pwned'))}, 'x')\n`,
    )
    const args = [`--import=${evil}`, '--require', evil, '--eval', 'process.exit(9)', '-e', '1']
    expect(await runChild({ ...request, args })).toEqual({ kind: 'exit', code: 0 })
    expect(readReport(out).args).toEqual(args)
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
  })

  it('runs in the requested working directory with the requested environment', async () => {
    const { out, dir, request } = setup([])
    await runChild({ ...request, env: { ...request.env, STRUTVANE_NPX_DEPTH: '1' } })
    const report = readReport(out)
    expect(report.cwd).toBe(dir)
    expect(report.depth).toBe('1')
  })

  it('reports a child killed by a signal', async () => {
    const { request } = setup(['signal', 'SIGTERM'])
    const outcome = await runChild(request)
    if (process.platform === 'win32') {
      // Windows has no signals: process.kill() terminates the process with exit code 1.
      expect(outcome).toEqual({ kind: 'exit', code: 1 })
    } else {
      expect(outcome).toEqual({ kind: 'signal', signal: 'SIGTERM' })
    }
  })

  it('forwards a signal the guard receives to the child (POSIX rule)', async () => {
    const signals = new EventEmitter()
    const { out, request } = setup(['wait'], {
      platform: 'linux',
      signals: signals as unknown as SignalSource,
    })
    const running = runChild(request)
    await waitForFile(`${out}.ready`)
    signals.emit('SIGTERM', 'SIGTERM')
    expect(await running).toEqual({ kind: 'signal', signal: 'SIGTERM' })
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('keeps listening but does not forward where it must not (Windows rule)', async () => {
    const signals = new EventEmitter()
    const { out, request } = setup(['wait'], {
      platform: 'win32',
      signals: signals as unknown as SignalSource,
    })
    const running = runChild(request)
    await waitForFile(`${out}.ready`)
    for (const signal of HANDLED_SIGNALS) expect(signals.listenerCount(signal)).toBe(1)
    signals.emit('SIGINT', 'SIGINT')
    signals.emit('SIGTERM', 'SIGTERM')
    write(`${out}.release`, 'go')
    expect(await running).toEqual({ kind: 'exit', code: 0 })
    for (const signal of HANDLED_SIGNALS) expect(signals.listenerCount(signal)).toBe(0)
  })

  it('ignores a signal that arrives after the child has exited', async () => {
    const signals = new EventEmitter()
    let late: ((signal: NodeJS.Signals) => void) | undefined
    const source: SignalSource = {
      on: (event, listener) => {
        late = listener
        return signals.on(event, listener)
      },
      off: (event, listener) => signals.off(event, listener),
    }
    const { request } = setup(['exit', '0'], { platform: 'linux', signals: source })
    expect(await runChild(request)).toEqual({ kind: 'exit', code: 0 })
    expect(late).toBeDefined()
    late?.('SIGTERM') // must not throw or kill anything
  })

  it('resolves (never rejects) when the program cannot start', async () => {
    const { request } = setup([])
    const outcome = await runChild({ ...request, execPath: join(request.cwd, 'no-such-node') })
    expect(outcome.kind).toBe('error')
  })

  it("inherits the guard's stdio by default", async () => {
    const { request } = setup(['exit', '0'])
    const { stdio: _stdio, ...rest } = request
    expect(await runChild(rest)).toEqual({ kind: 'exit', code: 0 })
  })
})
