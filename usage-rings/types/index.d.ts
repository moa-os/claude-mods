/** One limit window: how much is used (0 to 100) and when it resets (epoch ms). */
export type Reading = { percent: number; resetsAt: number | null }

/** The three windows the band draws; null until a source has reported one. */
export type Limits = {
  fiveHour: Reading | null
  weekly: Reading | null
  fable: Reading | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-rings': { limits: Limits; tick: number }
  }
}
