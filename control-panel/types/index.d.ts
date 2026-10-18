/** The panel's tabs. */
export type Tab = 'mods' | 'stats'
/** Which conversations the Stats tab counts: this one, or every one. */
export type Scope = 'session' | 'all'
/** Over which days the Stats tab counts every conversation. */
export type Period = 'today' | '7d' | '30d' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'control-panel': { tab: Tab; scope: Scope; period: Period }
  }
}
