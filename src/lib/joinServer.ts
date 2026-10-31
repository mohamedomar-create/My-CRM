// The server side of joining from an invitation link, kept free of Deno and Supabase so it is tested like the rest.
// Opening a valid invitation proves the person received it, so their login is created already confirmed and no
// confirmation e-mail is needed. supabase/functions/join wraps it with the real database and auth.
import { HttpError } from './commandServer'

export interface JoinRequest {
  token: string
  name: string
  password: string
}

export interface JoinDeps {
  /** the invitation the link is for (looked up by the hash of its secret) */
  invitation: (token: string) => Promise<{ email: string; status: string } | null>
  /** creates a confirmed login; 'exists' if the e-mail already has one */
  createUser: (email: string, password: string, name: string) => Promise<{ id: string } | 'exists'>
  /** the login that already uses this e-mail, and whether its e-mail was ever confirmed */
  findUser: (email: string) => Promise<{ id: string; confirmed: boolean } | null>
  /** confirms a login that never got its confirmation e-mail, with the password chosen now */
  confirmUser: (id: string, password: string, name: string) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  /** accepts the invitation (makes the person a member); throws if it can't */
  accept: (token: string) => Promise<void>
}

const PROBLEM: Record<string, string> = {
  accepted: 'This invitation was already accepted. Sign in to open the company.',
  declined: 'This invitation was declined. Ask your admin for a new one.',
  cancelled: 'This invitation was cancelled or replaced by a newer one. Ask your admin for a new link.',
  expired: 'This invitation has expired. Ask your admin for a new link.',
}

/** Creates the invited person's login and makes them a member, all or nothing. Returns the e-mail to sign in with. */
export async function handleJoin(deps: JoinDeps, req: JoinRequest): Promise<{ email: string }> {
  const token = typeof req?.token === 'string' ? req.token : ''
  const password = typeof req?.password === 'string' ? req.password : ''
  const name = typeof req?.name === 'string' ? req.name.trim().slice(0, 100) : ''
  if (!/^[a-f0-9]{32,128}$/.test(token)) throw new HttpError(400, 'This invitation link is not valid. Check that you copied all of it.')
  if (password.length < 10 || password.length > 200) throw new HttpError(400, 'Use at least 10 characters for the password')
  if (name.length < 2) throw new HttpError(400, 'Enter your name')

  const invite = await deps.invitation(token)
  if (!invite) throw new HttpError(404, 'This invitation link is not valid. Check that you copied all of it, or ask your admin for a new one.')
  if (invite.status !== 'open') throw new HttpError(410, PROBLEM[invite.status] ?? 'This invitation can no longer be used.')

  const created = await deps.createUser(invite.email, password, name)
  if (created === 'exists') {
    // A login that was never confirmed (its confirmation e-mail didn't arrive) is finished with this link, which
    // proves the e-mail is theirs. A confirmed login is never touched: its owner signs in to accept.
    const existing = await deps.findUser(invite.email)
    if (!existing || existing.confirmed) throw new HttpError(409, 'You already have a login with this e-mail. Sign in to accept the invitation.')
    await deps.confirmUser(existing.id, password, name)
    await deps.accept(token).catch((e: Error) => { throw e instanceof HttpError ? e : new HttpError(409, e.message) })
    return { email: invite.email }
  }
  try {
    await deps.accept(token)
  } catch (e) {
    // Don't leave a login behind that belongs to no company.
    await deps.deleteUser(created.id).catch(() => undefined)
    throw e instanceof HttpError ? e : new HttpError(409, (e as Error).message)
  }
  return { email: invite.email }
}
