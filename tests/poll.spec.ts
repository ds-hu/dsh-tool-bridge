/**
 * The poll loop behind the switch row.
 *
 * The loop exists for one measured failure: a row rendered once per mounted
 * conversation polled every four seconds from *every* row, active or not, and
 * the browser's per-origin HTTP/1.1 pool (six sockets, one held by the HMR
 * stream) stalled the whole page whenever a request was slow. So the properties
 * pinned here are the ones that keep a fleet of dormant rows harmless:
 *
 * - an inactive row reads once at mount and then schedules nothing;
 * - an active row keeps the four-second cadence;
 * - a read in flight is never overlapped by another;
 * - becoming active reads immediately (the row may have been parked for hours),
 *   becoming inactive cancels the next tick, and stopping aborts the read and
 *   silences it.
 *
 * The class takes its clock and its read from the caller, so these cases drive
 * fake timers and deferred reads directly: no network, no React, no host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StatePoller } from '../src/client/poll'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** One read per call, settled or failed by the test, recording the signals it saw. */
interface ControlledRead {
  read: (signal: AbortSignal) => Promise<void>
  /** Every signal a read has received, in call order. */
  signals: AbortSignal[]
  /** Resolve the reads made so far, then let their continuations run. */
  settle: () => Promise<void>
  /** Reject the reads made so far, then let their continuations run. */
  fail: () => Promise<void>
}

function controlledRead(): ControlledRead {
  const signals: AbortSignal[] = []
  let endpoints: Array<{ resolve: () => void; reject: (reason: unknown) => void }> = []
  return {
    signals,
    read: (signal) => {
      signals.push(signal)
      return new Promise<void>((resolve, reject) => {
        endpoints.push({ resolve, reject })
      })
    },
    settle: async () => {
      const pending = endpoints
      endpoints = []
      for (const endpoint of pending) endpoint.resolve()
      await flushContinuations()
    },
    fail: async () => {
      const pending = endpoints
      endpoints = []
      for (const endpoint of pending) endpoint.reject(new Error('host down'))
      await flushContinuations()
    },
  }
}

/**
 * Let a settled read's `.finally` run and schedule the next tick.
 *
 * The chain is promise → `.catch` → `.finally`, and the timer is set inside that
 * last callback, so one microtask turn is not enough to observe the schedule.
 */
async function flushContinuations(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('an inactive row', () => {
  it('reads once at mount and then schedules nothing', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })

    poller.start()
    expect(read.signals).toHaveLength(1)

    await read.settle()
    await vi.advanceTimersByTimeAsync(600_000)

    // The whole point: ten minutes of a parked conversation costs one read.
    expect(read.signals).toHaveLength(1)
    poller.stop()
  })

  it('stays silent after being deactivated', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()
    await read.settle()

    // One active tick starts a second read, and switching away must not let the
    // completion schedule a third.
    await vi.advanceTimersByTimeAsync(4000)
    expect(read.signals).toHaveLength(2)
    poller.setActive(false)
    await read.settle()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(read.signals).toHaveLength(2)
    poller.stop()
  })
})

describe('an active row', () => {
  it('keeps the four-second cadence, from the end of each read', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()

    expect(read.signals).toHaveLength(1)
    await read.settle()
    await vi.advanceTimersByTimeAsync(4000)
    expect(read.signals).toHaveLength(2)
    await read.settle()
    await vi.advanceTimersByTimeAsync(4000)
    expect(read.signals).toHaveLength(3)

    poller.stop()
  })

  it('never overlaps a read that has not finished', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()

    // The deferred read never settles: five cadences' worth of ticks must not
    // stack five requests behind it.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(read.signals).toHaveLength(1)
    poller.refreshNow()
    expect(read.signals).toHaveLength(1)

    await read.settle()
    await vi.advanceTimersByTimeAsync(4000)
    expect(read.signals).toHaveLength(2)
    poller.stop()
  })

  it('keeps polling after a failed read', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()

    await read.fail()
    await vi.advanceTimersByTimeAsync(4000)

    // A host restart must not end the row's cadence.
    expect(read.signals).toHaveLength(2)
    poller.stop()
  })
})

describe('becoming active', () => {
  it('reads immediately instead of waiting out a parked row', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.start()
    await read.settle()
    await vi.advanceTimersByTimeAsync(60_000)

    poller.setActive(true)
    expect(read.signals).toHaveLength(2)

    await read.settle()
    await vi.advanceTimersByTimeAsync(4000)
    expect(read.signals).toHaveLength(3)
    poller.stop()
  })

  it('dedups a mount read already in flight', () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()
    poller.setActive(true)

    expect(read.signals).toHaveLength(1)
    poller.stop()
  })
})

describe('stopping', () => {
  it('aborts the read in flight and silences its completion', async () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.setActive(true)
    poller.start()

    const signal = read.signals[0]
    expect(signal?.aborted).toBe(false)
    poller.stop()

    // Teardown must abort: a row that unmounts cannot leave a socket held.
    expect(signal?.aborted).toBe(true)
    await read.settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read.signals).toHaveLength(1)
  })

  it('does nothing when asked to start after stop', () => {
    const read = controlledRead()
    const poller = new StatePoller({ read: read.read, activeMs: 4000 })
    poller.stop()
    poller.start()

    expect(read.signals).toHaveLength(0)
  })
})
