// A password-reset link opens the new-password page wherever Supabase sends it, never the company.
import { describe, expect, it } from 'vitest'
import { isRecoveryLink, recoveryTarget } from './recoveryLink'

const hash = '#access_token=abc&expires_at=1&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'

describe('password-reset link', () => {
  it('is recognised in the address, and only for a reset', () => {
    expect(isRecoveryLink(hash, '')).toBe(true)
    expect(isRecoveryLink('', '?type=recovery&code=x')).toBe(true)
    expect(isRecoveryLink('#access_token=abc&type=signup', '')).toBe(false)
    expect(isRecoveryLink('#access_token=abc&type=invite', '')).toBe(false)
    expect(isRecoveryLink('', '')).toBe(false)
    expect(isRecoveryLink('#type=recoveryx', '')).toBe(false)
  })

  it('landing on the home page (the site address Supabase falls back to) goes to /reset, keeping the sign-in details', () => {
    expect(recoveryTarget({ pathname: '/', search: '', hash })).toBe(`/reset${hash}`)
    expect(recoveryTarget({ pathname: '/app', search: '?x=1', hash })).toBe(`/reset?x=1${hash}`)
    expect(recoveryTarget({ pathname: '/reset', search: '', hash })).toBeNull()
    expect(recoveryTarget({ pathname: '/', search: '', hash: '#access_token=abc&type=signup' })).toBeNull()
  })
})
