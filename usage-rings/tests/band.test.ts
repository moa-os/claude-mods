import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-13T14:00:00Z')

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

const CARD = JSON.stringify({
  plan: {
    status: 'ok',
    windows: [
      { label: '5-hour limit', percentUsed: 10, resetsAt: '2026-10-13T18:00:00.000Z' },
      { label: 'Weekly · all models', percentUsed: 41, resetsAt: '2026-10-20T13:00:00.000Z' },
      { label: 'Weekly · Fable', percentUsed: 85, resetsAt: '2026-10-20T13:00:00.000Z' },
    ],
  },
})

test('the band waits for data, then shows all three windows on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-13T18:00:00.000Z' }],
    },
  }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: CARD }], isError: false } }))

  const emptyTerminal = await $.ui.mount({ plugin: 'usage-rings', surface: 'terminal', ...BAND })
  expect(await emptyTerminal.find({ text: '○ –' })).toBeDefined()
  await emptyTerminal.unmount()
  const emptyDesktop = await $.ui.mount({ plugin: 'usage-rings', surface: 'desktop', ...BAND })
  const emptyRings = await emptyDesktop.findAll({ type: 'Svg' })
  expect(emptyRings.map(r => r.props.alt)).toEqual([
    '5-hour: no reading yet',
    'Weekly: no reading yet',
    'Fable: no reading yet',
  ])
  await emptyDesktop.unmount()

  await $.session.start({ cwd: '.' } as never)
  await clock.advance(10)

  const terminal = await $.ui.mount({ plugin: 'usage-rings', surface: 'terminal', ...BAND })
  // The engine's 23% beats the app's 10% for the same 5-hour window.
  expect(await terminal.find({ text: '23%' })).toBeDefined()
  expect(await terminal.find({ text: '41%' })).toBeDefined()
  expect(await terminal.find({ text: '85%' })).toBeDefined()
  expect(await terminal.find({ text: '3h 59m' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: 'usage-rings', surface: 'desktop', ...BAND })
  const rings = await desktop.findAll({ type: 'Svg' })
  expect(rings.map(r => r.props.alt)).toEqual([
    '5-hour: 23% used',
    'Weekly: 41% used',
    'Fable: 85% used',
  ])
  expect(await desktop.find({ type: 'Text', text: 'Fable' })).toBeDefined()
  expect(await desktop.find({ type: 'Text', text: '3h 59m' })).toBeDefined()
  // Ring, label and countdown sit side by side: no box stacks them.
  const boxes = await desktop.findAll({ type: 'Box' })
  expect(boxes.every(b => b.props.flexDirection === 'row')).toBe(true)
  await desktop.unmount()

  // A live measurement moves the ring without waiting for the next poll.
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 57, resetsAt: '2026-10-13T18:00:00.000Z' }],
    changed: ['rateLimits'],
  })
  const after = await $.ui.mount({ plugin: 'usage-rings', surface: 'terminal', ...BAND })
  expect(await after.find({ text: '57%' })).toBeDefined()
  await after.unmount()
})

test('the band yields to a survey', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band')
  })
  const ui = await $.ui.mount({
    plugin: 'usage-rings',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, hasSurvey: true },
  })
  expect(await ui.find({ text: '5-hour' })).toBeUndefined()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()
})
