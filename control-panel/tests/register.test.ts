import type { CommandInfo, PaneOpenArgs, RenderElement, RenderNode } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

// An evening, in local time, so the greeting and the pill's colours are known.
const EVENING = new Date(2026, 9, 18, 21, 0).getTime()

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const PANE = {
  component: 'Pane',
  requestId: 'control-panel',
  props: {
    title: "Moa's CP",
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const COMMANDS: CommandInfo[] = [
  { name: 'help', source: 'builtin', description: 'Show help' },
  { name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers', description: 'Brainstorm' },
  { name: 'flow', source: 'plugin', plugin: 'agent-flow', description: 'Open the agent flow pane' },
  { name: 'cp', source: 'plugin', plugin: 'control-panel', description: 'Open your control panel' },
  { name: 'diff', source: 'builtin', description: 'Show uncommitted changes' },
]

const SURFACES = ['terminal', 'desktop'] as const

// Finds the Box keyed `key` in a drawing, depth first.
function boxKeyed(node: RenderNode | undefined, key: string): Extract<RenderElement, { type: 'Box' }> | undefined {
  if (node === undefined || typeof node === 'string' || node.type !== 'Box') return undefined
  if (node.props?.key === key) return node
  for (const child of node.children ?? []) {
    const found = boxKeyed(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

describe('register', () => {
  test("the band draws the pill, named after the person, beside another mod's drawing", async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'the rings') as RenderElement
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'control-panel', surface, ...BAND })
      expect(await ui.find({ text: 'the rings' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'cp-open' })).toBeDefined()
      expect(await ui.find({ text: "✦ Moa's CP" })).toBeDefined()
      await ui.unmount()
    }

    // On the desktop the pill's face is an evening gradient, purple into orange.
    const desktop = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...BAND })
    const face = await desktop.find({ type: 'Svg' })
    expect(face?.props.alt).toBe("Moa's CP")
    expect(String(face?.props.source)).toContain('#7c3aed')
    expect(String(face?.props.source)).toContain('#ea580c')
    await desktop.unmount()
  })

  test("the pill is named after the Claude account's display name", async ($, on) => {
    mock.clock(on, { now: EVENING })
    const env: Record<string, string> = { HOME: '/Users/moa', USER: 'moa' }
    on('env.get', ($, e) => ({ value: env[e.name] }))
    on('fs.read', ($, e) => {
      if (e.path !== '/Users/moa/.claude.json') throw new Error(`unexpected read of ${e.path}`)
      return { value: JSON.stringify({ oauthAccount: { displayName: 'Mo' } }) }
    })
    on('ui.render', () => ({ type: 'engine', ref: 0 }))

    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: "✦ Mo's CP" })).toBeDefined()
    await ui.unmount()
  })

  test("without a Claude account name the pill falls back to the login name, Windows' too", async ($, on) => {
    mock.clock(on, { now: EVENING })
    // Windows has USERNAME and USERPROFILE where macOS and Linux have USER and HOME.
    const env: Record<string, string> = { USERPROFILE: 'C:\\Users\\moa', USERNAME: 'moa' }
    on('env.get', ($, e) => ({ value: env[e.name] }))
    on('fs.read', () => {
      throw new Error('no config file')
    })
    on('ui.render', () => ({ type: 'engine', ref: 0 }))

    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: "✦ Moa's CP" })).toBeDefined()
    await ui.unmount()
  })

  test('the band yields to a survey', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'a survey') as RenderElement
    })
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    expect(await ui.find({ text: 'a survey' })).toBeDefined()
    expect(await ui.find({ key: 'cp-open' })).toBeUndefined()
    await ui.unmount()
  })

  test('pressing the pill opens the panel under its title', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('ui.render', () => ({ type: 'engine', ref: 0 }))
    const opened: PaneOpenArgs[] = []
    on('ui.open', ($, e) => {
      opened.push(e)
      return { value: { isPlaced: true } }
    })

    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...BAND })
    await ui.press({ key: 'cp-open' })
    expect(opened.map(o => [o.id, o.title])).toEqual([['control-panel', "Moa's CP"]])
    await ui.unmount()
  })

  test('/cp opens the panel', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    const opened: PaneOpenArgs[] = []
    on('ui.open', ($, e) => {
      opened.push(e)
      return { value: { isPlaced: true } }
    })

    await $.session.start({ cwd: '.' } as never)
    await $.command.run({
      command: 'cp',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
    expect(opened.map(o => o.id)).toEqual(['control-panel'])
  })

  test('the panel greets the person and launches their mods on every surface', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('command.list', () => ({ value: COMMANDS }))
    const ran: string[] = []
    on('command.run', ($, e) => {
      ran.push(e.command)
      return {}
    })

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'control-panel', surface, ...PANE })
      expect(await ui.find({ text: /Good evening, Moa/ })).toBeDefined()
      expect(await ui.find({ text: 'Agent Flow' })).toBeDefined()
      expect(await ui.find({ text: 'Diff' })).toBeDefined()
      expect(await ui.find({ text: 'Brainstorm' })).toBeUndefined()
      expect(await ui.find({ key: 'launch-cp' })).toBeUndefined()
      await ui.press({ key: 'launch-flow' })
      await ui.unmount()
    }
    expect(ran).toEqual(['flow', 'flow'])
  })

  test('on the desktop the strip fills the width with the date inside it, and the cards are small rounded tiles with a Launch button, as many to a row as fit', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('command.list', () => ({ value: COMMANDS }))
    const ran: string[] = []
    on('command.run', ($, e) => {
      ran.push(e.command)
      return {}
    })

    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    const strip = await ui.find({ key: 'strip' })
    // No border around the strip: on the desktop a border pads it in from the pane's edges.
    expect(strip?.props.borderStyle).toBeUndefined()
    const backdrop = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.source).includes('cp-strip'))
    expect(backdrop?.props.width).toBeUndefined()
    expect(String(backdrop?.props.source)).toContain('preserveAspectRatio="none"')
    expect(String(backdrop?.props.source)).toContain('rx=')
    expect(JSON.stringify(boxKeyed(await ui.drawn(), 'strip'))).toContain('Sun 18 Oct')
    // The date keeps its distance from the strip's right edge.
    expect((await ui.find({ key: 'strip-date' }))?.props.paddingRight).toBeDefined()
    // The cards are small square tiles, as many to a row as the pane fits: each tile's face is
    // a fixed-size picture, and the grid wraps from the left.
    const grid = await ui.find({ key: 'launch-grid' })
    expect(grid?.props.flexWrap).toBe('wrap')
    expect(grid?.props.justifyContent).toBe('flex-start')
    const face = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.source).includes('cp-tile-flow'))
    expect(face?.props.width).toBe(140)
    expect(face?.props.height).toBe(140)
    // Rounded, and everything on it centred.
    expect(String(face?.props.source)).toContain('rx="16"')
    expect((await ui.find({ key: 'card-flow-text' }))?.props.alignItems).toBe('center')
    expect(await ui.find({ type: 'Text', text: '/flow' })).toBeDefined()
    // A brighter face waits under the pointer: hidden, shown while the tile is hovered.
    const tile = boxKeyed(await ui.drawn(), 'card-flow')
    const lit = tile?.children?.[1]
    expect(typeof lit === 'object' && lit.type === 'Box' ? [lit.props?.display, lit.hover?.display] : []).toEqual(['none', 'flex'])
    expect(JSON.stringify(lit)).toContain('cp-tile-flow-lit')
    // Each card ends in a Launch button at its bottom, under its name and command.
    expect(JSON.stringify(boxKeyed(await ui.drawn(), 'card-flow-text'))).toContain('Launch')
    const launchButton = await ui.find({ type: 'Button', key: 'launch-flow' })
    expect(launchButton).toBeDefined()
    await ui.press({ key: 'launch-flow' })
    expect(ran).toEqual(['flow'])
    await ui.unmount()
  })

  test('the panel says so when no mod has anything to launch', async ($, on) => {
    mock.clock(on, { now: EVENING })
    on('env.get', () => ({ value: 'moa' }))
    on('command.list', () => ({ value: [] }))

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'control-panel', surface, ...PANE })
      expect(await ui.find({ text: 'No mods with a command to launch yet.' })).toBeDefined()
      await ui.unmount()
    }
  })
})
