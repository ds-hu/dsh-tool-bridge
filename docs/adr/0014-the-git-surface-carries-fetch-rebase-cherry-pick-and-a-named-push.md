# The git surface carries fetch, rebase, cherry-pick and a named push

**Status**: accepted

The git surface was seven verbs — `status`, `diff`, `log`, `add`, `commit`,
`branch`, `restore` — and the omissions were not argued, they were inherited:
`push`, `rebase`, `cherry-pick` and `fetch` were refused by simply not being on
the list. Driving a fork that is kept in step with upstream needs three of them
in one loop: fetch upstream, rebase onto it, push the branch. Without `fetch` a
rebase can only move onto a ref already in the clone, so admitting `rebase`
alone would have been decorative; without a push the loop ends in the harness's
shell tool, one escalated `git push` per iteration.

That last hop is the measurement that decided this. It is not a safety margin:
the sandbox cannot spawn git's credential helper, so a confined push dies with
`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS` and has to be
escalated and retried; and ADR-0001's claim that `git push` was refused because
"a GitHub token must never live in a long-running process" was never true of
this plugin — the plugin *is* the harness process. Authentication is the
machine's own git credential store, which the plugin neither reads nor writes;
what the refusal bought was one approval click.

## The decision

Four verbs are admitted, and each one is narrowed by the reason a job is not an
interactive terminal:

| Verb | Accepted | Refused, and why |
| --- | --- | --- |
| `fetch` | remotes, refspecs, `--prune`, `--all` | `--force`/`-f` (overwrites local tags and branches, which the fetch did not originate), `--tags`/`-t` (writes every remote tag), `--upload-pack`/`--receive-pack` (runs an arbitrary program), `--recurse-submodules` (writes inside submodules) |
| `rebase` | a base, `--onto`, `--autostash`, `--abort`/`--continue`/`--skip`/`--quit` | `-i`/`--interactive`/`--autosquash`/`--edit-todo` (**it would block**: no terminal, so the editor never answers and the job holds the Queue lane), `-x`/`--exec` (arbitrary commands), `--update-refs` (moves branch refs the caller did not name) |
| `cherry-pick` | commits, ranges, `-x`, `-n`, `--abort`/`--continue`/`--skip` | `-e`/`--edit` (it would block) |
| `push` | one named remote, one named destination ref per refspec, `-u`, `--dry-run`, `--porcelain`, `--quiet`, `--verbose`, `--progress`, `--atomic`, `--no-verify` | `--force`/`-f`/`--force-with-lease`/`--force-if-includes`, `--delete`/`-d`, `--mirror`, `--all`/`--branches`, `--tags`, `--follow-tags`, `--prune`, `--repo`, `--receive-pack`/`--exec`; a `+refspec`, a `:refspec` and a wildcard refspec; a path or `file:` remote; and a bare `git push` |

The three refusal reasons are new as a *category*, which is why they are named in
`CONTEXT.md` rather than only in the tables:

1. **It would publish or overwrite something the caller never named.** This is
   ADR-0001's existing rule, extended from paths to refs: `restore` must name the
   files it discards, a push must name the ref it publishes. A non-force push
   cannot destroy remote work — the server rejects it — but it can publish to a
   ref nobody named (a bare `git push` takes the destination from the upstream
   config), and its undo is a force push, which stays refused.
2. **It would block.** A job has no terminal (`stdio: ['ignore','pipe','pipe']`),
   so an interactive rebase or an `--edit` cherry-pick does not fail: it waits for
   an editor that will never answer, holding the Queue lane until somebody kills
   it — exactly the starvation the long lane exists to prevent. Refusing these by
   name is cheaper than discovering them as a hung job.
3. **It would run something.** `--exec` after every rebased commit,
   `--upload-pack`/`--receive-pack` on the other side of a connection: general
   execution behind an allowlisted verb, the reason `gradlew -I` and the narrow
   `exec` forms are refused.

`merge` and `pull` stay out. A `pull` is a merge or a rebase depending on repo
config the caller did not state, which is the same surprise refusal 1 exists to
prevent; a merge's terminal state wants a message or `--no-edit`, a shape nothing
else in this surface has, and a caller who needs to join upstream can rebase.

## Considered options

- **Keep push refused and fix the refusal's wording.** Defensible: a push is the
  one effect that lands on other people. Rejected because the refusal bought a
  click, not a bound — the same session can push through the shell tool with one
  escalation, on a path measured to be flaky — and because the stated reason was
  already untrue.
- **Accept any non-force push, including a bare `git push`.** Rejected: the ref
  that gets written would be decided by repo config the caller never stated, and
  "publish commits to whatever `branch.<name>.merge` says" is precisely the
  surprise the surface bounds. `push.autoSetupRemote` makes it worse, silently.
- **Admit `rebase` and `cherry-pick` without `fetch`.** Cheapest and mostly
  decorative: the verbs only move onto refs already in the clone.
- **Admit `merge` for symmetry with `rebase`.** Rejected as above; it is also the
  verb a `pull` would perform, and both are refusable while `rebase` covers the
  join.
- **A deny list on `push` instead of an allow list.** Rejected: a deny list cannot
  express a complete surface, and push is the verb where a newly added flag must
  be refused until it is vetted. `restore` already established the allow-list
  shape.

## Consequences

- **One environment rule replaces a name heuristic.** `planRun` used to set
  `GIT_TERMINAL_PROMPT=0` when a resolved argv token contained `git`; network
  verbs made that too cute, and the override now rides on every job
  (`engine/env.ts`), so the git a job runs *without* being git — `pnpm run
  release`, `flutter pub` — is covered too. A push that needs an answer fails
  with git's own message instead of waiting on an EOF it cannot see.
- **A conflict leaves the tree mid-operation**, and the next job sees it: a
  half-finished rebase is a dirty tree with a rebase in progress. `--abort` and
  `--continue` are in the surface so the way out needs no escalation, and
  `git status` reports it. Recovery for a rewrite the caller regrets is the
  reflog and `ORIG_HEAD`, which is why a local rewrite is admitted while the
  irreversible direction — a force push — is not.
- **`git -c key=val` stays unreachable**, because the verb must be the first
  argument and may not start with `-`. That is what keeps
  `git -c core.sshCommand=… push` out, and it is now load-bearing for push.
- **The tables are per verb and paired with their refusals.** `GIT_FLAG_REASONS`
  is keyed by verb (one spelling is several flags: `-x`, `-f`, `-e`), each new
  verb derives its blocked set from it, and a table-driven test refuses every
  flag in it and asserts the reason survives into the message — a flag added
  without a reason fails the suite.
- **A push is an ordinary Queue job**: it names a remote and a ref, it is
  serialized with the builds in that directory, it has a log, and `job_kill` ends
  it. Nothing about it is detached, and nothing about it needs a new lane.
- **What stays impossible** is unchanged in kind: `reset --hard`, `clean`,
  `stash`, `checkout`/`switch`, `git restore .`, a force push, a remote ref
  deletion, and any whole-worktree wipe.
