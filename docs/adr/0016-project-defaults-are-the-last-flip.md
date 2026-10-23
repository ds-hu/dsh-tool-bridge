# Project defaults are the last flip in a directory

**Status**: accepted

Both switches were durable per session and their *default* was one profile-wide
pair — `defaults.bridge: true`, `defaults.browser: false`. So every conversation
that was about to do a UI walkthrough started with the browser off, and the only
way to say otherwise was a flip inside that conversation. The flip is not the
cost; forgetting it is. A default that never follows the human is a default that
is wrong for exactly the conversations that needed it most.

The request that opened this: *"Can we persist default value of whether Browser is
enabled per-project? Or else I always forget to open the browser for tasks that
need it."*

## Decision

**The last flip in a working directory becomes the default for the next
conversation there.**

Three parts:

- **The document grows a second layer.** `toggles.json` keeps its per-session
  records and gains `projects`: a map from a working directory to the switch
  state, written by every flip in that directory (both halves — the switch row is
  symmetric, and an asymmetric memory would be a rule nobody can state).
- **A new conversation seeds from that layer.** `remember` — the one call that
  sees a conversation for the first time — seeds the session record from its
  directory's **Project default** instead of the configured defaults. A resume is
  untouched: an existing record keeps its own state.
- **The lookup bridges by folder name, read-only.** No key for the exact
  directory? The first remembered directory with the same leaf name answers
  (case-insensitively on Windows). The bridge never writes: a flip lands under the
  exact directory it happened in, never under the record it inherited from.

The configured `defaults.*` stay, as the last resort: they answer for a directory
nothing was ever flipped in, which keeps a profile-level change reaching
conversations nobody switched while leaving the directories that have their own
answer alone.

## Why the exact directory, and why a name bridge

The exact working directory is already this plugin's way of saying *where a
conversation stands* — a **Lane** pair is keyed by it (ADR-0002's working
directory), and the session record already remembers it. Keying defaults the same
way introduces no second notion of location.

The bridge exists for a different checkout of one project: another clone, another
drive spelling, the same folder a human calls the project. Naive on purpose —
first record in document order wins, no git discovery, no filesystem walk. The
cost is accepted below.

What the bridge deliberately does **not** do: make a session in
`D:\Projects\dsh\packages\web` inherit a flip at `D:\Projects\dsh`. That session is
its own key, exactly as it is its own Lane. Ancestor containment was considered
(§ Considered options) and rejected — a flip in a parent-level "hub" session would
then propagate to every project under it.

## Accepted costs

- **Same-name directories cross-wire.** `D:\Projects\cuplivo\web` silently
  inherits the browser `D:\Projects\refwatch\web` asked for, until a conversation
  in `cuplivo\web` flips something. Nothing in the switch row shows where an
  inherited default came from. Accepted: the alternative is a default that never
  follows the human.
- **No one-off exceptions.** Turning a half off for one conversation changes what
  the next conversation there starts from — including the toolchain: a chat-only
  conversation that stripped `bridge_run` from its prompt leaves the next
  conversation in that directory starting the same way. Accepted, because the row
  sits above the input: the inherited state is visible before it costs anything,
  and correcting it is one flip.
- **`defaults.*` narrows.** A new global default no longer reaches a directory
  with a remembered record, only directories nothing was flipped in, and
  same-name fallbacks. This is the point of the layer, and it is documented where
  the config is.
- **The bridge is read-only, so same-named directories diverge.** After a flip in
  a directory bridged from another, each remembers itself. That is the guard that
  keeps the accepted *read* risk from becoming a *write* risk: flipping in
  `cuplivo\web` can never rewrite `refwatch\web`.
- **A downgrade is lossy in one layer.** An older plugin rebuilds the document from
  its in-memory copy on the next write and drops `projects`; session records
  survive as before.
- **Order is the rule.** "First with the same folder name" means first in the
  document, i.e. first-flip order — assignment into an existing key keeps its
  position and nothing is ever deleted, and a JSON round-trip preserves it, so
  the answer is stable across restarts. A reload test pins it.

## Considered options

- **An explicit "save as project default" control.** Predictable, but the action
  is the thing that gets forgotten — it trades one missed flip for one missed
  save, which is not a fix for the reported pain. Rejected.
- **An in-repo file, like the known-failure registry** (`.toolbridge/defaults.json`
  beside `known-failures.json`). Travels with the checkout and is shared by a
  team... but a switch default is a personal habit, not a property of the
  repository; committing it to a shared repo is wrong by default and needs a
  gitignore to be safe, and the lookup would need the repo-root discovery rule
  this plugin deliberately does not have. Rejected.
- **Ancestor containment** (the nearest enclosing remembered directory answers).
  Covers subdirectory sessions, but a flip made in a session opened at a parent
  ("hub") directory would leak into every project below it, and the plugin has no
  way to tell the hub from the project. Rejected in favour of name bridging.
- **Strict exact match only.** No bridge: a same-named checkout elsewhere has no
  memory, which is the one case the request imagined. Rejected, and recorded here
  as the reason the naive bridge exists at all.

## Consequences

- `src/host/toggles.ts` holds both layers; `defaultsFor(cwd)` is the read the
  sidebar's `/state` answer now reports, so the panel field means "what a new
  conversation here would seed from", not "the profile defaults".
- No API route, no client component and no config key changed. The switch row
  needs nothing: an inherited default simply arrives as the conversation's
  initial toggle state.
- `tests/toggles.spec.ts` pins the seeding, last-flip-wins, both-halves, the name
  bridge's document order across a reload, the read-only bridge and the old
  document shape. With the seeding reverted to the configured defaults, six of
  its eleven cases fail — the assertion is measured, not assumed.
