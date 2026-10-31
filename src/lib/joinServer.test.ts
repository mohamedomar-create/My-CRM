// Joining from an invitation link: the login is created only for an open invitation, and never left behind half-done.
import { describe, expect, it } from 'vitest'
import { handleJoin, type JoinDeps } from './joinServer'

const TOKEN = 'a'.repeat(64)

function deps(status = 'open', opts: { exists?: boolean; confirmed?: boolean; acceptFails?: boolean } = {}) {
  const log: string[] = []
  const d: JoinDeps = {
    invitation: async (t) => (t === TOKEN ? { email: 'new@co.eg', status } : null),
    createUser: async (email) => (opts.exists ? 'exists' : (log.push(`create ${email}`), { id: 'u1' })),
    findUser: async () => (opts.exists ? { id: 'old', confirmed: opts.confirmed ?? true } : null),
    confirmUser: async (id) => void log.push(`confirm ${id}`),
    deleteUser: async (id) => void log.push(`delete ${id}`),
    accept: async () => {
      if (opts.acceptFails) throw new Error('This invitation was already used or cancelled.')
      log.push('accept')
    },
  }
  return { d, log }
}

const ask = { token: TOKEN, name: 'Karim', password: 'long enough pw' }

describe('joining from an invitation link', () => {
  it('creates the login for the invited e-mail and accepts the invitation', async () => {
    const { d, log } = deps()
    expect(await handleJoin(d, ask)).toEqual({ email: 'new@co.eg' })
    expect(log).toEqual(['create new@co.eg', 'accept'])
  })

  it('refuses links that are not open, and creates nothing', async () => {
    for (const status of ['accepted', 'declined', 'cancelled', 'expired']) {
      const { d, log } = deps(status)
      await expect(handleJoin(d, ask)).rejects.toMatchObject({ status: 410 })
      expect(log).toEqual([])
    }
    const { d } = deps()
    await expect(handleJoin(d, { ...ask, token: 'b'.repeat(64) })).rejects.toMatchObject({ status: 404 })
    await expect(handleJoin(d, { ...ask, token: 'not a token' })).rejects.toMatchObject({ status: 400 })
  })

  it('never touches a confirmed login: its owner signs in instead', async () => {
    const { d, log } = deps('open', { exists: true, confirmed: true })
    await expect(handleJoin(d, ask)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Sign in/) })
    expect(log).toEqual([])
  })

  it('finishes a login whose confirmation e-mail never arrived', async () => {
    const { d, log } = deps('open', { exists: true, confirmed: false })
    expect(await handleJoin(d, ask)).toEqual({ email: 'new@co.eg' })
    expect(log).toEqual(['confirm old', 'accept'])
  })

  it('removes the new login again if the invitation could not be accepted', async () => {
    const { d, log } = deps('open', { acceptFails: true })
    await expect(handleJoin(d, ask)).rejects.toMatchObject({ status: 409 })
    expect(log).toEqual(['create new@co.eg', 'delete u1'])
  })

  it('checks the password and name before anything else', async () => {
    const { d, log } = deps()
    await expect(handleJoin(d, { ...ask, password: 'short' })).rejects.toMatchObject({ status: 400 })
    await expect(handleJoin(d, { ...ask, name: ' ' })).rejects.toMatchObject({ status: 400 })
    expect(log).toEqual([])
  })
})
