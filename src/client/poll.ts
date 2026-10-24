/**
 * The dock row's poll loop: one read per conversation, scheduled by whether that
 * conversation is the one on screen.
 *
 * The loop it replaces was a bare four-second `setInterval` in a component that
 * the shell mounts once per *mounted* conversation — and inactive conversations
 * are keep-alive mounted. With twenty background conversations open, the rows
 * put five requests per second on the browser's per-origin HTTP/1.1 pool (six
 * sockets, one spent on the HMR stream), so any slow request behind them stalled
 * every other request of the page: the reported 20–90 s "freezes" whose length
 * was exactly the slowest in-flight request. The fault was on the emission side.
 *
 * What this class states, so the row cannot accidentally go back to the fleet:
 *
 * - **Activity decides** — an active conversation keeps the four-second cadence;
 *   an inactive one reads once at mount, stops, and reads once more when it
 *   becomes active again. Nothing polls for a conversation nobody is looking at.
 * - **No overlap by construction** — the next read is scheduled from the *end*
 *   of the previous one, so a slow response cannot stack a second request behind
 *   it; an explicit in-flight guard covers callers that also fire directly
 *   (`refreshNow` after a switch flip).
 * - **Teardown aborts** — the class owns one `AbortController` per read, so a row
 *   that unmounts (or a conversation that is switched away from) cannot leave a
 *   socket held by a request nobody will read.
 *
 * It takes its read from the caller and touches no React or `ctx`: the component
 * supplies `fetchState`, and the tests drive the clock and the reads directly.
 */

/** One read the row performs. It must honour the signal it is handed. */
export type StateRead = (signal: AbortSignal) => Promise<void>

export interface PollerOptions {
  /** The row's read, made abortable by the signal. */
  read: StateRead
  /** Cadence while the conversation is active, in milliseconds. */
  activeMs: number
}

export class StatePoller {
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private inFlight: AbortController | undefined
  private active = false

  constructor(private readonly options: PollerOptions) {}

  /**
   * The mount read, then the cadence that {@link setActive} decides.
   *
   * The first read happens for every row, active or not: a conversation switched
   * to must draw its switches before anything else has had a chance to ask, and
   * one read at mount is what makes that first frame honest.
   */
  start(): void {
    this.fire()
  }

  /**
   * Follow the framework's activity fact.
   *
   * Entering activity reads immediately — the row may have been parked for
   * hours — and leaving it cancels the pending tick. A read already in flight
   * settles quietly; it is one request, and the next scheduled read is what the
   * switch was for.
   * @param active - whether this row's conversation is the main one now.
   */
  setActive(active: boolean): void {
    if (this.stopped || active === this.active) return
    this.active = active
    if (active) this.fire()
    else this.cancel()
  }

  /** Read once now — the row uses it after a switch flip, and it never stacks. */
  refreshNow(): void {
    this.fire()
  }

  /**
   * Stop for good: drop the pending tick and abort a read in flight.
   *
   * After this call the poller schedules nothing and its read's completion does
   * nothing, so an unmounted row cannot write state or hold a socket.
   */
  stop(): void {
    this.stopped = true
    this.cancel()
    const controller = this.inFlight
    this.inFlight = undefined
    controller?.abort()
  }

  private cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private fire(): void {
    if (this.stopped || this.inFlight !== undefined) return
    this.cancel()
    const controller = new AbortController()
    this.inFlight = controller
    void this.options
      .read(controller.signal)
      .catch(() => {
        // A failed read is retried by the schedule that follows; narrating it
        // here would turn a transient host restart into an unhandled rejection.
      })
      .finally(() => {
        // A `stop()` or a newer read has taken over; this completion owns nothing.
        if (this.inFlight !== controller) return
        this.inFlight = undefined
        if (this.stopped || !this.active) return
        this.timer = setTimeout(() => this.fire(), this.options.activeMs)
      })
  }
}
