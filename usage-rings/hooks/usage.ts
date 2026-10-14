import type { McpToolResult, SessionRateLimit } from 'claude-code'

import type { Limits, Reading } from '../types'

export type Ring = keyof Limits
export type Entry = { ring: Ring; reading: Reading }
export type Level = 'none' | 'low' | 'mid' | 'high'

export const EMPTY: Limits = { fiveHour: null, weekly: null, fable: null }

export const RINGS: readonly { ring: Ring; label: string }[] = [
  { ring: 'fiveHour', label: '5-hour' },
  { ring: 'weekly', label: 'Weekly' },
  { ring: 'fable', label: 'Fable' },
]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// The engine names windows after the API's rate-limit kinds (`five_hour`, `seven_day`,
// `seven_day_fable`); the app's usage card labels them ("5-hour limit", "Weekly · Fable").
// Fable is checked first because its label also says "Weekly".
export function ringOf(name: string): Ring | null {
  const n = name.toLowerCase()
  if (n.includes('fable')) return 'fable'
  if (n === 'five_hour' || n.includes('5-hour')) return 'fiveHour'
  if (n === 'seven_day' || n.includes('all models')) return 'weekly'
  return null
}

export function readingOf(percent: number, resetsAt: string | undefined): Reading {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  return { percent, resetsAt: Number.isFinite(at) ? at : null }
}

export function fromEngine(rateLimits: readonly SessionRateLimit[]): Entry[] {
  const entries: Entry[] = []
  for (const limit of rateLimits) {
    const ring = ringOf(limit.kind)
    if (ring !== null) entries.push({ ring, reading: readingOf(limit.percentUsed, limit.resetsAt) })
  }
  return entries
}

type AppWindow = { label?: unknown; percentUsed?: unknown; resetsAt?: unknown }

// The desktop app's get_usage tool answers JSON in a text block:
// { plan: { status: "ok", windows: [{ label, percentUsed, resetsAt }] } }.
export function fromApp(result: McpToolResult): Entry[] {
  if (result.isError) return []
  const data = result.structuredContent ?? parseText(result)
  const plan = (data as { plan?: { status?: unknown; windows?: unknown } } | undefined)?.plan
  if (plan?.status !== 'ok' || !Array.isArray(plan.windows)) return []

  const entries: Entry[] = []
  for (const window of plan.windows as AppWindow[]) {
    if (typeof window.label !== 'string' || typeof window.percentUsed !== 'number') continue
    const ring = ringOf(window.label)
    const resetsAt = typeof window.resetsAt === 'string' ? window.resetsAt : undefined
    if (ring !== null) entries.push({ ring, reading: readingOf(window.percentUsed, resetsAt) })
  }
  return entries
}

function parseText(result: McpToolResult): unknown {
  const text = result.content.find(block => block.type === 'text')?.text
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Both sources report the same window at slightly different moments. Within one window usage
// only grows, so the higher figure is the fresher one; a later reset time is a new window.
export function merge(prev: Reading | null, next: Reading, now: number): Reading {
  if (prev === null) return next
  if (prev.resetsAt !== null && prev.resetsAt <= now) return next
  if (prev.resetsAt === null || next.resetsAt === null) return next
  if (next.resetsAt > prev.resetsAt + MINUTE) return next
  if (next.resetsAt < prev.resetsAt - MINUTE) return prev
  return next.percent >= prev.percent ? next : prev
}

export function mergeAll(limits: Limits, entries: readonly Entry[], now: number): Limits {
  const merged = { ...limits }
  for (const { ring, reading } of entries) merged[ring] = merge(merged[ring], reading, now)
  return merged
}

/** The percent to draw: 0 once the window has reset, null with no reading yet. */
export function shownPercent(reading: Reading | null, now: number): number | null {
  if (reading === null) return null
  if (reading.resetsAt !== null && reading.resetsAt <= now) return 0
  return Math.max(0, Math.min(100, reading.percent))
}

export function levelOf(percent: number | null): Level {
  if (percent === null) return 'none'
  if (percent >= 80) return 'high'
  if (percent >= 50) return 'mid'
  return 'low'
}

/** Time until the window resets ("4h 59m"); empty with no reading or no reset time. */
export function timeLeft(reading: Reading | null, now: number): string {
  if (reading === null || reading.resetsAt === null) return ''
  const ms = reading.resetsAt - now
  if (ms <= 0) return 'reset'
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h ${Math.floor((ms % HOUR) / MINUTE)}m`
  return `${Math.max(1, Math.ceil(ms / MINUTE))}m`
}

// A quarter-step circle glyph for the terminal, which has no Svg.
export function glyphOf(percent: number | null): string {
  if (percent === null || percent < 12.5) return '○'
  if (percent < 37.5) return '◔'
  if (percent < 62.5) return '◑'
  if (percent < 87.5) return '◕'
  return '●'
}

const SVG_COLORS: Record<Level, string> = {
  none: '#8a8a8a',
  low: '#2fa36b',
  mid: '#d99a00',
  high: '#e5484d',
}

// Drawn as an image, so it can't follow the page's theme: the track is a translucent grey and
// the arc and number use mid-tone colors that read on both light and dark backgrounds.
export function ringSvg(percent: number | null): string {
  const color = SVG_COLORS[levelOf(percent)]
  const value = percent ?? 0
  const label = percent === null ? '–' : `${Math.round(percent)}%`
  // Drawn at about 30px, so the number takes most of the ring to stay readable; "100%" needs
  // a smaller size to fit inside the track.
  const fontSize = label.length > 3 ? 12 : 14
  const arc =
    value > 0
      ? `<circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${value} 100" transform="rotate(-90 20 20)"/>`
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">` +
    `<circle cx="20" cy="20" r="18" fill="none" stroke="#8a8a8a" stroke-opacity="0.3" stroke-width="3.5"/>` +
    arc +
    `<text x="20" y="20" text-anchor="middle" dominant-baseline="central" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="700" fill="${color}">${label}</text>` +
    `</svg>`
  )
}
