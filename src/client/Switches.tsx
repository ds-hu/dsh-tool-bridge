/**
 * The switch row: two labelled capability switches, above the input card.
 *
 * The row is a full-width `conversation.input.dock` entry — the framework's own
 * seat for "full-width entries above the composer card" — so it is aligned with
 * the input card rather than the viewport (the clearance formula the shell's own
 * dock entries use), and on a phone it has a row to itself instead of competing
 * with the conversation header's action strip.
 *
 * The one rule this row exists to respect: **a switch shows intent, and intent
 * is not a fact.** A conversation can have the browser switched on with no
 * connection behind it — while it starts, or because the server would not come
 * up. So each half is a controlled `Switch` (position = intent, click = toggle,
 * disabled while a write is in flight), and a state word appears beside the row
 * *only* when the fact differs from the intent — in red, with the reason, when
 * the mount failed. A row showing "on" over an absent browser would be the one
 * failure mode worth this much comment.
 *
 * The second rule is about when the row asks the host at all. The shell keeps
 * inactive conversations mounted, so this row is drawn once per conversation
 * that has ever been opened — and the row used to poll `/state` every four
 * seconds from every one of them. Twenty background conversations meant five
 * requests per second against the browser's per-origin HTTP/1.1 pool (six
 * sockets, one spent on the HMR stream), so one slow request stalled the whole
 * page behind it: the reported 20–90 s WebUI freezes. The read now follows the
 * shell's own answer to "which conversation is on screen" — the main view
 * retains one session at a time (`retainedBy.mainView`, the exact fact
 * `ui-session` and the layout use) — so an inactive row reads once at mount,
 * stops, and reads once more when it becomes active. `StatePoller` owns that
 * schedule, the in-flight guard and the abort on teardown.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconCodeOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import { fetchState, postToggle } from './api'
import { StatePoller } from './poll'
import { danger, muted } from './theme'
import type { SessionView } from './api'
import type { SessionRetainInfo, ToggleState, UseSessionRetainInfo } from './types'

/** Cadence while this row's conversation is the active one. */
const POLL_MS = 4000

/**
 * A shell that does not publish the retain-info hook: keep the old behaviour
 * (always considered on screen) rather than fail to draw the row. The hook is
 * optional in the props type for the same reason.
 */
const useAlwaysActive: UseSessionRetainInfo = () => true

/** What the registration hands this row. */
export interface SwitchesInjected {
  /** This row's conversation (the dock's owner props carry the input zone, not the session). */
  sessionId: string
  /** Open the tool-bridge panel in the right sidebar. */
  openPanel: () => void
}

/**
 * The dock entry's props: the framework runtime face (which carries the global
 * standard kit, including the retain-info selector), what `inject` supplies, and
 * the one standard hook this row reads.
 */
export type SwitchesProps =
  & PropsRuntime<'conversation.input.dock'>
  & InjectFace<SwitchesInjected>
  & {
      /**
       * The renderer's session-retain selector, handed to every session-scope
       * entry. The keyed call asks about *this* row's conversation, so the row
       * never mistakes whichever conversation is live for its own.
       */
      useSessionRetainInfo?: UseSessionRetainInfo
    }

/**
 * Align the row with the composer card, not the viewport.
 *
 * These are the shell's own dock variables: a fixed side clearance up to the
 * card's maximum width, and a centering offset beyond it. Applied on both sides
 * the row comes out exactly as wide as the card it sits above.
 */
const CLEARANCE =
  'max(var(--dsh-composer-side-clearance, 16px), calc((100% - var(--dsh-composer-card-max-width, 920px)) / 2))'

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: '14px',
  rowGap: '4px',
  minHeight: '24px',
  marginLeft: CLEARANCE,
  marginRight: CLEARANCE,
}

/**
 * The row sits in the composer's shadow, beside a 24px diff pill and 12px tool
 * rows, so its label is set at that size instead of inheriting the composer's
 * larger body text — which is what made the first cut read oversized.
 */
const labelStyle: React.CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: '12px',
  lineHeight: '16px',
  marginRight: '6px',
}

const halfStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center' }

/**
 * The switch is a full-size control — the shell's settings rows have the room
 * for one — and beside 12px type it reads heavy. Scaling the *wrapper* leaves
 * the control itself untouched (same component, same semantics, same hit area)
 * while bringing it into the row's weight class; the negative margin reclaims
 * the layout box that a transform does not shrink.
 */
const switchStyle: React.CSSProperties = {
  display: 'inline-flex',
  transform: 'scale(0.85)',
  transformOrigin: 'left center',
  marginRight: '-5px',
}
/** Pushes the panel shortcut to the row's far end. */
const spacerStyle: React.CSSProperties = { marginLeft: 'auto' }
/**
 * The row's status words.
 *
 * Both come from the shared vocabulary rather than from a token spelled here:
 * `--dsw-alias-label-error`, which this row used to name, is defined nowhere in
 * the theme, so the failure it coloured was never actually red.
 */
const noteStyle: React.CSSProperties = { fontSize: '12px', ...muted }
const failureStyle: React.CSSProperties = { fontSize: '12px', ...danger }

/** One switch with its visible name. */
function Half({
  name,
  description,
  checked,
  disabled,
  onChange,
}: {
  name: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}): React.ReactElement {
  return (
    <span style={halfStyle}>
      <span style={labelStyle}>{name}</span>
      <span style={switchStyle}>
        <Switch checked={checked} disabled={disabled} label={name} title={description} onChange={onChange} />
      </span>
    </span>
  )
}

/**
 * Render the switch row for one conversation.
 * @param props - the framework runtime face, the injected session/panel opener, and the retain-info selector.
 */
export function Switches({
  sessionId,
  openPanel,
  useSessionRetainInfo,
}: SwitchesProps): React.ReactElement | null {
  const [view, setView] = useState<SessionView | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState<keyof ToggleState | null>(null)

  // The shell's own activity fact: the main view retains exactly one session at
  // a time, and it is the conversation the user is looking at. Reading the fact
  // here (rather than a global "current id" this plugin would have to keep in
  // sync) is what makes an inactive row stop polling for good.
  const retain: UseSessionRetainInfo = useSessionRetainInfo ?? useAlwaysActive
  const active = retain(sessionId, (info: SessionRetainInfo | undefined): boolean =>
    (info?.retainedBy.mainView ?? 0) > 0,
  )

  /** Guards a late read from writing into an unmounted row. */
  const mounted = useRef(true)
  /** The poller this row owns; replaced when the conversation changes. */
  const poller = useRef<StatePoller | null>(null)
  /** The latest activity answer, for effects that must not re-create the poller. */
  const live = useRef(active)

  useEffect(() => {
    live.current = active
    poller.current?.setActive(active)
  }, [active])

  useEffect(() => {
    if (sessionId === '') return undefined
    mounted.current = true
    const instance = new StatePoller({
      activeMs: POLL_MS,
      read: async (signal) => {
        const result = await fetchState(sessionId, signal)
        // Aborted or unmounted: the answer belongs to nobody. The poller's
        // stop() is what aborts, so this branch is the teardown path.
        if (!mounted.current || signal.aborted) return
        if (result.ok) {
          setView(result.value)
          setFailure(null)
        } else {
          setFailure(result.message)
        }
      },
    })
    poller.current = instance
    instance.setActive(live.current)
    instance.start()
    return () => {
      mounted.current = false
      poller.current = null
      instance.stop()
    }
  }, [sessionId])

  const flip = useCallback(
    async (key: keyof ToggleState, value: boolean): Promise<void> => {
      if (sessionId === '') return
      setPending(key)
      const result = await postToggle(sessionId, key, value)
      setPending(null)
      if (result.ok) {
        setView((current) => (current === null ? current : { ...current, toggles: result.value.toggles }))
        setFailure(null)
        // The browser connects after the answer, so read again now rather than
        // waiting out the cadence; the poller dedups a read already in flight.
        poller.current?.refreshNow()
      } else {
        setFailure(result.message)
      }
    },
    [sessionId],
  )

  if (sessionId === '') return null
  const toggles = view?.toggles ?? null
  const ready = toggles !== null && pending === null
  // Intent on, no connection, no recorded failure: it is on its way up.
  const starting = view !== null && view.toggles.browser && !view.browserMounted && view.browserError === null
  const browserFailure = view?.browserError ?? failure

  return (
    <div style={rowStyle} data-toolbridge-row="">
      <Half
        name="Toolchain"
        description="bridge_run and bridge_arb_edit in this conversation: Flutter, Dart, a guard-railed git, pnpm/npm, and the project's own vite/vitest/tsc."
        checked={toggles?.bridge ?? false}
        disabled={!ready}
        onChange={(next) => void flip('bridge', next)}
      />
      <Half
        name="Browser"
        description="Playwright MCP in this conversation, mounted for it alone: the server exists only while this is on."
        checked={toggles?.browser ?? false}
        disabled={!ready}
        onChange={(next) => void flip('browser', next)}
      />
      {browserFailure !== null ? (
        <span style={failureStyle} role="alert">
          browser failed: {browserFailure}
        </span>
      ) : starting ? (
        <span style={noteStyle}>browser starting…</span>
      ) : null}
      <span style={spacerStyle} />
      <Button
        // `ghost`, not `toolbar`: the toolbar variant draws a filled chip, which
        // reads as a second primary control in a row whose subject is the two
        // switches. The panel is a way out of this row, not a third capability.
        variant="ghost"
        size="sm"
        // The same glyph the panel's own tab chip draws, and a code one: the
        // `panel` family draws a *left* column, which is not the column this
        // opens.
        icon={<IconCodeOutlineRegular />}
        aria-label="Open the tool-bridge panel"
        title="Open the tool-bridge panel: lanes, jobs, digests and logs for this conversation."
        onClick={() => openPanel()}
      />
    </div>
  )
}
