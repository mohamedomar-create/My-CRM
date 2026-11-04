// The "ask" server function's logic: a question the app couldn't answer by itself goes to Claude with the company's
// figures (totals and periods, no names of people, no contact details), and the answer comes back in the same
// language. The Anthropic key is the function's secret (ANTHROPIC_API_KEY), set in Supabase, never in the code.
import { HttpError } from './commandServer'

export interface AskRequest { workspace: string; lang: 'en' | 'ar'; question: string; facts: unknown }
export interface AskDeps {
  member(workspace: string, email: string): Promise<boolean>
  ask: ((system: string, user: string) => Promise<string>) | null
  /** questions this person asked in the last hour (this one counted) */
  recent(email: string): number
}

const WS = /^ws_[a-z0-9]{6,40}$/

export function cleanAskRequest(input: unknown): AskRequest {
  const b = (input ?? {}) as Record<string, unknown>
  if (typeof b.workspace !== 'string' || !WS.test(b.workspace)) throw new HttpError(400, 'Bad request')
  const question = String(b.question ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (question.length < 3) throw new HttpError(400, 'Ask a question')
  const facts = JSON.stringify(b.facts ?? {})
  if (facts.length > 30_000) throw new HttpError(413, 'Too much to send')
  return { workspace: b.workspace, lang: b.lang === 'ar' ? 'ar' : 'en', question, facts: JSON.parse(facts) }
}

export const ASK_SYSTEM = `You are "Ask Nasq360", the assistant inside Nasq360, a CRM and ERP used by small and medium businesses in Egypt.
You get one question from the owner or a manager, and the company's figures as JSON: this month, last month and this year (sales, gross profit, expenses, net profit, the largest expenses), cash now and the lowest point of the next 13 weeks, what customers owe and what is overdue, what is owed to suppliers, how many products need reordering, and alerts.
Answer the question in at most 120 words:
- Use only these figures. If they don't answer the question, say what you can tell from them and which page of the app shows the rest (Accounting, Stock, Customers, the cash forecast).
- Lead with the answer and the key number, then one or two short explanations or a suggestion.
- Amounts as digits with the currency. No headings, no tables, no invented numbers, names or causes.
- Write in the language requested. In Arabic use clear Modern Standard Arabic suitable for Egypt.`

export async function handleAsk(deps: AskDeps, email: string, body: unknown): Promise<{ answer: string }> {
  const r = cleanAskRequest(body)
  if (!(await deps.member(r.workspace, email.toLowerCase()))) throw new HttpError(403, 'You are not a member of this company')
  if (!deps.ask) throw new HttpError(503, 'The AI isn’t switched on yet: an admin adds the Anthropic key to the server settings.')
  if (deps.recent(email.toLowerCase()) > 60) throw new HttpError(429, 'That is a lot of questions for one hour. Try again a little later.')
  const answer = (await deps.ask(ASK_SYSTEM, JSON.stringify({ language: r.lang === 'ar' ? 'Arabic' : 'English', question: r.question, figures: r.facts }))).trim()
  if (!answer) throw new HttpError(502, 'The AI gave no answer. Try again in a moment.')
  return { answer }
}
