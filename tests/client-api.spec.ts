/**
 * The client transport's abort contract.
 *
 * `fetchState` is called on a timer by a row that can unmount at any moment
 * (switching conversations, closing the panel). A read left in flight is a
 * socket the browser keeps holding, which is how the dock fleet jammed the
 * per-origin connection pool: even after cleanup, twenty sockets stayed busy.
 * So the signal has to travel all the way into `fetch`, and an aborted call is a
 * value — `{ ok: false }` — never a throw at the caller.
 *
 * No HTTP and no host: `globalThis.fetch` is stubbed, so what is under test is
 * exactly the plumbing between `fetchState` and the platform call.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchState } from '../src/client/api'

/** A well-formed `/state` answer; the fields the client reads. */
const SAMPLE = {
  sessionId: 'session-a',
  toggles: { bridge: true, browser: false },
  defaults: { bridge: true, browser: false },
  cwd: 'D:\\Projects\\demo',
  lanes: { queue: 0, long: 0 },
  browserMounted: false,
  browserError: null,
  jobs: [],
  config: {
    dartFormatExe: null,
    defaultTimeoutSec: 600,
    playwright: { browser: 'msedge', caps: 'vision,devtools', outputDir: null },
  },
}

/** A fetch stub that answers with {@link SAMPLE} and records how it was called. */
function answerFetch(): ReturnType<typeof vi.fn> {
  const mocked = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    text: async (): Promise<string> => JSON.stringify(SAMPLE),
  }))
  vi.stubGlobal('fetch', mocked)
  return mocked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchState’s abort plumbing', () => {
  it('hands the signal to the platform fetch', async () => {
    const mocked = answerFetch()
    const controller = new AbortController()

    const result = await fetchState('session-a', controller.signal)

    expect(result.ok).toBe(true)
    expect(mocked).toHaveBeenCalledTimes(1)
    const init = mocked.mock.calls[0]?.[1] as RequestInit
    // The load-bearing half: a signal that stops at this function is a read the
    // browser cannot cancel.
    expect(init.signal).toBe(controller.signal)
  })

  it('settles an aborted read as a failure value, not a throw', async () => {
    // The platform fetch rejects with an AbortError once its signal fires; the
    // client's job is to turn that into a value the row can ignore.
    const mocked = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      return { ok: true, status: 200, text: async (): Promise<string> => JSON.stringify(SAMPLE) }
    })
    vi.stubGlobal('fetch', mocked)
    const controller = new AbortController()
    controller.abort()

    const result = await fetchState('session-a', controller.signal)

    expect(result.ok).toBe(false)
  })
})
