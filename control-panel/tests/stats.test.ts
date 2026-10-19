import { describe, expect, test } from 'claude-code/testing'

import { compact, emptyLedger, modelLabel, prune, record, replyOf, summarize } from '../hooks/stats'

// One assistant line as Claude Code writes it to a transcript.
function line(opts: { id: string; request?: string; model?: string; session?: string; at?: string; usage?: Record<string, number> }) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: opts.session ?? 'session-a',
    requestId: opts.request ?? `req-${opts.id}`,
    timestamp: opts.at ?? new Date(2026, 9, 18, 12, 0).toISOString(),
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-opus-5-5',
      usage: opts.usage ?? { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 },
    },
  })
}

const TODAY = '2026-10-18'

describe('stats', () => {
  test("reads a reply's model, day, conversation and tokens from a transcript line", () => {
    const reply = replyOf(line({ id: 'm1', at: new Date(2026, 9, 17, 23, 30).toISOString() }))
    expect(reply).toMatchObject({ model: 'claude-opus-5-5', day: '2026-10-17', session: 'session-a' })
    expect(reply?.counts).toEqual([1, 10, 100, 1000, 50])
  })

  test('ignores lines that are not replies: user turns, synthetic messages, broken JSON', () => {
    expect(replyOf(JSON.stringify({ type: 'user', message: { content: 'hi' } }))).toBeNull()
    expect(replyOf(line({ id: 'm2', model: '<synthetic>' }))).toBeNull()
    expect(replyOf('{"type":"assistant"')).toBeNull()
    expect(replyOf('')).toBeNull()
  })

  test('counts each reply once, even when a resumed conversation copies it into another transcript', () => {
    const ledger = emptyLedger()
    const reply = replyOf(line({ id: 'm1' }))
    const copy = replyOf(line({ id: 'm1', session: 'session-b' }))
    expect(reply && record(ledger, reply)).toBe(true)
    expect(copy && record(ledger, copy)).toBe(false)
    expect(summarize(ledger, { scope: 'all', period: 'all', session: '', today: TODAY }).replies).toBe(1)
  })

  test('sums a period: replies, conversations, input split three ways, output, total', () => {
    const ledger = emptyLedger()
    const add = (id: string, at: Date, session: string, model = 'claude-opus-5-5') => {
      const reply = replyOf(line({ id, at: at.toISOString(), session, model }))
      if (reply) record(ledger, reply)
    }
    add('a', new Date(2026, 9, 18, 9), 's1')
    add('b', new Date(2026, 9, 18, 10), 's2', 'claude-fable-5-1')
    add('c', new Date(2026, 9, 14, 10), 's3')
    add('d', new Date(2026, 8, 1, 10), 's4')

    const today = summarize(ledger, { scope: 'all', period: 'today', session: '', today: TODAY })
    expect([today.conversations, today.replies]).toEqual([2, 2])
    expect([today.fresh, today.cacheWrite, today.cacheRead, today.output]).toEqual([20, 200, 2000, 100])
    expect(today.input).toBe(2220)
    expect(today.total).toBe(2320)

    expect(summarize(ledger, { scope: 'all', period: '7d', session: '', today: TODAY }).replies).toBe(3)
    expect(summarize(ledger, { scope: 'all', period: '30d', session: '', today: TODAY }).replies).toBe(3)
    const all = summarize(ledger, { scope: 'all', period: 'all', session: '', today: TODAY })
    expect([all.replies, all.conversations, all.since]).toEqual([4, 4, '2026-09-01'])
  })

  test('this conversation counts only its own replies, whatever the period', () => {
    const ledger = emptyLedger()
    for (const [id, session] of [['a', 's1'], ['b', 's1'], ['c', 's2']] as const) {
      const reply = replyOf(line({ id, session }))
      if (reply) record(ledger, reply)
    }
    const mine = summarize(ledger, { scope: 'session', period: 'today', session: 's1', today: TODAY })
    expect([mine.conversations, mine.replies]).toEqual([1, 2])
  })

  test('ranks the models by output and keeps the top five', () => {
    const ledger = emptyLedger()
    const models = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
    models.forEach((model, i) => {
      const reply = replyOf(line({ id: `m${i}`, model, usage: { output_tokens: 600 - i * 100 } }))
      if (reply) record(ledger, reply)
    })
    const summary = summarize(ledger, { scope: 'all', period: 'all', session: '', today: TODAY })
    expect(summary.models.map(m => m.label)).toEqual(['Opus 5.5', 'Fable 5.1', 'Fable 5', 'Opus 5', 'Sonnet 5.5'])
    expect(summary.models[0]?.share).toBe(1)
    expect(summary.topModel).toBe('Opus 5.5')
  })

  test('forgets which replies it counted once they are old, keeping every total', () => {
    const ledger = emptyLedger()
    const old = replyOf(line({ id: 'old', at: new Date(2026, 5, 1, 10).toISOString() }))
    const recent = replyOf(line({ id: 'new', at: new Date(2026, 9, 17, 10).toISOString() }))
    if (old) record(ledger, old)
    if (recent) record(ledger, recent)
    prune(ledger, TODAY, 60)
    expect(Object.keys(ledger.seen)).toHaveLength(1)
    expect(summarize(ledger, { scope: 'all', period: 'all', session: '', today: TODAY }).replies).toBe(2)
  })

  test('names models and writes big numbers short', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-fable-5')).toBe('Fable 5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
    expect([compact(773), compact(7317), compact(46_000), compact(474_000), compact(7_317_317), compact(2_648_484_983)]).toEqual([
      '773',
      '7.32K',
      '46K',
      '474K',
      '7.32M',
      '2.65B',
    ])
  })
})
