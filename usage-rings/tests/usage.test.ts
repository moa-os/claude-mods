import { describe, expect, test } from 'claude-code/testing'

import { fromApp, fromEngine, merge, ringOf, shownPercent, timeLeft } from '../hooks/usage'

const NOW = Date.parse('2026-10-13T14:00:00Z')
const HOUR = 3_600_000

describe('usage', () => {
  test('names the engine kinds and the app labels', () => {
    expect(ringOf('five_hour')).toBe('fiveHour')
    expect(ringOf('seven_day')).toBe('weekly')
    expect(ringOf('seven_day_fable')).toBe('fable')
    expect(ringOf('seven_day_opus')).toBe(null)
    expect(ringOf('5-hour limit')).toBe('fiveHour')
    expect(ringOf('Weekly · all models')).toBe('weekly')
    expect(ringOf('Weekly · Fable')).toBe('fable')
  })

  test('reads the app usage card', () => {
    const card = {
      plan: {
        status: 'ok',
        windows: [
          { label: '5-hour limit', percentUsed: 12, resetsAt: '2026-10-13T18:49:59.560Z' },
          { label: 'Weekly · all models', percentUsed: 41, resetsAt: '2026-10-20T12:59:59.560Z' },
          { label: 'Weekly · Fable', percentUsed: 63, resetsAt: '2026-10-20T13:00:00.000Z' },
        ],
      },
    }
    const entries = fromApp({ content: [{ type: 'text', text: JSON.stringify(card) }], isError: false })
    expect(entries.map(e => [e.ring, e.reading.percent])).toEqual([
      ['fiveHour', 12],
      ['weekly', 41],
      ['fable', 63],
    ])
    expect(entries[2]?.reading.resetsAt).toBe(Date.parse('2026-10-20T13:00:00.000Z'))
  })

  test('ignores an unavailable or broken card', () => {
    const unavailable = JSON.stringify({ plan: { status: 'unavailable' } })
    expect(fromApp({ content: [{ type: 'text', text: unavailable }], isError: false })).toEqual([])
    expect(fromApp({ content: [{ type: 'text', text: 'not json' }], isError: false })).toEqual([])
    expect(fromApp({ content: [], isError: true })).toEqual([])
  })

  test('reads the engine rate limits', () => {
    const entries = fromEngine([
      { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-13T18:00:00Z' },
      { kind: 'spend_limit', percentUsed: 5 },
    ])
    expect(entries).toEqual([
      { ring: 'fiveHour', reading: { percent: 23.5, resetsAt: Date.parse('2026-10-13T18:00:00Z') } },
    ])
  })

  test('keeps the higher figure within a window and takes a new window', () => {
    const resets = NOW + 4 * HOUR
    const prev = { percent: 30, resetsAt: resets }
    expect(merge(prev, { percent: 28, resetsAt: resets + 500 }, NOW)).toBe(prev)
    expect(merge(prev, { percent: 31, resetsAt: resets }, NOW).percent).toBe(31)
    const next = { percent: 2, resetsAt: resets + 5 * HOUR }
    expect(merge(prev, next, NOW)).toBe(next)
    expect(merge(next, prev, NOW)).toBe(next)
    const expired = { percent: 90, resetsAt: NOW - 1 }
    expect(merge(expired, { percent: 1, resetsAt: NOW + HOUR }, NOW).percent).toBe(1)
  })

  test('shows 0 after a reset and counts down to it', () => {
    expect(shownPercent(null, NOW)).toBe(null)
    expect(shownPercent({ percent: 70, resetsAt: NOW - 1 }, NOW)).toBe(0)
    expect(timeLeft({ percent: 1, resetsAt: NOW + 6 * 24 * HOUR + 23 * HOUR + 59_000 }, NOW)).toBe('6d 23h')
    expect(timeLeft({ percent: 1, resetsAt: NOW + 4 * HOUR + 59 * 60_000 }, NOW)).toBe('4h 59m')
    expect(timeLeft({ percent: 1, resetsAt: NOW + 30_000 }, NOW)).toBe('1m')
    expect(timeLeft(null, NOW)).toBe('')
  })
})
