// Access rights, arranged by the owner or an admin from Setup → Access rights: what each role may see and do in each
// list, whether it posts and collects (finance) and sees costs. A change applies at once (to the live setup, and to the
// draft in the builder so publishing later doesn't undo it) and is written to the activity log.
import type { AppSchema, Permission, RoleDef } from './schema'
import { uid } from './schema'
import type { Workspace } from './types'
import { EngineError, logLedger, type Ctx } from './engine'

export const PERMS: Permission[] = ['view', 'create', 'edit', 'delete']

/** A list's rights as they may be stored: in order, and never "add" or "change" without "see". */
export function cleanPerms(input: unknown): Permission[] {
  const set = new Set((Array.isArray(input) ? input : []).filter((p): p is Permission => PERMS.includes(p as Permission)))
  if (set.size) set.add('view')
  return PERMS.filter((p) => set.has(p))
}

const live = (ws: Workspace): AppSchema => {
  if (!ws.published) throw new EngineError('Publish the system before arranging access')
  return ws.published
}

function cleanName(schema: AppSchema, name: unknown, id?: string) {
  const n = String(name ?? '').trim().slice(0, 60)
  if (!n) throw new EngineError('Give the role a name')
  if (schema.roles.some((r) => r.id !== id && r.name.trim().toLowerCase() === n.toLowerCase())) throw new EngineError(`There is already a role called “${n}”`)
  return n
}

/** Applies one role's change to the live setup and, when there is one, to the builder's draft. */
function apply(ws: Workspace, id: string, fn: (r: RoleDef, s: AppSchema) => void) {
  for (const s of [ws.published, ws.draft]) {
    if (!s) continue
    const r = s.roles.find((x) => x.id === id)
    if (r) fn(r, s)
  }
}

/** Saves a role's name, its rights in every list, and its finance and costs rights. The Admin role can't be limited. */
export function saveRole(ctx: Ctx, input: { id: string; name?: unknown; access?: unknown; finance?: unknown; costs?: unknown; pos?: unknown; payroll?: unknown }) {
  const schema = live(ctx.ws)
  const role = schema.roles.find((r) => r.id === input.id)
  if (!role) throw new EngineError('That role no longer exists')
  if (role.admin) throw new EngineError('The Admin role always has full access')
  const name = input.name === undefined ? role.name : cleanName(schema, input.name, role.id)
  const given = (input.access ?? {}) as Record<string, unknown>
  const finance = input.finance === undefined ? Boolean(role.finance) : input.finance === true
  const costs = input.costs === undefined ? Boolean(role.costs) : input.costs === true
  const pos = input.pos === undefined ? Boolean(role.pos) : input.pos === true
  const payroll = input.payroll === undefined ? Boolean(role.payroll) : input.payroll === true
  apply(ctx.ws, role.id, (r, s) => {
    r.name = name
    r.finance = finance || undefined
    r.costs = costs || undefined
    r.pos = pos || undefined
    // payroll's records are seen only by roles with the right (the server reads the role's lists to decide)
    r.payroll = payroll || undefined
    for (const k of ['payroll_people', 'payroll_runs']) { if (payroll) r.access[k] = ['view', 'create', 'edit']; else delete r.access[k] }
    // Only lists that exist in that setup; a list left out keeps what it had.
    for (const m of s.modules) if (m.id in given) r.access[m.id] = cleanPerms(given[m.id])
  })
  logLedger(ctx, `changed the access rights of the role “${name}”`)
}

/** A new role: empty, or a copy of another role's rights. Returns its id. */
export function addRole(ctx: Ctx, input: { name?: unknown; copyFrom?: unknown }) {
  const schema = live(ctx.ws)
  if (schema.roles.length >= 30) throw new EngineError('Up to 30 roles')
  const name = cleanName(schema, input.name)
  const from = typeof input.copyFrom === 'string' ? schema.roles.find((r) => r.id === input.copyFrom) : undefined
  const id = uid('role')
  for (const s of [ctx.ws.published, ctx.ws.draft]) {
    if (!s || s.roles.some((r) => r.id === id)) continue
    const src = from ? s.roles.find((r) => r.id === from.id) : undefined
    s.roles.push({
      id, name,
      // a copy of Admin is a role with every right in every list, but not Admin itself
      access: Object.fromEntries(s.modules.map((m) => [m.id, src?.admin ? [...PERMS] : [...(src?.access[m.id] ?? [])]])),
      ...(src?.finance || src?.admin ? { finance: true } : {}),
      ...(src?.costs ? { costs: true } : {}),
    })
  }
  logLedger(ctx, from ? `added the role “${name}” (a copy of “${from.name}”)` : `added the role “${name}”`)
  return id
}
/** Removes a role nobody has and no approval depends on. */
export function removeRole(ctx: Ctx, id: string) {
  const schema = live(ctx.ws)
  const role = schema.roles.find((r) => r.id === id)
  if (!role) throw new EngineError('That role no longer exists')
  if (role.admin) throw new EngineError('The Admin role can’t be removed')
  const people = ctx.ws.users.filter((u) => !u.former && u.roleId === id).length
  if (people) throw new EngineError(`Move the people who have this role (${people}) to another role first (on the Team page)`)
  if ((schema.approvals ?? []).some((a) => a.approverRole === id)) throw new EngineError('An approval rule is decided by this role: choose another approver first')
  for (const s of [ctx.ws.published, ctx.ws.draft]) if (s) s.roles = s.roles.filter((r) => r.id !== id)
  logLedger(ctx, `removed the role “${role.name}”`)
}
