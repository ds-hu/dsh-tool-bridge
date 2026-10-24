/**
 * Shapes the browser half shares with the host.
 *
 * These are `import type` only: the client bundle is loaded by the shell's
 * frozen module table, so a value import from outside that table fails at load.
 * Duplicating two boolean flags as a type is the cheap side of that constraint.
 */

/** Which halves of the plugin a conversation has on. */
export interface ToggleState {
  bridge: boolean
  browser: boolean
}

/**
 * One conversation's local reference counts, as the shell publishes them.
 *
 * Mirrored here without taking `@deepseek-ai/dsh-client-ui-session` as a
 * dependency: that package's type augmentation is what puts the concrete hook on
 * the slot props, and this bundle reads the hook at runtime through the
 * renderer's standard kit, not through a module import.
 */
export interface SessionRetainInfo {
  /** Live references of this conversation, across every consumer source. */
  readonly referenceCount: number
  /** Positive counts per consumer source; `mainView` is the main column's. */
  readonly retainedBy: Readonly<Partial<Record<string, number>>>
}

/**
 * The `useSessionRetainInfo` selector hook every slot entry receives.
 *
 * Only the keyed call — the shape this row makes — is mirrored, so the answer is
 * always about the conversation the row is drawn for and never about whichever
 * conversation happens to be live. The shell's hook also offers a bare
 * seat-own form; a broader function is assignable to this shape.
 */
export type UseSessionRetainInfo = (
  sessionId: string,
  selector: (value: SessionRetainInfo | undefined) => boolean,
) => boolean
