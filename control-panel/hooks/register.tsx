import type { EngineInterface, Register } from 'claude-code'

import {
  DAY_COLORS,
  PILL_HEIGHT,
  STRIP_HEIGHT,
  TILE_SIZE,
  accountNameOf,
  dateLabel,
  dayIconSvg,
  displayName,
  greetingOf,
  launchablesOf,
  partOfDay,
  pillSvg,
  pillWidth,
  stripSvg,
  tileSvg,
  titleOf,
} from './panel'

const PANE = 'control-panel'
const COMMAND = 'cp'
const MINUTE = 60_000

// The terminal's stand-ins for the strip's icons.
const DAY_GLYPH = { morning: '☀', afternoon: '☀', evening: '☾', night: '☾' } as const

// The Claude account's name, read once a load: Claude Code's config file can be large.
let accountName: string | undefined

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    accountName = await readAccountName($)
    await $.command.register({ name: COMMAND, description: 'Open your control panel' })
    // The greeting and the pill's colours follow the time of day.
    $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
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
    const launchables = launchablesOf(await $.command.list())
    const empty = 'No mods with a command to launch yet.'

    // Every surface but the desktop gets a list of rows, each one Button.
    if (e.surface !== 'desktop') {
      const { Box, Button, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text color={DAY_COLORS[part].from} bold>
            {DAY_GLYPH[part]} {greeting} <Text dimColor>· {dateLabel(date)}</Text>
          </Text>
          <Text dimColor bold>LAUNCH</Text>
          {launchables.length === 0 && <Text dimColor>{empty}</Text>}
          {launchables.map(l => (
            <Button key={`launch-${l.command}`} plain label={l.title} onPress={() => void launch($, l.command)}>
              <Text color={l.colors.from} bold>{l.glyph}</Text> <Text bold>{l.title}</Text> <Text dimColor>{l.blurb}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    // The Launch cards are small rounded tiles, as many to a row as the pane fits: a picture for
    // the face, a brighter one shown while the pointer is on the tile, and over it the name and
    // command as real text, with a Launch button at the bottom.
    const { Box, Button, Svg, Text } = $.ui.resolve(e)
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
        <Box flexDirection="column" rowGap="sm">
          <Text size="caption" weight="semibold" dimColor>LAUNCH</Text>
          {launchables.length === 0 && <Text dimColor>{empty}</Text>}
          <Box key="launch-grid" flexDirection="row" flexWrap="wrap" justifyContent="flex-start" columnGap="sm" rowGap="sm">
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
        </Box>
      </Box>
    )
  })
}
