/**
 * Per-conversation toggles: which halves are on, kept durably.
 *
 * The state is two booleans per session, and it has to survive a resume — turning
 * the browser on for a conversation and finding it off after the harness
 * restarts would be worse than not having the switch. It is therefore a small
 * JSON document under the plugin's own state directory, written atomically
 * (temp file plus rename) so a crash mid-write leaves the previous record rather
 * than a truncated one.
 *
 * The document holds two layers, because two questions are being answered:
 *
 * - the **sessions** layer answers "what did this conversation have?", which is
 *   what makes a resume come back the way it was left;
 * - the **projects** layer answers "what does a new conversation here start
 *   with?", written by the last flip in a working directory — the **Project
 *   default**. A session that never flipped anything seeds from it instead of the
 *   configured defaults, so flipping *Browser* on once means every later
 *   conversation in that directory opens with it on.
 *
 * The configured defaults are the last resort: they apply only to a directory
 * nothing was ever flipped in, which keeps a profile-level default change
 * reaching conversations nobody switched on purpose — and lets it leave the
 * directories that have their own answer alone.
 *
 * Two invariants make the projects layer deterministic:
 *
 * - it is keyed by the exact working directory, and a lookup that misses falls
 *   back to the first remembered directory carrying the same folder name (a
 *   checkout opened elsewhere is the same project to the human who flipped the
 *   switch);
 * - document order is first-flip order and is never reordered — a `set` assigns
 *   into an existing key and nothing is ever deleted — so "the first match" is
 *   stable across restarts, and a JSON round-trip preserves it.
 *
 * The name bridge is **read-only**: a flip always writes the exact directory it
 * happened in (`rememberFlip`), so flipping through the bridge never mutates a
 * record for a directory the caller is not standing in.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Which halves of the plugin a conversation has on. */
export interface ToggleState {
  /** The toolchain tools (`bridge_run`, `bridge_arb_edit`). */
  bridge: boolean
  /** Playwright MCP's browser tools. */
  browser: boolean
}

/** One session's record: the switches, plus the directory it was switched in. */
interface SessionRecord extends ToggleState {
  /** The working directory this session ran in, for the sidebar's lane view. */
  cwd?: string
  /** Epoch ms of the last change, for a stable listing order. */
  changedAt: number
}

interface Document {
  version: 1
  sessions: Record<string, SessionRecord>
  /**
   * The **Project default** of each working directory, keyed by the exact
   * directory a flip happened in, in first-flip order (see the two invariants in
   * the module doc). Absent in a document written before this layer existed,
   * which loads as "no defaults yet" rather than as a corrupt file.
   */
  projects?: Record<string, ToggleState>
}

/** A document with nothing in it, freshly allocated so a spread cannot share a mutable `projects`. */
function empty(): Document {
  return { version: 1, sessions: {}, projects: {} }
}

/**
 * Windows compares folder names case-insensitively, as its filesystem does, so
 * the name bridge must too or a checkout opened as `D:\Projects\Web` would not
 * inherit `D:\Projects\web`'s default.
 */
const FOLD_NAMES = process.platform === 'win32'

/**
 * Whether two absolute directories share their folder name.
 *
 * Only the last segment is compared on purpose: the bridge is for "the same
 * project at another root", where the folder is what the human calls it.
 * @param a - one remembered directory, or the session's.
 * @param b - the other.
 * @returns whether their basenames are the same name.
 */
function sameFolderName(a: string, b: string): boolean {
  const left = basename(a)
  const right = basename(b)
  return FOLD_NAMES ? left.toLowerCase() === right.toLowerCase() : left === right
}

export class ToggleStore {
  private document: Document

  constructor(
    private readonly file: string,
    private readonly defaults: ToggleState,
  ) {
    this.document = this.load()
  }

  private load(): Document {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Document>
      if (raw.version !== 1 || typeof raw.sessions !== 'object' || raw.sessions === null) return empty()
      const projects =
        typeof raw.projects === 'object' && raw.projects !== null && !Array.isArray(raw.projects)
          ? (raw.projects as Record<string, ToggleState>)
          : {}
      return { version: 1, sessions: raw.sessions as Record<string, SessionRecord>, projects }
    } catch {
      // No file yet, or one this version cannot read: the defaults are the
      // honest answer, and the next write replaces the document.
      return empty()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    writeFileSync(temporary, JSON.stringify(this.document, null, 2), 'utf8')
    renameSync(temporary, this.file)
  }

  /**
   * The switches for one session.
   * @param sessionId - the conversation's session id.
   * @returns its state, or the configured defaults when it never changed one.
   */
  get(sessionId: string): ToggleState {
    const record = this.document.sessions[sessionId]
    if (record === undefined) return { ...this.defaults }
    return { bridge: record.bridge, browser: record.browser }
  }

  /** The directory this session was last seen in, for the sidebar. */
  cwd(sessionId: string): string | undefined {
    return this.document.sessions[sessionId]?.cwd
  }

  /**
   * The **Project default** for one working directory: the exact remembered
   * directory when there is one, else the first remembered directory carrying
   * the same folder name, then the configured defaults.
   *
   * Read-only by design — see the module doc for why a flip never lands here
   * under a foreign path.
   * @param cwd - the working directory a new conversation starts in.
   * @returns a copy of the state it seeds from.
   */
  private projectDefault(cwd: string): ToggleState {
    const projects = this.document.projects ?? {}
    const exact = projects[cwd]
    if (exact !== undefined) return { ...exact }
    for (const key of Object.keys(projects)) {
      // `projects` is a Record, so indexing is `ToggleState | undefined`; the
      // guard also keeps the spread below from widening the result.
      const record = projects[key]
      if (record !== undefined && sameFolderName(key, cwd)) return { ...record }
    }
    return { ...this.defaults }
  }

  /**
   * The default a new conversation in `cwd` seeds from, for the panel and the API.
   * @param cwd - the conversation's working directory, or `undefined` when unknown.
   * @returns the **Project default** there, or the configured defaults.
   */
  defaultsFor(cwd: string | undefined): ToggleState {
    return cwd === undefined ? { ...this.defaults } : this.projectDefault(cwd)
  }

  /**
   * Remember the directory a session runs in, without touching its switches.
   *
   * A session seen for the first time also **seeds** from its directory's
   * **Project default**, which is the whole mechanism: the record it will keep
   * for its whole life is written once, here, and a resume then has something
   * to come back to. An already-recorded session keeps its own state — the
   * remember call that arrives with a different directory does not re-seed.
   * @param sessionId - the conversation.
   * @param cwd - the directory it runs in.
   */
  remember(sessionId: string, cwd: string): void {
    const record = this.document.sessions[sessionId]
    if (record?.cwd === cwd) return
    this.document.sessions[sessionId] = {
      ...(record ?? { ...this.projectDefault(cwd), changedAt: Date.now() }),
      cwd,
      changedAt: record?.changedAt ?? Date.now(),
    }
    this.persist()
  }

  /**
   * Set one switch for one session and write it durably.
   *
   * Two records move, for two different questions: the session's own (a resume),
   * and — when the directory is known — the directory's **Project default** (a
   * new conversation there starts from the last flip). The project entry is
   * written under the session's exact directory, never under the key the lookup
   * bridged from, so a flip cannot rewrite another project's default.
   * @param sessionId - the conversation.
   * @param key - which half.
   * @param value - its new state.
   * @returns the session's complete state after the change.
   */
  set(sessionId: string, key: keyof ToggleState, value: boolean): ToggleState {
    const record = this.document.sessions[sessionId] ?? { ...this.defaults, changedAt: Date.now() }
    this.document.sessions[sessionId] = { ...record, [key]: value, changedAt: Date.now() }
    if (record.cwd !== undefined) this.rememberFlip(record.cwd, key, value)
    this.persist()
    return this.get(sessionId)
  }

  /**
   * Last-flip-wins: the flip becomes this directory's **Project default**.
   * @param cwd - the exact directory the flip happened in.
   * @param key - which half.
   * @param value - its new state.
   */
  private rememberFlip(cwd: string, key: keyof ToggleState, value: boolean): void {
    const projects = (this.document.projects ??= {})
    projects[cwd] = { ...this.projectDefault(cwd), [key]: value }
  }
}

/** Where the toggle document lives under a state directory. */
export function toggleFile(stateDir: string): string {
  return join(stateDir, 'toggles.json')
}
