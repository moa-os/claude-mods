import type { CommandInfo, FsEntry, On, RenderNode } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

// An evening, in local time.
const EVENING = new Date(2026, 9, 18, 21, 0).getTime()
const HOME = '/home/moa'
const PROJECTS = `${HOME}/.claude/projects`
const LEDGER = `${HOME}/.claude/control-panel/stats.json`
const SMALL = `${PROJECTS}/p/small.jsonl`
const BIG = `${PROJECTS}/p/big.jsonl`

const PANE = {
  component: 'Pane',
  requestId: 'control-panel',
  props: {
    title: "Moa's CP",
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const COMMANDS: CommandInfo[] = [{ name: 'flow', source: 'plugin', plugin: 'agent-flow', description: 'Open the agent flow pane' }]

function reply(id: string, session: string, model: string, hour: number, output = 50): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: session,
    requestId: `req-${id}`,
    timestamp: new Date(2026, 9, 18, hour, 0).toISOString(),
    message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: output } },
  })
}

// Two replies of this conversation (s1) in a small transcript; in a big one, a reply of another
// conversation (s2) and a copy of s1's first reply, which a resumed conversation carries.
const SMALL_TEXT = [reply('m1', 's1', 'claude-opus-5-5', 9), JSON.stringify({ type: 'user' }), reply('m2', 's1', 'claude-opus-5-5', 10)].join('\n') + '\n'
const BIG_TEXT = [reply('m3', 's2', 'claude-fable-5-1', 11, 20), reply('m1', 's2', 'claude-opus-5-5', 9)].join('\n') + '\n'

const entry = (name: string, kind: FsEntry['kind'], size = 0): FsEntry => ({ name, kind, size, mtimeMs: 0, isLink: false })

// Finds the Box keyed `key` in a drawing, depth first.
function boxKeyed(node: RenderNode | undefined, key: string): RenderNode | undefined {
  if (node === undefined || typeof node === 'string' || node.type !== 'Box') return undefined
  if (node.props?.key === key) return node
  for (const child of node.children ?? []) {
    const found = boxKeyed(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

type Setup = { env?: Record<string, string>; ledger?: string; bigSize?: number }

// The machine a test runs on: its environment, its transcripts, and what the panel writes.
function machine(on: On, setup: Setup = {}) {
  const env = setup.env ?? { HOME, USER: 'moa' }
  const projects = `${env['HOME'] ?? `${env['USERPROFILE']}`}/.claude/projects`
  const spawned: string[][] = []
  const writes: { path: string; text: string }[] = []
  mock.clock(on, { now: EVENING })
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('session.id', () => ({ value: 's1' }))
  on('command.list', () => ({ value: COMMANDS }))
  on('fs.list', ($, e) => {
    if (e.path === projects) return { value: [entry('p', 'dir')] }
    if (e.path === `${projects}/p`) return { value: [entry('small.jsonl', 'file', SMALL_TEXT.length), entry('big.jsonl', 'file', setup.bigSize ?? 5 * 1024 * 1024)] }
    return { value: [] }
  })
  on('fs.read', ($, e) => {
    if (e.path === `${projects}/p/small.jsonl`) return { value: SMALL_TEXT }
    if (e.path.endsWith('control-panel/stats.json') && setup.ledger !== undefined) return { value: setup.ledger }
    throw new Error(`no file ${e.path}`)
  })
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.spawn', async function* ($, e) {
    spawned.push([...e.argv])
    // Streamed in two pieces that cut a line in half.
    yield { stream: 'stdout' as const, text: BIG_TEXT.slice(0, 50) }
    yield { stream: 'stdout' as const, text: BIG_TEXT.slice(50) }
    return { value: { code: 0, signal: null } }
  })
  return { spawned, writes }
}

async function kpi(ui: { drawn: () => Promise<RenderNode> }, name: string): Promise<string> {
  return JSON.stringify(boxKeyed(await ui.drawn(), `kpi-${name}`))
}

describe('stats tab', () => {
  test('the panel opens on its Mods tab and switches to Stats', async ($, on) => {
    machine(on)
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Button', key: 'tab-mods' })).toBeDefined()
    expect(await ui.find({ key: 'card-flow' })).toBeDefined()
    await ui.press({ key: 'tab-stats' })
    expect(await ui.find({ key: 'card-flow' })).toBeUndefined()
    expect(await ui.find({ text: 'Conversations' })).toBeDefined()
    await ui.unmount()
  })

  test('counts every transcript once, a big one streamed, and saves what it counted', async ($, on) => {
    const { spawned, writes } = machine(on)
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab-stats' })
    await ui.press({ key: 'period-all' })
    // m1 is in both transcripts: three replies, two conversations.
    expect(await kpi(ui, 'replies')).toContain('"3"')
    expect(await kpi(ui, 'conversations')).toContain('"2"')
    expect(await kpi(ui, 'output')).toContain('"120"')
    expect(await kpi(ui, 'model')).toContain('Opus 5.5')
    expect(await ui.find({ text: 'Fable 5.1' })).toBeDefined()
    expect(spawned).toEqual([['cat', BIG]])
    const saved = writes.filter(w => w.path === LEDGER).at(-1)
    expect(saved).toBeDefined()
    expect(JSON.parse(saved?.text ?? '{}').files[SMALL].offset).toBe(SMALL_TEXT.length)
    await ui.unmount()
  })

  test('this conversation shows only its own replies, and no period', async ($, on) => {
    machine(on)
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab-stats' })
    await ui.press({ key: 'scope-session' })
    expect(await kpi(ui, 'replies')).toContain('"2"')
    expect(await kpi(ui, 'conversations')).toContain('"1"')
    expect(await ui.find({ key: 'period-7d' })).toBeUndefined()
    await ui.unmount()
  })

  test('next time it reads only what was added: a small transcript it has read is skipped, a big one resumed', async ($, on) => {
    const bigRead = 1000
    const ledger = JSON.stringify({
      version: 1,
      days: {},
      daySessions: {},
      sessions: {},
      seen: {},
      files: { [SMALL]: { size: SMALL_TEXT.length, mtimeMs: 0, offset: SMALL_TEXT.length }, [BIG]: { size: bigRead, mtimeMs: 0, offset: bigRead } },
    })
    const { spawned } = machine(on, { ledger, bigSize: 2 * bigRead })
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab-stats' })
    expect(spawned).toEqual([['tail', '-c', `+${bigRead + 1}`, BIG]])
    await ui.press({ key: 'period-all' })
    // Only the big transcript's two lines were read: m3 and the copy of m1, now new to the ledger.
    expect(await kpi(ui, 'replies')).toContain('"2"')
    await ui.unmount()
  })

  test("on Windows it finds the transcripts under USERPROFILE and skips what it read before", async ($, on) => {
    // A path absolute on the machine the tests run on: the test kit resolves a Windows drive
    // path like C:\\Users\\moa against its working folder on macOS.
    const profile = '/win/Users/moa'
    const big = `${profile}/.claude/projects/p/big.jsonl`
    const small = `${profile}/.claude/projects/p/small.jsonl`
    // The big transcript's first line (m3) was read before; its counted list was since forgotten.
    const firstLine = BIG_TEXT.slice(0, BIG_TEXT.indexOf('\n') + 1).length
    const ledger = JSON.stringify({
      version: 1,
      days: {},
      daySessions: {},
      sessions: {},
      seen: {},
      files: { [small]: { size: SMALL_TEXT.length, mtimeMs: 0, offset: SMALL_TEXT.length }, [big]: { size: firstLine, mtimeMs: 0, offset: firstLine } },
    })
    const { spawned } = machine(on, { env: { USERPROFILE: profile, USERNAME: 'moa', OS: 'Windows_NT' }, ledger, bigSize: BIG_TEXT.length })
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab-stats' })
    expect(spawned).toEqual([['cmd', '/c', 'type', big]])
    await ui.press({ key: 'period-all' })
    // Only m1's copy is new: m3 sat before the offset and was skipped.
    expect(await kpi(ui, 'replies')).toContain('"1"')
    await ui.unmount()
  })

  test('finds transcripts as deep as workflow agents keep them', async ($, on) => {
    mock.clock(on, { now: EVENING })
    const deep = `${PROJECTS}/p/s9/subagents/workflows/wf_1`
    on('env.get', ($, e) => ({ value: ({ HOME, USER: 'moa' } as Record<string, string>)[e.name] }))
    on('session.id', () => ({ value: 's9' }))
    on('command.list', () => ({ value: COMMANDS }))
    on('fs.list', ($, e) => {
      const tree: Record<string, FsEntry[]> = {
        [PROJECTS]: [entry('p', 'dir')],
        [`${PROJECTS}/p`]: [entry('s9', 'dir')],
        [`${PROJECTS}/p/s9`]: [entry('subagents', 'dir')],
        [`${PROJECTS}/p/s9/subagents`]: [entry('workflows', 'dir')],
        [`${PROJECTS}/p/s9/subagents/workflows`]: [entry('wf_1', 'dir')],
        [deep]: [entry('agent-1.jsonl', 'file', 300)],
      }
      return { value: tree[e.path] ?? [] }
    })
    on('fs.read', ($, e) => {
      if (e.path === `${deep}/agent-1.jsonl`) return { value: reply('w1', 's9', 'claude-sonnet-5-5', 12) + '\n' }
      throw new Error(`no file ${e.path}`)
    })
    on('fs.write', () => ({ value: undefined }))
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab-stats' })
    await ui.press({ key: 'period-all' })
    expect(await kpi(ui, 'replies')).toContain('"1"')
    await ui.unmount()
  })

  test('the terminal shows the same numbers as text', async ($, on) => {
    machine(on)
    const ui = await $.ui.mount({ plugin: 'control-panel', surface: 'terminal', ...PANE })
    await ui.press({ key: 'tab-stats' })
    await ui.press({ key: 'period-all' })
    expect(await ui.find({ text: /Replies/ })).toBeDefined()
    expect(JSON.stringify(await ui.drawn())).toContain('Opus 5.5')
    await ui.unmount()
  })

  test('it reopens on the tab last used', async ($, on) => {
    machine(on)
    const stored: Record<string, unknown> = {}
    on('store.get', ($, e) => ({ value: stored[e.key] }))
    on('store.set', ($, e) => {
      stored[e.key] = e.value
      return { value: undefined }
    })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))

    const first = await $.ui.mount({ plugin: 'control-panel', surface: 'desktop', ...PANE })
    await first.press({ key: 'tab-stats' })
    await first.unmount()
    expect(stored['tab']).toBe('stats')
  })
})
