import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Period, Scope, Tab } from '../types'
import {
  DAY_COLORS,
  PILL_HEIGHT,
  STRIP_HEIGHT,
  TILE_SIZE,
  accountNameOf,
  barSvg,
  cardSvg,
  chipSvg,
  chipWidth,
  dateLabel,
  dayIconSvg,
  displayName,
  greetingOf,
  hairlineSvg,
  launchablesOf,
  partOfDay,
  pillSvg,
  pillWidth,
  shortDay,
  stripSvg,
  tileSvg,
  titleOf,
  underlineSvg,
} from './panel'
import { claudeFolder, countTranscripts, loadLedger } from './scan'
import type { Ledger } from './stats'
import { compact, dayOf, summarize } from './stats'

const PANE = 'control-panel'
const COMMAND = 'cp'
const MINUTE = 60_000

// The panel's choices: which tab, and on the Stats tab which conversations over which days.
const tab = atom({ plugin: 'control-panel', key: 'tab' } as const, 'mods' as Tab)
const scope = atom({ plugin: 'control-panel', key: 'scope' } as const, 'all' as Scope)
const period = atom({ plugin: 'control-panel', key: 'period' } as const, 'all' as Period)

const TABS: readonly { id: Tab; label: string; hotkey: string }[] = [
  { id: 'mods', label: 'Mods', hotkey: '1' },
  { id: 'stats', label: 'Stats', hotkey: '2' },
]
const SCOPES: readonly { id: Scope; label: string }[] = [
  { id: 'session', label: 'This conversation' },
  { id: 'all', label: 'All conversations' },
]
const PERIODS: readonly { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
]

// The height of a stat card's face, in CSS pixels.
const CARD_HEIGHT = 76

// The terminal's stand-ins for the strip's icons.
const DAY_GLYPH = { morning: '☀', afternoon: '☀', evening: '☾', night: '☾' } as const

// The Claude account's name, read once a load: Claude Code's config file can be large.
let accountName: string | undefined

// What the Stats tab counts: the ledger in memory (saved to a file of its own as it fills), the
// count running now if any, how far it has got, and when the last one finished.
let ledger: Ledger | null = null
let counting: Promise<void> | null = null
let progress = { done: 0, total: 0 }
let countedAt: number | null = null

// Claude Code keeps the signed-in account in `.claude.json`, in CLAUDE_CONFIG_DIR when set, else
// in the home folder: HOME on macOS and Linux, USERPROFILE on Windows.
async function readAccountName($: EngineInterface): Promise<string | undefined> {
  const folder = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  if (folder === undefined) return undefined
  try {
    return accountNameOf(await $.fs.read(`${folder}/.claude.json`))
  } catch {
    return undefined
  }
}

// The name the panel is titled with: the Claude account's, else the login name, capitalised
// (USER on macOS and Linux, USERNAME on Windows).
async function nameOf($: EngineInterface): Promise<string> {
  const account = accountName ?? (await readAccountName($))
  if (account !== undefined) return account
  return displayName((await $.env.get('USER')) ?? (await $.env.get('USERNAME')))
}

async function timeOf($: EngineInterface) {
  const date = new Date(await $.clock.now())
  return { date, part: partOfDay(date.getHours()) }
}

async function openPanel($: EngineInterface) {
  await $.ui.open({ id: PANE, title: titleOf(await nameOf($)), focus: true })
}

async function launch($: EngineInterface, command: string) {
  try {
    await $.command.run({ command })
  } catch (error) {
    $.ui.toast(`Couldn't launch /${command}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Counts what the transcripts added since the last count. The first count of a machine reads
// every transcript and can take a while: the Stats tab fills in as it goes.
async function count($: EngineInterface) {
  const folder = await claudeFolder($)
  if (folder === undefined) return
  const book = ledger ?? (await loadLedger($, folder))
  ledger = book
  await countTranscripts($, folder, book, (done, total) => {
    progress = { done, total }
    $.ui.invalidate('ui.render')
  })
  countedAt = await $.clock.now()
}

// Starts a count unless one is running or the last finished within a minute.
async function ensureCounted($: EngineInterface): Promise<void> {
  if (counting !== null) return counting
  const now = await $.clock.now()
  if (ledger !== null && countedAt !== null && now - countedAt < MINUTE) return
  counting = count($).finally(() => {
    counting = null
    $.ui.invalidate('ui.render')
  })
  return counting
}

async function chooseTab($: EngineInterface, next: Tab) {
  await update($, tab, () => next)
  try {
    await $.store.set('tab', next)
  } catch {
    // Only the next session's first tab depends on it.
  }
  if (next === 'stats') await ensureCounted($)
}

function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// What the Stats tab shows: the numbers for its choices, and a line on where they come from.
async function statsOf($: EngineInterface) {
  const chosenScope = await read($, scope)
  const chosenPeriod = await read($, period)
  const today = dayOf(new Date(await $.clock.now()))
  const summary =
    ledger === null ? null : summarize(ledger, { scope: chosenScope, period: chosenPeriod, session: await $.session.id(), today })
  const since = summary?.since ?? null
  const footnote =
    counting !== null
      ? `Counting your conversations · ${progress.done} of ${progress.total}`
      : `Counted on this machine${since === null ? '' : ` · since ${shortDay(since)}`}${countedAt === null ? '' : ` · updated ${clockTime(countedAt)}`}`
  return { chosenScope, chosenPeriod, summary, footnote }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    accountName = await readAccountName($)
    await $.command.register({ name: COMMAND, description: 'Open your control panel' })
    try {
      const saved = await $.store.get('tab')
      if (saved === 'mods' || saved === 'stats') await update($, tab, () => saved)
    } catch {
      // The panel opens on its Mods tab.
    }
    // The greeting and the pill's colours follow the time of day.
    $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
    // Count in the background once the session has settled, so the Stats tab is ready.
    $.clock.after(1500, () => void ensureCounted($))
    // Draw the pill as soon as the mod loads, not on the next thing that redraws the band.
    $.ui.invalidate('ui.render')
    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openPanel($)
    return {}
  }).catch(() => ({ text: "Couldn't open your control panel." }))

  // The band is shared with other mods (usage-rings' rings, say): what they drew fills the row
  // and the pill sits at its right end. The engine's own answer there is its empty band, which
  // draws nothing, so it is left out.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const below = await next(e)
    const others = below.type === 'engine' ? null : below
    const name = await nameOf($)
    const label = `✦ ${titleOf(name)}`

    if (e.surface === 'terminal') {
      const { Box, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="row" alignItems="center" flexGrow={1}>
          <Box flexDirection="row" flexGrow={1}>{others}</Box>
          <Button key="cp-open" variant="primary" label={label} onPress={() => void openPanel($)} />
        </Box>
      )
    }
    if (e.surface !== 'desktop') return below

    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const { part } = await timeOf($)
    const width = pillWidth(label)
    return (
      <Box flexDirection="row" alignItems="center" flexGrow={1}>
        <Box flexDirection="row" flexGrow={1}>{others}</Box>
        <Box key="cp-pill" position="relative">
          <Svg source={pillSvg(DAY_COLORS[part], width)} alt={titleOf(name)} width={width} height={PILL_HEIGHT} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="row" alignItems="center" justifyContent="center">
            <Button key="cp-open" plain onPress={() => void openPanel($)}>
              <Text size="footnote" weight="semibold" color="#ffffff">{label}</Text>
            </Button>
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const name = await nameOf($)
    const { date, part } = await timeOf($)
    const greeting = greetingOf(part, name)
    const accent = DAY_COLORS[part].from
    const current = await read($, tab)
    if (current === 'stats') void ensureCounted($)
    const launchables = current === 'mods' ? launchablesOf(await $.command.list()) : []
    const stats = current === 'stats' ? await statsOf($) : null
    const empty = 'No mods with a command to launch yet.'
    const noReplies = 'No replies in this period.'

    // Every surface but the desktop gets rows of text and buttons.
    if (e.surface !== 'desktop') {
      const { Box, Button, Text } = $.ui.resolve(e)
      const summary = stats?.summary ?? null
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text color={accent} bold>
            {DAY_GLYPH[part]} {greeting} <Text dimColor>· {dateLabel(date)}</Text>
          </Text>
          <Box flexDirection="row" columnGap={2}>
            {TABS.map(t => (
              <Button
                key={`tab-${t.id}`}
                label={t.label}
                hotkey={t.hotkey}
                variant={t.id === current ? 'primary' : 'secondary'}
                dimColor={t.id !== current}
                onPress={() => void chooseTab($, t.id)}
              />
            ))}
          </Box>
          {current === 'mods' && launchables.length === 0 && <Text dimColor>{empty}</Text>}
          {current === 'mods' &&
            launchables.map(l => (
              <Button key={`launch-${l.command}`} plain label={l.title} onPress={() => void launch($, l.command)}>
                <Text color={l.colors.from} bold>{l.glyph}</Text> <Text bold>{l.title}</Text> <Text dimColor>{l.blurb}</Text>
              </Button>
            ))}
          {stats !== null && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {SCOPES.map(s => (
                <Button
                  key={`scope-${s.id}`}
                  label={s.label}
                  dimColor={s.id !== stats.chosenScope}
                  onPress={() => void update($, scope, () => s.id)}
                />
              ))}
              {stats.chosenScope === 'all' &&
                PERIODS.map(p => (
                  <Button
                    key={`period-${p.id}`}
                    label={p.label}
                    dimColor={p.id !== stats.chosenPeriod}
                    onPress={() => void update($, period, () => p.id)}
                  />
                ))}
            </Box>
          )}
          {summary !== null && (
            <Box flexDirection="column">
              <Text>
                Conversations <Text bold>{compact(summary.conversations)}</Text> · Replies <Text bold>{compact(summary.replies)}</Text> · Total tokens{' '}
                <Text bold>{compact(summary.total)}</Text>
              </Text>
              <Text>
                Input tokens <Text bold>{compact(summary.input)}</Text>{' '}
                <Text dimColor>
                  ({compact(summary.cacheRead)} cached · {compact(summary.cacheWrite)} written · {compact(summary.fresh)} new)
                </Text>{' '}
                · Output tokens <Text bold>{compact(summary.output)}</Text>
              </Text>
              {summary.models.length === 0 && <Text dimColor>{noReplies}</Text>}
              {summary.models.map(m => (
                <Text key={`model-${m.model}`}>
                  <Text color={accent}>{'█'.repeat(Math.max(1, Math.round(m.share * 16)))}</Text> {m.label} <Text dimColor>{compact(m.output)}</Text>
                </Text>
              ))}
            </Box>
          )}
          {stats !== null && <Text dimColor>{stats.footnote}</Text>}
        </Box>
      )
    }

    const { Box, Button, Svg, Text } = $.ui.resolve(e)

    // A switch's chip: a pill picture with its label pressed over it.
    const chip = (key: string, label: string, isOn: boolean, choose: () => void) => {
      const width = chipWidth(label)
      return (
        <Box key={`chip-${key}`} position="relative">
          <Svg source={chipSvg(width, 24, isOn)} alt={isOn ? `${label}, chosen` : label} width={width} height={24} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="row" alignItems="center" justifyContent="center">
            <Button key={key} plain onPress={choose}>
              <Text size="footnote" weight={isOn ? 'semibold' : 'regular'} dimColor={!isOn}>{label}</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    // A stat card: a rounded face with its number, its name and, for input, how it splits.
    const card = (key: string, value: string, label: string, detail?: string) => (
      <Box key={`kpi-${key}`} position="relative" width="32%">
        <Svg source={cardSvg(CARD_HEIGHT)} alt={`${label}: ${value}`} height={CARD_HEIGHT} />
        <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column" justifyContent="center" paddingX="md">
          <Text size="title" weight="bold" tabular wrap="truncate-end">{value}</Text>
          <Text size="caption" dimColor wrap="truncate-end">{label}</Text>
          {detail !== undefined && (
            <Text size="caption" dimColor wrap="truncate-end">
              {detail}
            </Text>
          )}
        </Box>
      </Box>
    )

    const mods = (
      <Box key="launch-grid" flexDirection="row" flexWrap="wrap" justifyContent="flex-start" columnGap="sm" rowGap="sm">
        {launchables.length === 0 && <Text dimColor>{empty}</Text>}
        {launchables.map(l => (
          <Box key={`card-${l.command}`} position="relative">
            <Svg source={tileSvg(l)} alt={l.title} width={TILE_SIZE} height={TILE_SIZE} />
            <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
              <Svg source={tileSvg(l, true)} alt={l.title} width={TILE_SIZE} height={TILE_SIZE} />
            </Box>
            <Box
              key={`card-${l.command}-text`}
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              flexDirection="column"
              alignItems="center"
              justifyContent="flex-end"
              paddingX="sm"
              paddingBottom="md"
              overflow="hidden"
            >
              <Text size="footnote" weight="semibold" wrap="truncate-end">{l.title}</Text>
              <Text size="caption" mono dimColor wrap="truncate-end">/{l.command}</Text>
              <Box marginTop="sm">
                <Button key={`launch-${l.command}`} variant="secondary" onPress={() => void launch($, l.command)}>
                  Launch
                </Button>
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
    )

    const summary = stats?.summary ?? null
    const statsView = stats !== null && (
      <Box key="stats" flexDirection="column" rowGap="md">
        <Box key="stats-controls" flexDirection="row" flexWrap="wrap" columnGap="md" rowGap="sm" alignItems="center">
          <Box flexDirection="row" columnGap="xs">
            {SCOPES.map(s => chip(`scope-${s.id}`, s.label, s.id === stats.chosenScope, () => void update($, scope, () => s.id)))}
          </Box>
          {stats.chosenScope === 'all' && (
            <Box flexDirection="row" columnGap="xs">
              {PERIODS.map(p => chip(`period-${p.id}`, p.label, p.id === stats.chosenPeriod, () => void update($, period, () => p.id)))}
            </Box>
          )}
        </Box>
        {summary === null && <Text dimColor>Counting your conversations…</Text>}
        {summary !== null && (
          <Box key="kpis" flexDirection="row" flexWrap="wrap" justifyContent="space-between" rowGap="sm">
            {card('conversations', compact(summary.conversations), 'Conversations')}
            {card('replies', compact(summary.replies), 'Replies')}
            {card('total', compact(summary.total), 'Total tokens')}
            {card(
              'input',
              compact(summary.input),
              'Input tokens',
              `${compact(summary.cacheRead)} cached · ${compact(summary.cacheWrite)} written · ${compact(summary.fresh)} new`,
            )}
            {card('output', compact(summary.output), 'Output tokens')}
            {card('model', summary.topModel ?? '–', 'Most used model')}
          </Box>
        )}
        {summary !== null && (
          <Box key="models" flexDirection="column" rowGap="xs">
            <Text size="caption" weight="semibold" dimColor>OUTPUT BY MODEL</Text>
            {summary.models.length === 0 && <Text size="footnote" dimColor>{noReplies}</Text>}
            {summary.models.map(m => (
              <Box key={`model-${m.model}`} flexDirection="row" alignItems="center" columnGap="sm">
                <Box width={12}>
                  <Text size="footnote" wrap="truncate-end">{m.label}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Svg source={barSvg(m.share, accent)} alt={`${m.label}: ${compact(m.output)} output tokens`} height={8} />
                </Box>
                <Box width={7} flexDirection="row" justifyContent="flex-end">
                  <Text size="footnote" dimColor tabular>{compact(m.output)}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        <Text size="caption" dimColor>{stats.footnote}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap="md">
        <Box key="strip" position="relative">
          <Svg source={stripSvg(DAY_COLORS[part])} alt={`${greeting}, ${dateLabel(date)}`} height={STRIP_HEIGHT} />
          <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="row" alignItems="center" columnGap="sm" paddingX="md">
            <Svg source={dayIconSvg(part)} alt={part} width={18} height={18} />
            <Text weight="semibold" color="#ffffff">{greeting}</Text>
            <Box flexGrow={1} />
            <Box key="strip-date" paddingRight="md">
              <Text size="footnote" color="#ffffff">{dateLabel(date)}</Text>
            </Box>
          </Box>
        </Box>
        <Box key="tabs" flexDirection="column">
          <Box flexDirection="row" columnGap="lg">
            {TABS.map(t => {
              const isOn = t.id === current
              const width = Math.round(7 * t.label.length + 4)
              return (
                <Box key={`tab-box-${t.id}`} flexDirection="column" alignItems="flex-start" rowGap="xs">
                  <Button key={`tab-${t.id}`} plain hotkey={t.hotkey} onPress={() => void chooseTab($, t.id)}>
                    <Text size="footnote" weight={isOn ? 'semibold' : 'regular'} dimColor={!isOn}>{t.label}</Text>
                  </Button>
                  <Svg source={underlineSvg(width, accent, isOn)} alt={isOn ? `${t.label} tab, open` : `${t.label} tab`} width={width} height={3} />
                </Box>
              )
            })}
          </Box>
          <Svg source={hairlineSvg()} alt="divider" height={1} />
        </Box>
        {current === 'mods' ? mods : statsView}
      </Box>
    )
  })
}
