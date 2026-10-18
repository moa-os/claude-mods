import type { CommandInfo } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { dateLabel, displayName, greetingOf, launchablesOf, partOfDay, titleOf } from '../hooks/panel'

const command = (name: string, source: CommandInfo['source'], plugin?: string, description = ''): CommandInfo =>
  plugin === undefined ? { name, source, description } : { name, source, plugin, description }

describe('panel', () => {
  test('splits the day into morning, afternoon, evening and night', () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22, 0].map(partOfDay)).toEqual([
      'night',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
      'night',
    ])
  })

  test('greets by the time of day, and late at night says so', () => {
    expect(greetingOf('morning', 'Moa')).toBe('Good morning, Moa')
    expect(greetingOf('evening', 'Moa')).toBe('Good evening, Moa')
    expect(greetingOf('night', 'Moa')).toBe('Working late, Moa')
    expect(greetingOf('afternoon', '')).toBe('Good afternoon')
  })

  test("names the panel after the person's login name", () => {
    expect(displayName('moa')).toBe('Moa')
    expect(displayName(undefined)).toBe('')
    expect(displayName('')).toBe('')
    expect(titleOf('Moa')).toBe("Moa's CP")
    expect(titleOf('')).toBe('Control panel')
  })

  test('writes the date the way the greeting strip shows it', () => {
    expect(dateLabel(new Date(2026, 9, 18, 21, 0))).toBe('Sun 18 Oct')
    expect(dateLabel(new Date(2026, 0, 5, 9, 0))).toBe('Mon 5 Jan')
  })

  test('lists the commands mods add, and the built-in diff, but not skills or itself', () => {
    const commands = [
      command('help', 'builtin'),
      command('find-docs', 'user'),
      command('superpowers:brainstorming', 'plugin', 'superpowers'),
      command('flow', 'plugin', 'agent-flow', 'Open the agent flow pane'),
      command('my-tasks', 'plugin', 'human-in-the-loop', 'Show the tasks Claude gave you'),
      command('cp', 'plugin', 'control-panel', 'Open your control panel'),
      command('replay', 'plugin', 'replay-theater', "Replay Theater: step through the last turn's file edits"),
      command('diff', 'builtin', undefined, 'Show uncommitted changes'),
    ]
    const launchables = launchablesOf(commands)
    expect(launchables.map(l => l.command)).toEqual(['flow', 'my-tasks', 'replay', 'diff'])
    expect(launchables.map(l => l.title)).toEqual(['Agent Flow', 'My Tasks', 'Replay Theater', 'Diff'])
    expect(launchables[2]?.blurb).toBe("Step through the last turn's edits")
    // Each known mod has a symbol of its own; a mod it does not know shows its first letter.
    expect(launchables.map(l => l.glyph)).toEqual(['⋔', '☑', '↻', '±'])
  })

  test('gives a mod it does not know a title, its own description and a steady colour', () => {
    const one = launchablesOf([command('mobile-mirror', 'plugin', 'mobile-mcp', 'Mirror the device screen')])
    const again = launchablesOf([command('mobile-mirror', 'plugin', 'mobile-mcp', 'Mirror the device screen')])
    expect(one[0]?.title).toBe('Mobile Mirror')
    expect(one[0]?.blurb).toBe('Mirror the device screen')
    expect(one[0]?.glyph).toBe('M')
    expect(one[0]?.colors).toEqual(again[0]?.colors)
  })
})
