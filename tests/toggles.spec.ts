/**
 * The per-directory switch memory — the **Project default**.
 *
 * The pain these cases exist for is a human one: flipping *Browser* on is the
 * step that gets forgotten, so the last flip in a directory has to become what
 * the next conversation there starts from, and the configured defaults must stop
 * being the only answer. Every inheritance assertion below therefore uses a
 * fixture where the remembered state *differs* from the configured defaults —
 * with the store seeding from the globals, each of these cases would fail.
 *
 * Two properties are easy to lose in refactoring and are pinned here: the name
 * bridge picks the first record in document order (which must survive a restart,
 * so the order has to survive the JSON round-trip), and it never writes — a flip
 * lands under the exact directory it happened in, whatever record it inherited
 * from.
 *
 * These drive the real `ToggleStore` against a document in the test scratch
 * directory; nothing above the store is involved.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ToggleStore } from '../src/host/toggles'
import type { ToggleState } from '../src/host/toggles'

const SCRATCH = fileURLToPath(new URL('./.tmp-toggles/', import.meta.url))

/** The configured (profile-level) defaults: browser off, so every inherited `on` is non-vacuous. */
const DEFAULTS: ToggleState = { bridge: true, browser: false }

const WEB_A = 'D:\\Projects\\refwatch\\web'
const WEB_B = 'D:\\Projects\\cuplivo\\web'
const WEB_C = 'D:\\Projects\\third\\web'
const DEMO = 'D:\\Projects\\demo'

beforeAll(() => {
  mkdirSync(SCRATCH, { recursive: true })
})

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true })
})

let counter = 0
function scratchFile(): string {
  counter += 1
  return join(SCRATCH, `${counter}-toggles.json`)
}

function open(file: string): ToggleStore {
  return new ToggleStore(file, DEFAULTS)
}

/** The project layer as it is actually written to disk. */
function projectRecordsOf(file: string): Record<string, ToggleState> {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { projects?: Record<string, ToggleState> }
  return raw.projects ?? {}
}

/**
 * Flip one switch in a directory through a throwaway session — the same path
 * production takes (`remember` then `set`), so the project record is created by
 * the production code and not by a test helper writing JSON.
 */
function flipIn(store: ToggleStore, sessionId: string, cwd: string, key: keyof ToggleState, value: boolean): void {
  store.remember(sessionId, cwd)
  store.set(sessionId, key, value)
}

describe('seeding a new conversation from its directory', () => {
  it('inherits the last flip in its directory instead of the configured defaults', () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'first', DEMO, 'browser', true)

    store.remember('second', DEMO)

    // The configured default is browser:false; only the project layer can say true.
    expect(store.get('second')).toEqual({ bridge: true, browser: true })
  })

  it('inherits both halves independently', () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'first', DEMO, 'bridge', false)
    flipIn(store, 'second', DEMO, 'browser', true)

    store.remember('third', DEMO)

    // bridge flipped off, browser flipped on: a seed that copied either the
    // globals or one half over both would not produce this pair.
    expect(store.get('third')).toEqual({ bridge: false, browser: true })
  })

  it('does not re-seed a session that already has a record', () => {
    const file = scratchFile()
    const store = open(file)
    store.remember('session', DEMO)
    store.set('session', 'browser', true)

    // A later remember with another directory updates where the session ran;
    // it must not hand the session a fresh state.
    store.remember('session', 'D:\\Projects\\elsewhere')

    expect(store.get('session')).toEqual({ bridge: true, browser: true })
  })

  it('seeds a conversation with no directory from the configured defaults', () => {
    const file = scratchFile()
    const store = open(file)

    // No remember: the directory is unknown, so there is nothing to inherit.
    store.set('lonely', 'browser', true)

    expect(store.get('lonely')).toEqual({ bridge: true, browser: true })
    // And nothing was written under a directory the session never named.
    expect(projectRecordsOf(file)).toEqual({})
  })
})

describe('last flip wins', () => {
  it("writes the directory's Project default on every flip", () => {
    const file = scratchFile()
    const store = open(file)

    flipIn(store, 'session', DEMO, 'browser', true)

    expect(projectRecordsOf(file)[DEMO]).toEqual({ bridge: true, browser: true })
  })

  it('rewrites the same record in place when flipped back', () => {
    const file = scratchFile()
    const store = open(file)
    store.remember('session', DEMO)
    store.set('session', 'browser', true)

    store.set('session', 'browser', false)

    const records = projectRecordsOf(file)
    expect(records[DEMO]).toEqual({ bridge: true, browser: false })
    // In place: a second key for the same directory would make "first in
    // document order" depend on how many times the switch was flipped.
    expect(Object.keys(records)).toEqual([DEMO])
  })
})

describe('the name bridge', () => {
  it('inherits the first same-named directory when the exact one has no record', () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'first', WEB_A, 'browser', true)

    store.remember('second', WEB_B)

    expect(store.get('second')).toEqual({ bridge: true, browser: true })
  })

  it('lets the first record in document order win, and keeps that answer across a restart', () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'first', WEB_A, 'browser', true)
    // WEB_B gets its own record, flipped off — it must not change what a third
    // directory with the same name inherits: WEB_A came first.
    flipIn(store, 'second', WEB_B, 'browser', true)
    store.set('second', 'browser', false)

    store.remember('third', WEB_C)
    expect(store.get('third')).toEqual({ bridge: true, browser: true })

    // The document is the durable record, not this instance's memory: reload and
    // ask again, exactly as the next harness restart would.
    const reloaded = open(file)
    reloaded.remember('fourth', WEB_C)
    expect(reloaded.get('fourth')).toEqual({ bridge: true, browser: true })
  })

  it.skipIf(process.platform !== 'win32')('compares folder names case-insensitively on Windows', () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'first', WEB_A, 'browser', true)

    store.remember('second', 'D:\\Projects\\other\\WEB')

    expect(store.get('second')).toEqual({ bridge: true, browser: true })
  })
})

describe('the name bridge is read-only', () => {
  it("writes the flipping directory's own record, never the one it inherited from", () => {
    const file = scratchFile()
    const store = open(file)
    flipIn(store, 'refwatch', WEB_A, 'browser', true)

    store.remember('cuplivo', WEB_B)
    // Seeded from WEB_A by name — now flip it off through the bridge.
    store.set('cuplivo', 'browser', false)

    const records = projectRecordsOf(file)
    expect(records[WEB_A]).toEqual({ bridge: true, browser: true })
    expect(records[WEB_B]).toEqual({ bridge: true, browser: false })

    // Each directory now answers for itself.
    store.remember('later-in-a', WEB_A)
    store.remember('later-in-b', WEB_B)
    expect(store.get('later-in-a').browser).toBe(true)
    expect(store.get('later-in-b').browser).toBe(false)
  })
})

describe('the document', () => {
  it('loads a document written before the projects layer existed', () => {
    const file = scratchFile()
    // The exact shape this plugin wrote until the layer was added.
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        sessions: { legacy: { bridge: true, browser: true, cwd: DEMO, changedAt: 1 } },
      }),
      'utf8',
    )
    const store = open(file)

    expect(store.get('legacy')).toEqual({ bridge: true, browser: true })
    // No remembered defaults yet: a new session in the legacy session's own
    // directory falls back to the configured defaults, and the next flip starts
    // the projects layer.
    store.remember('fresh', DEMO)
    expect(store.get('fresh')).toEqual({ bridge: true, browser: false })

    store.set('fresh', 'browser', true)
    expect(projectRecordsOf(file)[DEMO]).toEqual({ bridge: true, browser: true })
  })
})
