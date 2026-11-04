// The "doctor" server function's logic: a signed-in member of a company sends the check-up's findings (plain words and
// numbers, no names or contact details) and gets back a short, prioritised action plan written by Claude, in English
// or Arabic. The Anthropic key is the function's secret (ANTHROPIC_API_KEY), set in Supabase, never in the code.
import { HttpError } from './commandServer'

export interface DoctorFinding { severity: 'urgent' | 'important' | 'tip'; area: string; finding: string; count: number; amount?: number }
export interface DoctorRequest { workspace: string; lang: 'en' | 'ar'; currency: string; industry?: string; score: number; findings: DoctorFinding[] }
export interface DoctorDeps {
  /** whether this e-mail belongs to the company */
  member(workspace: string, email: string): Promise<boolean>
  /** asks Claude; null when no key is set */
  ask: ((system: string, user: string) => Promise<string>) | null
  /** how many plans this person asked for in the last hour (and counts this one) */
  recent(email: string): number
}

const WS = /^ws_[a-z0-9]{6,40}$/
const SEV = ['urgent', 'important', 'tip']

/** The request as it may be trusted: known keys, short texts, at most 40 findings. */
export function cleanDoctorRequest(input: unknown): DoctorRequest {
  const b = (input ?? {}) as Record<string, unknown>
  if (typeof b.workspace !== 'string' || !WS.test(b.workspace)) throw new HttpError(400, 'Bad request')
  const findings = (Array.isArray(b.findings) ? b.findings : []).slice(0, 40).map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>
    return {
      severity: (SEV.includes(String(f.severity)) ? f.severity : 'tip') as DoctorFinding['severity'],
      area: String(f.area ?? '').slice(0, 20),
      finding: String(f.finding ?? '').slice(0, 300),
      count: Math.max(0, Math.round(Number(f.count) || 0)),
      ...(Number.isFinite(Number(f.amount)) && Number(f.amount) ? { amount: Math.round(Number(f.amount) * 100) / 100 } : {}),
    }
  }).filter((f) => f.finding)
  return {
    workspace: b.workspace,
    lang: b.lang === 'ar' ? 'ar' : 'en',
    currency: String(b.currency ?? 'EGP').slice(0, 5),
    industry: b.industry ? String(b.industry).slice(0, 60) : undefined,
    score: Math.max(0, Math.min(100, Math.round(Number(b.score) || 0))),
    findings,
  }
}

export const DOCTOR_SYSTEM = `You are the "company doctor" inside Nasq360, a CRM and ERP used by small and medium businesses in Egypt.
You receive the results of an automatic check-up of one company: findings with a severity (urgent, important, tip), the area of the business, how many records are involved and sometimes an amount of money.
Write a short action plan for the owner:
- Start with one sentence on the overall state of the company, using the score out of 100.
- Then at most 5 numbered actions, most valuable first: what to do, why it matters in money or risk, and who should usually do it (owner, accountant, sales, warehouse).
- Group findings that share a cause into one action. Do not repeat every finding.
- Use only the facts given. Do not invent numbers, names or causes; say "check" when a cause is unsure.
- Plain, warm, direct language a busy shop owner understands. No jargon, no headings, no tables. Under 220 words.
- Write in the language requested. In Arabic use clear Modern Standard Arabic suitable for Egypt, and keep amounts as digits with the currency.`

export function doctorPrompt(r: DoctorRequest) {
  return JSON.stringify({ language: r.lang === 'ar' ? 'Arabic' : 'English', currency: r.currency, industry: r.industry, score: r.score, findings: r.findings })
}

export async function handleDoctor(deps: DoctorDeps, email: string, body: unknown): Promise<{ plan: string }> {
  const r = cleanDoctorRequest(body)
  if (!(await deps.member(r.workspace, email.toLowerCase()))) throw new HttpError(403, 'You are not a member of this company')
  if (!deps.ask) throw new HttpError(503, 'AI explanations aren’t switched on yet: an admin adds the Anthropic key to the server settings.')
  if (deps.recent(email.toLowerCase()) > 20) throw new HttpError(429, 'That is a lot of plans for one hour. Try again a little later.')
  if (!r.findings.length) return { plan: r.lang === 'ar' ? 'لم يجد الفحص أي مشكلة. استمر في العمل كما أنت، وأعد الفحص بعد أسبوع.' : 'The check-up found nothing wrong. Keep going as you are, and check again next week.' }
  const plan = (await deps.ask(DOCTOR_SYSTEM, doctorPrompt(r))).trim()
  if (!plan) throw new HttpError(502, 'The AI gave no answer. Try again in a moment.')
  return { plan }
}
