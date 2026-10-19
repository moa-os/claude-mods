import type { EngineInterface } from 'claude-code'

import type { Ledger } from './stats'
import { dayOf, ledgerOf, prune, record, replyOf } from './stats'

// A mod reads at most 4 MiB a call; a larger transcript is streamed through a host command.
const READ_LIMIT = 4 * 1024 * 1024
// How long the ledger remembers which replies it counted: a conversation resumed later than this
// could count its copied replies again, which is rare; the list would otherwise grow without end.
const KEEP_SEEN_DAYS = 60
// Saving every few transcripts keeps a long first count from starting over if the session ends.
const SAVE_EVERY = 10
// How deep under `projects` transcripts sit: a workflow's agents keep theirs five folders down
// (`<project>/<session>/subagents/workflows/<run>/`); the rest is room to spare.
const MAX_DEPTH = 8

/** Claude Code's folder: CLAUDE_CONFIG_DIR when set, else `.claude` in the home folder. */
export async function claudeFolder($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  if (configured !== undefined && configured !== '') return configured
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home === undefined ? undefined : `${home}/.claude`
}

/** Where the panel keeps its ledger: beside Claude Code's own files, outside the mod's install folder. */
export function ledgerPath(folder: string): string {
  return `${folder}/control-panel/stats.json`
}

/** The UTF-8 size of `text` in bytes: transcripts are read from a byte offset. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/**
 * Splits `buffer` into its complete lines, handing each with its size in bytes (newline
 * included) to `onLine`, and returns the part after the last newline.
 */
export function takeLines(buffer: string, onLine: (line: string, bytes: number) => void): string {
  let start = 0
  for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n', start)) {
    const line = buffer.slice(start, end)
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line, utf8Length(line) + 1)
    start = end + 1
  }
  return buffer.slice(start)
}

type Transcript = { path: string; size: number }

async function listTranscripts($: EngineInterface, folder: string): Promise<Transcript[]> {
  const found: Transcript[] = []
  const walk = async (dir: string, depth: number) => {
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'dir' && depth < MAX_DEPTH) await walk(path, depth + 1)
      else if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) found.push({ path, size: entry.size })
    }
  }
  await walk(`${folder}/projects`, 0)
  return found
}

/**
 * Reads a transcript from byte `offset`, handing each complete line to `onLine`, and returns
 * the offset after the last complete line: a line still being written is read next time.
 */
async function readFrom(
  $: EngineInterface,
  file: Transcript,
  offset: number,
  isWindows: boolean,
  onLine: (line: string) => void,
): Promise<number> {
  let consumed = 0
  if (offset === 0 && file.size <= READ_LIMIT) {
    takeLines(await $.fs.read(file.path), (line, bytes) => {
      onLine(line)
      consumed += bytes
    })
    return consumed
  }

  // macOS and Linux start at the offset with tail; Windows has no tail, so its whole file is
  // streamed and the part already read is skipped here.
  let skip = isWindows ? offset : 0
  const argv = isWindows ? ['cmd', '/c', 'type', file.path] : offset > 0 ? ['tail', '-c', `+${offset + 1}`, file.path] : ['cat', file.path]
  let buffer = ''
  for await (const piece of $.process.spawn({ argv })) {
    if (piece.stream !== 'stdout') continue
    buffer = takeLines(buffer + piece.text, (line, bytes) => {
      if (skip > 0) {
        skip -= bytes
        return
      }
      onLine(line)
      consumed += bytes
    })
  }
  return offset + consumed
}

/** The ledger saved before, or an empty one. */
export async function loadLedger($: EngineInterface, folder: string): Promise<Ledger> {
  try {
    return ledgerOf(await $.fs.read(ledgerPath(folder)))
  } catch {
    return ledgerOf(undefined)
  }
}

async function saveLedger($: EngineInterface, folder: string, ledger: Ledger) {
  try {
    await $.fs.write(ledgerPath(folder), JSON.stringify(ledger))
  } catch {
    // The counts stay in memory; the next save tries again.
  }
}

/**
 * Counts every reply in the transcripts that grew since the ledger last read them, saving the
 * ledger as it goes. `onProgress` hears how many transcripts are done of how many changed.
 */
export async function countTranscripts(
  $: EngineInterface,
  folder: string,
  ledger: Ledger,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const changed = (await listTranscripts($, folder)).filter(file => ledger.files[file.path]?.size !== file.size)
  onProgress(0, changed.length)
  for (const [i, file] of changed.entries()) {
    const mark = ledger.files[file.path]
    // A transcript that shrank was rewritten: read it from the start, its replies counted once.
    const offset = mark !== undefined && mark.offset <= file.size ? mark.offset : 0
    try {
      const next = await readFrom($, file, offset, isWindows, line => {
        const reply = replyOf(line)
        if (reply !== null) record(ledger, reply)
      })
      ledger.files[file.path] = { size: file.size, mtimeMs: 0, offset: next }
    } catch {
      // Unreadable now: it is tried again next time.
    }
    onProgress(i + 1, changed.length)
    if ((i + 1) % SAVE_EVERY === 0) await saveLedger($, folder, ledger)
  }
  prune(ledger, dayOf(new Date(await $.clock.now())), KEEP_SEEN_DAYS)
  await saveLedger($, folder, ledger)
}
