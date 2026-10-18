import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeKey } from 'claude-code'

import type { Entry, Level } from './usage'
import {
  EMPTY,
  RINGS,
  fromApp,
  fromEngine,
  glyphOf,
  levelOf,
  mergeAll,
  ringColor,
  ringSvg,
  shownPercent,
  timeLeft,
} from './usage'

const limits = atom({ plugin: 'usage-rings', key: 'limits' } as const, EMPTY)
// Bumped once a minute so the reset countdowns redraw.
const tick = atom({ plugin: 'usage-rings', key: 'tick' } as const, 0)

// The desktop app's own MCP server; its usage card is the only source of the Fable weekly
// window when the API's rate-limit headers don't carry it. Absent in a plain terminal.
const APP_SERVER = 'ccd_session_mgmt'
const APP_TOOL = 'get_usage'

const MINUTE = 60_000
const APP_POLL_MS = 2 * MINUTE
const APP_POLL_AFTER_TURN_MS = 30_000

const THEME: Record<Level, ThemeKey> = {
  none: 'inactive',
  low: 'success',
  mid: 'warning',
  high: 'error',
}

// Module variables are fine here: a hot reload starts them over and the first refresh polls anyway.
let lastAppPoll = -Infinity
let hadTurnSincePoll = false

async function take($: EngineInterface, entries: Entry[]) {
  if (entries.length === 0) return
  const now = await $.clock.now()
  await update($, limits, prev => mergeAll(prev ?? EMPTY, entries, now))
}

async function pollEngine($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  await take($, fromEngine(rateLimits))
}

async function pollApp($: EngineInterface) {
  lastAppPoll = await $.clock.now()
  hadTurnSincePoll = false
  await take($, fromApp(await $.mcp.call(APP_SERVER, APP_TOOL)))
}

async function refresh($: EngineInterface, isFirst: boolean) {
  const now = await $.clock.now()
  const wait = hadTurnSincePoll ? APP_POLL_AFTER_TURN_MS : APP_POLL_MS
  const polls = [pollEngine($)]
  if (isFirst || now - lastAppPoll >= wait) polls.push(pollApp($))
  await Promise.allSettled(polls)
  await update($, tick, n => (n ?? 0) + 1)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.after(1, () => void refresh($, true))
    $.clock.every(MINUTE, () => void refresh($, false))
    $.ui.invalidate('ui.render')
    return started
  })

  // Pushed by the engine whenever a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await take($, fromEngine(e.rateLimits))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    hadTurnSincePoll = true
    return next(e)
  })

  // The band is one site that other mods may draw in too (the control panel's pill, say): the
  // rings take the left, and whatever the mods beneath drew fills the rest of the row. The
  // engine's own answer there is its empty band, which draws nothing, so it is left out.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const below = await next(e)
    const others = below.type === 'engine' ? null : below

    const current = await read($, limits)
    await read($, tick)
    const now = await $.clock.now()
    const rings = RINGS.map(({ ring, label, short }) => {
      const reading = current[ring]
      const percent = shownPercent(reading, now)
      return { ring, label, short, percent, left: timeLeft(reading, now) }
    })

    let drawn
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      drawn = (
        <Box key="usage-rings" flexDirection="row" flexWrap="wrap" columnGap={3}>
          {rings.map(r => (
            <Box key={r.ring} flexDirection="row" columnGap={1}>
              <Text color={THEME[levelOf(r.percent)]} bold>
                {glyphOf(r.percent)} {r.percent === null ? '–' : `${Math.round(r.percent)}%`}
              </Text>
              <Text>{r.label}</Text>
              {r.left !== '' && <Text dimColor>{r.left}</Text>}
            </Box>
          ))}
        </Box>
      )
    } else {
      const { Box, Svg, Text } = $.ui.resolve(e)
      drawn = (
        <Box key="usage-rings" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm">
          {rings.map(r => {
            const used = r.percent === null ? 'no reading yet' : `${Math.round(r.percent)}% used`
            const title = `${r.label}: ${used}${r.left === '' ? '' : `, resets in ${r.left}`}`
            return (
              <Box key={r.ring} flexDirection="row" alignItems="center" columnGap="xs">
                <Svg source={ringSvg(r.percent, title)} alt={`${r.label}: ${used}`} width={14} height={14} isInteractive />
                <Text size="footnote" weight="semibold" color={ringColor(r.percent)}>
                  {r.percent === null ? '–' : `${Math.round(r.percent)}%`}
                </Text>
                <Text size="footnote" weight="semibold">{r.short}</Text>
                {r.left !== '' && <Text size="footnote" dimColor>{r.left}</Text>}
              </Box>
            )
          })}
        </Box>
      )
    }

    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center">
        {drawn}
        {others !== null && (
          <Box flexGrow={1} flexDirection="row" marginLeft={e.surface === 'terminal' ? 3 : 'md'}>
            {others}
          </Box>
        )}
      </Box>
    )
  })
}
