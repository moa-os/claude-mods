import type { CommandInfo } from 'claude-code'

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'
export type Colors = { from: string; to: string }
type IconName = 'replay' | 'flow' | 'tasks' | 'diff'

/** One card of the Launch section: a slash command a mod adds. */
export type Launchable = {
  command: string
  title: string
  blurb: string
  /** A symbol for a mod the panel knows (the terminal's icon), else the command's first letter. */
  glyph: string
  /** The line art the desktop tile draws for a mod the panel knows; null draws `glyph`. */
  icon: IconName | null
  colors: Colors
}

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

// The greeting strip's and the pill's gradient through the day.
export const DAY_COLORS: Record<PartOfDay, Colors> = {
  morning: { from: '#fb923c', to: '#f472b6' },
  afternoon: { from: '#0ea5e9', to: '#6366f1' },
  evening: { from: '#7c3aed', to: '#ea580c' },
  night: { from: '#312e81', to: '#7c3aed' },
}

export function greetingOf(part: PartOfDay, name: string): string {
  const greeting = part === 'night' ? 'Working late' : `Good ${part}`
  return name === '' ? greeting : `${greeting}, ${name}`
}

/** The login name, capitalised ("moa" is "Moa"); empty when there is none. */
export function displayName(user: string | undefined): string {
  if (user === undefined || user === '') return ''
  return user.charAt(0).toUpperCase() + user.slice(1)
}

/**
 * The Claude account's name from Claude Code's config file (`.claude.json`): its display name,
 * else its full name; undefined when the file holds neither, or is no JSON.
 */
export function accountNameOf(configText: string): string | undefined {
  let config: unknown
  try {
    config = JSON.parse(configText)
  } catch {
    return undefined
  }
  const account = (config as { oauthAccount?: { displayName?: unknown; fullName?: unknown } } | null)?.oauthAccount
  for (const name of [account?.displayName, account?.fullName]) {
    if (typeof name === 'string' && name.trim() !== '') return name.trim()
  }
  return undefined
}

export function titleOf(name: string): string {
  return name === '' ? 'Control panel' : `${name}'s CP`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sun 18 Oct", in local time. */
export function dateLabel(date: Date): string {
  return `${DAYS[date.getDay()] ?? ''} ${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`
}

// The mods the panel knows by name get their own title, line and colours; the rest are drawn
// from their command and a colour picked by its name, so a new mod shows up without a change here.
const KNOWN: Record<string, Omit<Launchable, 'command'>> = {
  replay: {
    title: 'Replay Theater',
    blurb: "Step through the last turn's edits",
    glyph: '↻',
    icon: 'replay',
    colors: { from: '#f59e0b', to: '#ea580c' },
  },
  flow: {
    title: 'Agent Flow',
    blurb: 'Live tree of running subagents',
    glyph: '⋔',
    icon: 'flow',
    colors: { from: '#14b8a6', to: '#0ea5e9' },
  },
  'my-tasks': {
    title: 'My Tasks',
    blurb: 'What Claude needs from you',
    glyph: '☑',
    icon: 'tasks',
    colors: { from: '#8b5cf6', to: '#d946ef' },
  },
  diff: {
    title: 'Diff',
    blurb: 'Uncommitted changes, file by file',
    glyph: '±',
    icon: 'diff',
    colors: { from: '#22c55e', to: '#15803d' },
  },
}

const PALETTE: readonly Colors[] = [
  { from: '#f43f5e', to: '#be123c' },
  { from: '#3b82f6', to: '#1d4ed8' },
  { from: '#eab308', to: '#ca8a04' },
  { from: '#06b6d4', to: '#0e7490' },
  { from: '#a855f7', to: '#7e22ce' },
  { from: '#84cc16', to: '#4d7c0f' },
]

// Built-in commands that are mods of their own; everything else built in is left out.
const BUILT_IN_MODS = new Set(['diff'])
const SELF = 'control-panel'

function hashOf(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

function titleCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(word => word !== '')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The commands worth a Launch card: those a mod registered (a plugin's command with a plain
 * name; a skill's is always `plugin:name`), then the built-in mods, never this panel's own.
 */
export function launchablesOf(commands: readonly CommandInfo[]): Launchable[] {
  const fromMods = commands.filter(c => c.source === 'plugin' && !c.name.includes(':') && c.plugin !== SELF)
  const builtIn = commands.filter(c => c.source === 'builtin' && BUILT_IN_MODS.has(c.name))
  return [...fromMods, ...builtIn].map(c => {
    const known = KNOWN[c.name]
    if (known !== undefined) return { command: c.name, ...known }
    return {
      command: c.name,
      title: titleCase(c.name),
      blurb: c.description,
      glyph: c.name.charAt(0).toUpperCase(),
      icon: null,
      colors: PALETTE[hashOf(c.name) % PALETTE.length] ?? { from: '#8a8a8a', to: '#5a5a5a' },
    }
  })
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

function gradient(id: string, colors: Colors): string {
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0.35">` +
    `<stop offset="0" stop-color="${colors.from}"/><stop offset="1" stop-color="${colors.to}"/>` +
    `</linearGradient>`
  )
}

export const PILL_HEIGHT = 22

/** Wide enough for the pill's label at the band's footnote size. */
export function pillWidth(label: string): number {
  return 16 + 7 * label.length
}

/** The pill's face: the time of day's gradient, a soft top highlight and a hairline edge. */
export function pillSvg(colors: Colors, width: number): string {
  const h = PILL_HEIGHT
  const rect = `x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="${(h - 1) / 2}"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">` +
    `<defs>${gradient('cp-pill', colors)}` +
    `<linearGradient id="cp-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `</defs>` +
    `<rect ${rect} fill="url(#cp-pill)"/>` +
    `<rect ${rect} fill="url(#cp-shine)" stroke="#fff" stroke-opacity=".18"/>` +
    `</svg>`
  )
}

export const STRIP_HEIGHT = 40

/**
 * The greeting strip's backdrop: the time of day's gradient in a rounded band, stretched to the
 * pane's width (the Svg gets no width of its own). Drawn at about a pane's width, so the corners
 * keep their shape when it stretches.
 */
export function stripSvg(colors: Colors): string {
  const w = 720
  const h = STRIP_HEIGHT
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">` +
    `<defs>${gradient('cp-strip', colors)}</defs>` +
    `<rect width="${w}" height="${h}" rx="10" fill="url(#cp-strip)"/>` +
    `</svg>`
  )
}

const DAY_ICON: Record<PartOfDay, string> = {
  morning: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 7v3M5.6 10.6l1.4 1.4M18.4 10.6 17 12"/>',
  afternoon:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  evening: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 7v3M5.6 10.6l1.4 1.4M18.4 10.6 17 12"/>',
  night: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
}

/** The strip's time-of-day icon, white line art. */
export function dayIconSvg(part: PartOfDay): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    DAY_ICON[part] +
    `</svg>`
  )
}

const GLYPHS: Record<IconName, string> = {
  replay: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><path d="M10 9l5 3-5 3z" fill="#fff"/>',
  flow: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 6l8 5M8 18l8-5"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  diff: '<path d="M12 4v8M8 8h8M8 18h8"/>',
}

/** The side of a Launch tile, in CSS pixels. */
export const TILE_SIZE = 140

/**
 * A Launch tile's face: a rounded square with a faint grey fill and hairline edge (they read on
 * light and dark themes alike), a soft glow of the mod's colour, and the mod's icon centred near
 * the top: a rounded square in its gradient with its line art or first letter. `isLit` draws the
 * brighter face shown under the pointer. The tile's text is drawn over it as real text, so it
 * follows the theme.
 */
export function tileSvg(launchable: Launchable, isLit = false): string {
  const id = `cp-tile-${launchable.command.replace(/[^a-zA-Z0-9-]/g, '')}${isLit ? '-lit' : ''}`
  const size = TILE_SIZE
  const icon = 40
  const x = (size - icon) / 2
  const y = 14
  const mark =
    launchable.icon === null
      ? `<text x="${size / 2}" y="${y + icon / 2}" text-anchor="middle" dominant-baseline="central" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="17" font-weight="700" fill="#fff">${escapeXml(launchable.glyph)}</text>`
      : `<g transform="translate(${x + 8} ${y + 8})" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[launchable.icon]}</g>`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<defs>${gradient(`${id}-icon`, launchable.colors)}` +
    `<radialGradient id="${id}-glow" cx="0.5" cy="0.3" r="0.75">` +
    `<stop offset="0" stop-color="${launchable.colors.from}" stop-opacity="${isLit ? 0.42 : 0.24}"/>` +
    `<stop offset="1" stop-color="${launchable.colors.from}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="${size}" height="${size}" rx="16" fill="#808080" fill-opacity="${isLit ? 0.18 : 0.12}"/>` +
    `<rect width="${size}" height="${size}" rx="16" fill="url(#${id}-glow)"/>` +
    `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="15.5" fill="none" stroke="${isLit ? launchable.colors.from : '#808080'}" stroke-opacity="${isLit ? 0.7 : 0.28}"/>` +
    `<rect x="${x}" y="${y}" width="${icon}" height="${icon}" rx="12" fill="url(#${id}-icon)"/>` +
    mark +
    `</svg>`
  )
}
