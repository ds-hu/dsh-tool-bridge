/**
 * The switch row's polling contract, pinned as source assertions.
 *
 * The defect these cases exist for is invisible to a component test and was
 * invisible to a human: every keep-alive mounted conversation drew one dock row,
 * and each row polled `/toolbridge/api/state` every four seconds with no
 * activity gate. Twenty background conversations therefore sat on the browser's
 * per-origin HTTP/1.1 connection pool (6 sockets, one taken by the HMR stream),
 * so any slow request stalled the whole page behind it — measured as UI freezes
 * of 20–90 s whose length was the slowest in-flight request.
 *
 * The component cannot be imported in Node (the shell's frozen module table does
 * not resolve here), so these cases read the sources the way the panel cases do:
 * comments stripped, then the code that runs. They are deliberately about the
 * *shape* that failed — a bare `setInterval` per row, and a row that never asks
 * whether its conversation is the active one — because that shape is exactly
 * what a future refactor could reintroduce.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = join(HERE, '..', 'src', 'client')

/** One client source, as text. */
function read(file: string): string {
  return readFileSync(join(CLIENT_DIR, file), 'utf8')
}

/**
 * The same source with its comments removed.
 *
 * These files explain the defect they were fixed for, so the very words the
 * cases look for appear in the prose around the code. The scan has to be about
 * what the code does, or it would fail on a correct comment and pass on a
 * comment alone.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
}

describe('the switch row’s polling', () => {
  const SWITCHES = code(read('Switches.tsx'))

  it('schedules through the activity-aware poller, never a bare interval', () => {
    // The fleet's shape: `setInterval(() => void refresh(), 4000)` in a row that
    // is drawn once per mounted conversation, active or not.
    expect(SWITCHES).not.toContain('setInterval')
    expect(SWITCHES).toContain('new StatePoller(')
  })

  it('gates on the framework’s own activity fact, not a guess', () => {
    // `retainedBy.mainView` is how the shell itself decides which conversation
    // is the one on screen (ui-session's publishMain, ui-layout's projection);
    // the dock entry receives the selector hook through the renderer's standard
    // kit. A row that read anything else would invent a second notion of
    // "active".
    expect(SWITCHES).toContain('useSessionRetainInfo')
    expect(SWITCHES).toContain('retainedBy.mainView')
  })

  it('stops on teardown and reads through the abortable fetch', () => {
    expect(SWITCHES).toContain('.stop()')
    expect(SWITCHES).toContain('fetchState(sessionId, signal)')
  })
})

describe('the sidebar panel’s polling', () => {
  it('stays a single-instance interval — deliberately not part of this change', () => {
    // The panel is one component per open tab, not one per mounted session, so
    // its 4 s cadence was never the fleet. Pinned so a future "fix the polling"
    // sweep does not fold it in.
    const PANEL = code(read('BridgePanel.tsx'))
    expect(PANEL).toContain('setInterval(() => void refresh(), 4000)')
  })
})
