import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frameworkBin, isSafeBinPath, resolveTarget } from '../src/target.ts'
import {
  installFramework,
  linkDir,
  linkedParent,
  makeProject,
  removeDir,
  reporter,
  tempDir,
  tryLinkFile,
  write,
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

describe('isSafeBinPath', () => {
  it('accepts plain relative scripts', () => {
    for (const bin of ['dist/console/bin.mjs', './bin.js', 'bin\\cli.cjs', '..cache/x.js']) {
      expect(isSafeBinPath(bin)).toBe(true)
    }
  })

  it('attack: refuses traversal, absolute and Windows-specific paths', () => {
    for (const bin of [
      '../../evil.js',
      'dist/../../evil.js',
      '..\\..\\evil.js',
      'dist\\..\\..\\evil.js',
      '/etc/evil.js',
      'C:\\evil.js',
      'C:/evil.js',
      'C:evil.js',
      '\\\\server\\share\\evil.js',
      '//server/share/evil.js',
      '\\evil.js',
    ]) {
      expect(isSafeBinPath(bin), bin).toBe(false)
    }
  })

  it('attack: refuses non-scripts (shims, binaries, shell files), NUL and oversized values', () => {
    for (const bin of [
      '',
      'bin/run',
      'bin/run.cmd',
      'bin/run.bat',
      'bin/run.ps1',
      'bin/run.exe',
      'bin/run.sh',
      'bin.js\0.cmd',
      `${'a/'.repeat(300)}x.js`,
    ]) {
      expect(isSafeBinPath(bin), bin).toBe(false)
    }
  })
})

describe('frameworkBin', () => {
  it('reads the strutvane entry, or a string bin', () => {
    expect(frameworkBin({ bin: 'dist/bin.mjs' })).toBe('dist/bin.mjs')
    expect(frameworkBin({ bin: { strutvane: 'a.mjs', other: 'b.mjs' } })).toBe('a.mjs')
  })

  it('refuses anything else', () => {
    expect(frameworkBin({})).toBeUndefined()
    expect(frameworkBin({ bin: null })).toBeUndefined()
    expect(frameworkBin({ bin: ['a.mjs'] })).toBeUndefined()
    expect(frameworkBin({ bin: { 'strutvane-cli': 'a.mjs' } })).toBeUndefined()
    expect(frameworkBin({ bin: { strutvane: 7 } })).toBeUndefined()
  })
})

describe('resolveTarget: strut.js', () => {
  it("runs the project's strut.js by its real path", () => {
    const root = makeProject(join(base(), 'blog'))
    expect(resolveTarget(root)).toEqual({
      kind: 'run',
      root,
      script: realpathSync.native(join(root, 'strut.js')),
      via: 'strut.js',
    })
  })

  it('prefers strut.js over the installed framework (that is what node strut runs)', () => {
    const root = makeProject(join(base(), 'blog'))
    installFramework(root)
    expect(resolveTarget(root)).toMatchObject({ kind: 'run', via: 'strut.js' })
  })

  it('attack: a strut.js that is a folder is refused', () => {
    const root = makeProject(join(base(), 'blog'), { strut: false })
    mkdirSync(join(root, 'strut.js'))
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'strut-not-file' })
  })

  it('attack: a strut.js that links to a file outside the project is refused', (ctx) => {
    const top = base()
    const root = makeProject(join(top, 'blog'), { strut: false })
    write(join(top, 'evil.js'), reporter('evil'))
    if (!tryLinkFile(join(top, 'evil.js'), join(root, 'strut.js'))) {
      ctx.skip('this OS user may not create file symlinks (Windows without Developer Mode)')
    }
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'strut-not-file' })
  })

  it('attack: a project root that is a link (junction) is refused, naming the real folder', () => {
    const top = base()
    const real = makeProject(join(top, 'real-app'))
    const link = join(top, 'innocent-looking')
    linkDir(real, link)
    expect(resolveTarget(link)).toEqual({
      kind: 'refused',
      reason: 'root-is-link',
      path: link,
      realPath: realpathSync.native(real),
    })
  })

  it('a root that vanished is refused', () => {
    expect(resolveTarget(join(base(), 'gone'))).toMatchObject({
      kind: 'refused',
      reason: 'root-unreadable',
    })
  })
})

describe('resolveTarget: the framework program (no strut.js)', () => {
  it("runs the installed framework's strutvane bin", () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    const pkg = installFramework(root)
    expect(resolveTarget(root)).toEqual({
      kind: 'run',
      root,
      script: realpathSync.native(join(pkg, 'dist', 'console', 'bin.mjs')),
      via: 'framework',
    })
  })

  it('accepts a framework linked from inside the project (a file: dependency)', () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    const local = installFramework(root, {}, join(root, '.strutvane', 'local', 'framework'))
    linkDir(local, join(root, 'node_modules', '@strutvane', 'framework'))
    expect(resolveTarget(root)).toMatchObject({
      kind: 'run',
      via: 'framework',
      script: realpathSync.native(join(local, 'dist', 'console', 'bin.mjs')),
    })
  })

  it('says the dependencies are missing when the framework is not installed', () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-missing' })
  })

  it('attack: node_modules/@strutvane/framework linked to a folder outside the project', () => {
    const top = base()
    const root = makeProject(join(top, 'api'), { strut: false })
    const outside = installFramework(top, {}, join(top, 'elsewhere', 'framework'))
    linkDir(outside, join(root, 'node_modules', '@strutvane', 'framework'))
    expect(resolveTarget(root)).toMatchObject({
      kind: 'refused',
      reason: 'framework-outside-root',
    })
  })

  it('attack: node_modules itself linked outside the project', () => {
    const top = base()
    const root = makeProject(join(top, 'api'), { strut: false })
    installFramework(join(top, 'shared'))
    linkDir(join(top, 'shared', 'node_modules'), join(root, 'node_modules'))
    expect(resolveTarget(root)).toMatchObject({
      kind: 'refused',
      reason: 'framework-outside-root',
    })
  })

  it('attack: a package that is not @strutvane/framework is refused', () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    installFramework(root, { name: '@strutvane/framewerk' })
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-invalid' })
  })

  it('attack: a bin that climbs out of the package is refused', () => {
    for (const bin of ['../../../evil.js', '..\\..\\..\\evil.js', 'C:\\evil.js', '/evil.js']) {
      const top = base()
      const root = makeProject(join(top, 'api'), { strut: false })
      write(join(top, 'evil.js'), reporter('evil'))
      installFramework(root, { bin: { strutvane: bin } })
      expect(resolveTarget(root), bin).toMatchObject({
        kind: 'refused',
        reason: 'framework-invalid',
      })
    }
  })

  it('attack: a bin inside a folder that links outside the package is refused', () => {
    const top = base()
    const root = makeProject(join(top, 'api'), { strut: false })
    const pkg = join(root, 'node_modules', '@strutvane', 'framework')
    write(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@strutvane/framework', bin: 'out/x.mjs' }),
    )
    write(join(top, 'payload', 'x.mjs'), reporter('evil'))
    linkDir(join(top, 'payload'), join(pkg, 'out'))
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-invalid' })
  })

  it('refuses a bin that is missing, a folder, or not a script', () => {
    const cases: Array<Record<string, unknown>> = [
      { bin: { strutvane: 'dist/missing.mjs' } },
      { bin: { strutvane: 'dist' } },
      { bin: { strutvane: 'dist/console/bin' } },
      { bin: { other: 'dist/console/bin.mjs' } },
    ]
    for (const manifest of cases) {
      const root = makeProject(join(base(), 'api'), { strut: false })
      installFramework(root, manifest)
      expect(resolveTarget(root), JSON.stringify(manifest)).toMatchObject({
        kind: 'refused',
        reason: 'framework-invalid',
      })
    }
    const root = makeProject(join(base(), 'api'), { strut: false })
    installFramework(root, { bin: { strutvane: 'dist/dir.mjs' } })
    mkdirSync(join(root, 'node_modules', '@strutvane', 'framework', 'dist', 'dir.mjs'))
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-invalid' })
  })

  it('refuses a framework without a readable package.json', () => {
    const root = makeProject(join(base(), 'api'), { strut: false })
    mkdirSync(join(root, 'node_modules', '@strutvane', 'framework'), { recursive: true })
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-invalid' })
  })
})

// macOS: the temp folders are under `/var`, a link to `/private/var`, so a project's path can pass
// through a system link without the project root being one. Simulated here on every OS with a
// linked parent folder (a junction on Windows).
describe('resolveTarget: a project whose path passes through a linked parent folder', () => {
  it('runs strut.js; only the root itself being a link is refused', () => {
    const { link, real } = linkedParent(base())
    const root = makeProject(join(link, 'blog'))
    expect(resolveTarget(root)).toEqual({
      kind: 'run',
      root,
      script: join(real, 'blog', 'strut.js'),
      via: 'strut.js',
    })
  })

  it("runs the installed framework's program (its real path is inside the real root)", () => {
    const { link, real } = linkedParent(base())
    const root = makeProject(join(link, 'api'), { strut: false })
    installFramework(root)
    expect(resolveTarget(root)).toEqual({
      kind: 'run',
      root,
      script: join(
        real,
        'api',
        'node_modules',
        '@strutvane',
        'framework',
        'dist',
        'console',
        'bin.mjs',
      ),
      via: 'framework',
    })
  })

  it('attack: a root that is itself a link is still refused, below a linked parent too', () => {
    const { link, real } = linkedParent(base())
    makeProject(join(real, 'real-app'))
    const innocent = join(link, 'innocent-looking')
    linkDir(join(real, 'real-app'), innocent)
    expect(resolveTarget(innocent)).toEqual({
      kind: 'refused',
      reason: 'root-is-link',
      path: innocent,
      realPath: join(real, 'real-app'),
    })
  })

  it('attack: a framework linked outside the project is still refused', () => {
    const top = base()
    const { link } = linkedParent(top)
    const root = makeProject(join(link, 'api'), { strut: false })
    const outside = installFramework(top, {}, join(top, 'elsewhere', 'framework'))
    linkDir(outside, join(root, 'node_modules', '@strutvane', 'framework'))
    expect(resolveTarget(root)).toMatchObject({ kind: 'refused', reason: 'framework-outside-root' })
  })
})
