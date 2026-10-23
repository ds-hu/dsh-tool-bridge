# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-10-23

The first release whose repository carries the built `lib/`, which is what a git
install reads.

### Added

- **Workspace selectors** on the package-manager surface: `pnpm --filter`/`-F`
  and `npm -w`/`--workspace`, accepted on either side of the verb. A selector is
  not a cwd retarget — the manager still starts in the pinned working directory,
  so the lane key is unchanged — which is why a *directory* selector is held to
  the literal-path rules while a package name is left to the workspace. The
  whole-workspace spellings (`--workspaces`, `-ws`,
  `--include-workspace-root`, pnpm's `-w`) and `!` exclusions are refused
  (ADR-0002, amended).
- `git fetch`, `git rebase` and `git cherry-pick`, each narrowed by the reason a
  job is not a terminal: `-i`/`--interactive`/`--autosquash` and `-e`/`--edit`
  would **block** waiting for an editor, and `-x`/`--exec`/`--upload-pack` run
  arbitrary commands, so both families are refused by name. `--abort`,
  `--continue`, `--skip` and `--quit` are accepted, so a conflict has a way out
  (ADR-0014).
- `git push`, narrowed to a **named destination**: a remote that is a name or a
  URL plus at least one destination ref, an allow list on the flags, and
  `--force`/`--delete`/`--mirror`/`--all`/`--tags`, `+refspec`s, `:refspec`
  deletions, wildcard refspecs and path/`file:` remotes all refused; a bare
  `git push` is refused because the upstream config would pick the destination
  (ADR-0014).
- `tests/package.spec.ts`: the manifest's entry points must exist **and** be
  tracked by git, since a git install ships only tracked files.

### Changed

- `GIT_TERMINAL_PROMPT=0` rides on every job rather than on the resolved argv
  containing `git`, so the git a job runs without being git (`pnpm run release`,
  `flutter pub`) is covered too; a command that wants a prompt fails with git's
  message instead of waiting on a stdin that is `ignore`.
- The long-lane guess reads past flags that take a value, so
  `pnpm run --filter web dev` is a long job instead of a queue job — the
  starvation direction the docs call the dangerous one.
- `README.md`, `CONTEXT.md` and ADR-0001's surface list no longer claim that
  `git push` and history rewriting are absent; the token claim the old refusal
  rested on never held for a plugin that *is* the harness process.

### Fixed

- **The plugin could not be installed from git.** `lib/` was gitignored and
  nothing built it on install, so the unpacked package had no `main` and the
  Loader answered `1 entry did not activate toolbridge (@cup113/dsh-plugin-toolbridge):
  failed to import` (`ERR_MODULE_NOT_FOUND … \lib\index.js`). `lib/` — the two
  entry points, not the source maps — is now committed, matching the sibling
  plugins installed the same way.
- `pnpm run --filter ../.. build` passed validation: nothing looked at
  `--filter`, so a build could run outside the pinned working directory.

## [0.1.0] - 2026-09-22

First published state of the plugin: the toolchain and browser halves, the
switch row above the composer, the sidebar panel, the digested test run with
baseline attribution, the ARB editor, a guard-railed git verb set, the Gradle
wrapper entry, and the format pin.

[0.1.1]: https://github.com/ds-hu/dsh-tool-bridge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ds-hu/dsh-tool-bridge/releases/tag/v0.1.0
