# The working directory is pinned; there is no per-job cwd or baseline worktree

**Status**: accepted — amended to admit the **Workspace selector** (see
[Amendment](#amendment-a-workspace-selector-is-not-a-cwd-retarget))

Every job runs in the directory the bridge was started with, and no request can
change it. The obvious next feature — "run one command in a temporary worktree
checked out at another commit", for answering *was this test already failing
before my change?* — is therefore deliberately absent, because it would require a
per-job `cwd` and a new git verb, carve an exception into the one invariant that
makes the bridge predictable, and add a worktree lifecycle (locks, per-worktree
`build/`, a `pub get` per baseline) to answer a question that per-path restore
already answers for the common case.

## Considered options

- **Per-job `cwd` restricted to descendants of the pinned directory, plus
  `git worktree add/remove`.** The full capability. Deferred: new lifecycle and
  a weakened invariant, for a question that comes up rarely.
- **Allow `git worktree` verbs and let the caller manage lifecycle.** Smaller,
  still breaks the one-directory rule, and leaves stale worktrees and held locks
  for a human to clean up.
- **Allow `git restore --source=<rev>` (path-scoped baselines).** Nearly free and
  currently refused with the rest of `--source`; it answers "the parent commit's
  version of *these files*" but not "a coherent tree at that commit" (a changed
  `pubspec.yaml` needs its own `pub get`), so it would be a half-answer that
  looks like a whole one.

## Consequences

- The sanctioned baseline experiment is **backup-and-restore**: copy the dirty
  files to a scratch directory inside the workspace (writes there are already
  permitted), `git restore -- <paths>`, run the job, copy the files back. It uses
  only what the bridge already allows, and it answers the question for
  *uncommitted* work — which is what a failing slice usually is.
- DSH already runs sessions inside per-session git worktrees
  (`~/.dsh/worktrees/<id>/<project>`), so worktree-per-isolation is a platform
  facility, not something the bridge should grow a second copy of.
- Revisit this when baseline attribution *of a different commit* recurs as a real
  cost — that is the trigger, not the existence of the idea.

## Amendment: a workspace selector is not a cwd retarget

A monorepo cannot be driven without one: the DSH repository's own
`package.json` scripts and two of its docs say `pnpm --filter
@deepseek-ai/dsh-desktop run bundle`, and a session at the repo root had no way
to run it — the pre-verb spelling was refused ("pnpm needs a verb before flags"),
and the post-verb spelling was accepted *only because nothing looked at
`--filter` at all*: `pnpm run --filter ../.. build` validated and ran a build
outside the pinned cwd.

So the surface now accepts both managers' own selector — pnpm's
`--filter`/`-F`, npm's `-w`/`--workspace` — on either side of the verb, and
guards it. The distinction from a retarget is the starting point: `-C`,
`--prefix`, `--workspace-root` and `-g` **move the manager**, so the pinned cwd
stops being where the job runs; a selector leaves the manager in the pinned cwd
and picks a member of the workspace that directory already belongs to. The lane
key is therefore unchanged, which is the property ADR-0002 exists to protect.

Two things are refused on purpose:

- **The whole-workspace spellings** (`--workspaces`, `-ws`,
  `--include-workspace-root`, and pnpm's `-w`/`--workspace`, which is
  `--workspace-root` there; a `!` exclusion counts, because it means every
  member *except* the ones named). One invocation that writes into every package
  multiplies the writes and defeats the one-target-per-lane assumption.
- **A directory selector outside the tree** (`../..`, an absolute path, a drive,
  a glob). A selector that names a *directory* is held to the same literal-path
  rules `git restore`'s pathspecs and `gradlew -p` already use; `.` is accepted
  because it is anchored at the pinned cwd itself.

### What this costs, stated honestly

- **A package *name* is resolved by the workspace, not by this bridge**, so it
  may land in a member the pinned cwd does not contain. The lane stays keyed by
  the pinned cwd, so a session at the root and a session inside one package can
  drive the same subtree from two lanes. That race is not new: `gradlew -p
  android` has it, and the alternative — reading `pnpm-workspace.yaml` and
  re-implementing the manager's matcher — is the mistake ADR-0006 rejected for
  lockfile detection.
- **The long-lane guess had to learn where the verb is.** It read the first
  non-flag token as the script name, so `pnpm run --filter web dev` was guessed
  one-shot — a dev server on the queue lane, starving every build behind it.
  Reading past the flags that take a value fixes it, and the selector's position
  no longer decides the lane.

### Rejected

- **Paths only** (`--filter ./packages/web`, names refused). Containment would be
  provable, at the price of refusing the spelling the ecosystem documents.
- **Resolve each name against the workspace config** and require the member to be
  under the cwd. Closes the lane race too, and re-implements a manager's matcher
  (globs, `!` exclusions, catalogs) — the same rejection ADR-0006 recorded.
- **No selector guard at all.** Simplest, and self-contradictory: `-C` and
  `--prefix` are refused for exactly what `--filter ../..` would do.
