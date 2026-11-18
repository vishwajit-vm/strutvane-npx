import { describe, expect, it } from 'vitest'
import {
  createCommand,
  printable,
  refusalText,
  releaseTag,
  startFailedText,
  untrustedText,
  versionText,
} from '../src/messages.ts'
import type { RefusalReason } from '../src/target.ts'

describe('printable', () => {
  it('removes control characters and caps the length', () => {
    expect(printable('a\u001b[31mb\r\nc\u009bd')).toBe('a[31mbcd')
    expect(printable('x'.repeat(500), 10)).toBe(`${'x'.repeat(9)}…`)
    expect(printable('short')).toBe('short')
  })
})

describe('releaseTag and createCommand', () => {
  it('names next for a pre-release and latest for a release', () => {
    expect(releaseTag('0.2.0-next.0')).toBe('next')
    expect(releaseTag('1.2.3')).toBe('latest')
    expect(createCommand('1.2.3')).toBe('npm create strutvane@latest my-app')
    expect(createCommand('0.2.0-next.3', 'shop')).toBe('npm create strutvane@next shop')
  })
})

describe('messages', () => {
  it('every refusal names the path and is a single safe block of text', () => {
    const reasons: RefusalReason[] = [
      'root-unreadable',
      'root-is-link',
      'strut-not-file',
      'strut-outside-root',
      'framework-missing',
      'framework-outside-root',
      'framework-invalid',
    ]
    for (const reason of reasons) {
      const text = refusalText(reason, '/srv/app\u001b[2J', '/real\u0007')
      expect(text, reason).toContain('/srv/app')
      expect(text, reason).not.toContain('\u001b')
      expect(text, reason).not.toContain('\u0007')
    }
    expect(refusalText('root-is-link', '/a')).not.toContain('a link to')
  })

  it('untrusted folders explain the reason', () => {
    expect(untrustedText('/x', 'not-owned')).toContain('belongs to another user')
    expect(untrustedText('/x', 'strut-without-framework')).toContain('does not list')
  })

  it('versions and errors from outside are sanitized', () => {
    expect(versionText('1.0.0\u001b[2J')).toBe('strutvane 1.0.0[2J')
    expect(startFailedText('/a\nb', 'boom\r')).toBe('strutvane: could not start /ab: boom')
  })
})
