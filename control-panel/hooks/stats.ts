import type { Period, Scope } from '../types'

// Token statistics from Claude Code's transcripts: each reply Claude writes is a line in a
// session's transcript carrying its model and token counts. They are counted once into a ledger
// of daily totals, which the panel keeps in a file of its own, so a transcript Claude Code later
// deletes takes nothing away.

/** A reply's numbers, in this order: replies (1), fresh input, cache written, cache read, output. */
export type Counts = [number, number, number, number, number]

/** One reply Claude wrote, as a transcript line records it. */
export type Reply = {
  /** The reply's identity across transcripts: a resumed conversation copies its replies. */
  key: string
  /** The local day it was written, `YYYY-MM-DD`. */
  day: string
  model: string
  session: string
  counts: Counts
}

/** How far the panel has read one transcript. */
export type FileMark = { size: number; mtimeMs: number; offset: number }

/** Everything counted so far: what the panel saves, and what its numbers are summed from. */
export type Ledger = {
  version: 1
  /** day → model → counts. */
  days: Record<string, Record<string, Counts>>
  /** day → the conversations that had a reply that day. */
  daySessions: Record<string, string[]>
  /** conversation → model → counts. */
  sessions: Record<string, Record<string, Counts>>
  /** reply key's hash → its day: what has been counted, kept for recent days only. */
  seen: Record<string, string>
  /** transcript path → how far it has been read. */
  files: Record<string, FileMark>
}

export function emptyLedger(): Ledger {
  return { version: 1, days: {}, daySessions: {}, sessions: {}, seen: {}, files: {} }
}

/** A saved ledger read back, or an empty one when the text is no ledger. */
export function ledgerOf(text: string | undefined): Ledger {
  if (text === undefined) return emptyLedger()
  try {
    const parsed = JSON.parse(text) as Partial<Ledger> | null
    if (parsed?.version !== 1) return emptyLedger()
    return { ...emptyLedger(), ...parsed }
  } catch {
    return emptyLedger()
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** A date's local day, `YYYY-MM-DD`. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayBefore(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayOf(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - days))
}

// Two 32-bit FNV-1a hashes with different seeds: a short, steady name for a reply's key.
function hashOf(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

/** The reply a transcript line records, or null for any other line. */
export function replyOf(text: string): Reply | null {
  // Most lines are not replies: skip them before parsing.
  if (!text.includes('"assistant"') || !text.includes('"usage"')) return null
  let entry: unknown
  try {
    entry = JSON.parse(text)
  } catch {
    return null
  }
  const e = entry as {
    type?: unknown
    sessionId?: unknown
    requestId?: unknown
    timestamp?: unknown
    message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> }
  }
  const usage = e.message?.usage
  const model = e.message?.model
  if (e.type !== 'assistant' || usage === undefined || typeof model !== 'string' || model.startsWith('<')) return null
  if (typeof e.timestamp !== 'string') return null
  const at = new Date(e.timestamp)
  if (Number.isNaN(at.getTime())) return null
  return {
    key: `${String(e.message?.id ?? '')}:${String(e.requestId ?? '')}`,
    day: dayOf(at),
    model,
    session: typeof e.sessionId === 'string' ? e.sessionId : '',
    counts: [
      1,
      num(usage['input_tokens']),
      num(usage['cache_creation_input_tokens']),
      num(usage['cache_read_input_tokens']),
      num(usage['output_tokens']),
    ],
  }
}

function addTo(target: Record<string, Counts>, model: string, counts: Counts) {
  const sum = target[model] ?? [0, 0, 0, 0, 0]
  for (let i = 0; i < 5; i++) sum[i] = (sum[i] ?? 0) + (counts[i] ?? 0)
  target[model] = sum
}

/** Counts a reply into the ledger: false when it was counted before, from another transcript. */
export function record(ledger: Ledger, reply: Reply): boolean {
  const hash = hashOf(reply.key)
  if (ledger.seen[hash] !== undefined) return false
  ledger.seen[hash] = reply.day
  addTo((ledger.days[reply.day] ??= {}), reply.model, reply.counts)
  const sessions = (ledger.daySessions[reply.day] ??= [])
  if (!sessions.includes(reply.session)) sessions.push(reply.session)
  addTo((ledger.sessions[reply.session] ??= {}), reply.model, reply.counts)
  return true
}

/**
 * Forgets which replies were counted before `keepDays` ago, keeping every total: a conversation
 * resumed from long ago is rare, and the list would otherwise grow without end.
 */
export function prune(ledger: Ledger, today: string, keepDays: number) {
  const oldest = dayBefore(today, keepDays)
  for (const [hash, day] of Object.entries(ledger.seen)) {
    if (day < oldest) delete ledger.seen[hash]
  }
}

export type ModelShare = { model: string; label: string; output: number; share: number }

export type Summary = {
  conversations: number
  replies: number
  fresh: number
  cacheWrite: number
  cacheRead: number
  /** Everything sent to the model: fresh, written to cache and read from cache. */
  input: number
  output: number
  total: number
  /** The top five models by output, `share` relative to the first. */
  models: ModelShare[]
  topModel: string | null
  /** The first day counted, in the period's span. */
  since: string | null
}

/** The numbers the Stats tab shows: one conversation, or every conversation over a period. */
export function summarize(
  ledger: Ledger,
  opts: { scope: Scope; period: Period; session: string; today: string },
): Summary {
  const byModel: Record<string, Counts> = {}
  const conversations = new Set<string>()
  let since: string | null = null

  if (opts.scope === 'session') {
    for (const [model, counts] of Object.entries(ledger.sessions[opts.session] ?? {})) addTo(byModel, model, counts)
    if (Object.keys(byModel).length > 0) conversations.add(opts.session)
  } else {
    const from =
      opts.period === 'today' ? opts.today : opts.period === '7d' ? dayBefore(opts.today, 6) : opts.period === '30d' ? dayBefore(opts.today, 29) : ''
    for (const [day, models] of Object.entries(ledger.days)) {
      if (day < from || day > opts.today) continue
      for (const [model, counts] of Object.entries(models)) addTo(byModel, model, counts)
      for (const session of ledger.daySessions[day] ?? []) conversations.add(session)
      if (since === null || day < since) since = day
    }
  }

  const total: Counts = [0, 0, 0, 0, 0]
  for (const counts of Object.values(byModel)) for (let i = 0; i < 5; i++) total[i] = (total[i] ?? 0) + (counts[i] ?? 0)
  const [replies, fresh, cacheWrite, cacheRead, output] = total
  const ranked = Object.entries(byModel)
    .map(([model, counts]) => ({ model, label: modelLabel(model), output: counts[4] }))
    .sort((a, b) => b.output - a.output)
    .slice(0, 5)
  const most = ranked[0]?.output ?? 0
  return {
    conversations: conversations.size,
    replies,
    fresh,
    cacheWrite,
    cacheRead,
    input: fresh + cacheWrite + cacheRead,
    output,
    total: fresh + cacheWrite + cacheRead + output,
    models: ranked.map(m => ({ ...m, share: most > 0 ? m.output / most : 0 })),
    topModel: ranked[0]?.label ?? null,
    since,
  }
}

/** A model's name as people say it: `claude-opus-5-5` is "Opus 5.5". */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model)
  if (match === null) return model
  const [, family = '', major, minor] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return minor === undefined ? `${name} ${major}` : `${name} ${major}.${minor}`
}

/** A count in three significant figures: 773, 7.32K, 46K, 2.65B. */
export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, unit] of units) {
    if (n >= size) {
      const value = n / size
      const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
      return `${Number(value.toFixed(digits))}${unit}`
    }
  }
  return String(n)
}
