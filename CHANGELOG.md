# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-23

1.0.0 because the package's **identity** changed, not because the surface turned
over: `@cup113/dsh-plugin-toolbridge` is now `@ds-hu/dsh-plugin-toolbridge`,
following the repository to `ds-hu`. A profile that installed the old name has to
be re-added — the Loader row resolves this bundle through the profile's own
dependency entry — and that is the one breaking change here. The rest is
additive: cargo joins the surface with a digest flavor of its own.

### Added

- **`cargo`, as a verb-guarded build tool** (ADR-0015). The reason is narrower
  than the other toolchains and worth stating exactly: measured, `cargo build`
  with its crates already on disk finishes inside `workspace-write` (4.05 s,
  `rustc` children included), while `cargo fetch` there retries three times and
  dies with `schannel: AcquireCredentialsHandle failed:
  SEC_E_NO_CREDENTIALS` — a confined child runs under a low-integrity token and
  cannot acquire a TLS credential. So the bridge is where a Rust project resolves
  its dependencies. Accepted verbs: `build`, `check`, `test`, `bench`, `doc`,
  `run`, `clean`, `fix`, `clippy`, `fmt`, `generate-lockfile`, `fetch`, `update`,
  `add`, `remove`/`rm`, `tree`, `metadata`. It is an **allow list** because cargo
  dispatches an unknown name to `cargo-<name>.exe` on `PATH` (measured on this
  machine: `cargo-binstall.exe`, 26 MB, beside rustup's shims), so `clippy`/`fmt`
  are admitted **by name** — provenance cannot separate them from an installed
  helper in the same directory. Refused: `install`/`uninstall` (they write
  `%USERPROFILE%\.cargo\bin`), `publish`/`yank`/`owner`/`login`/`logout`,
  `new`/`init`/`vendor`/`package`, `rustc`/`rustdoc`, every unlisted name,
  `--target-dir`, `--config`, `-Z`, `--workspace`/`--all`/`--exclude`, and
  `cargo +<toolchain>`. `-p`/`--package` is a **Workspace selector** (path-shaped
  values go through the literal-path rules) and `--manifest-path` is **guarded**
  like `gradlew -p` — a relative path inside the pinned cwd, which is also the
  only thing that stops cargo's upward search for `Cargo.toml`. `cargo clean` is
  allowed: it removes `target/` only.
- **A third digest flavor, `cargo`.** `cargo test` logs are libtest's per-target
  blocks, so counts are summed over every `test result:` line, `ignored` reads as
  `skipped`, and the `Running …` line names the file a failure came from. Both
  measured traps are fixtures: `--quiet` writes `tests::it_fails --- FAILED` and
  no per-test progress lines at all, and a mixed `--no-fail-fast` run ends with a
  *green* target's `test result: ok.` after the red one — cargo's own
  `error: test failed` is what keeps the verdict red (ADR-0011, one runner over).
  A compile error claims no counts at all rather than "0 passed".
- `CARGO_TERM_COLOR=never` rides on every job: cargo ignores `NO_COLOR`, and the
  log file is read by a human as well as by the digest.

### Changed

- **The package is `@ds-hu/dsh-plugin-toolbridge`.** The repository moved to
  `ds-hu` (the old remote answered `This repository moved` on the last push), so
  the scope follows it. Three things carry the name and all three move together:
  the manifest, the Loader row in `cordis.patch.yml` (`- id: toolbridge` keeps
  its id), and the client half's bundle and panel-tab id — a row name that does
  not resolve as a bare package name from the profile is a `failed to import`.
  A profile that installed the old name has to be re-added under the new one: its
  dependency entry is what the row resolves through.
- `bridge_run`'s description teaches the cargo surface it now accepts, including
  that `cargo run` is **not** guessed onto the long lane (pass `long: true`) and
  that `clippy`/`fmt` are external subcommands accepted by name.
- `vitest.config.ts` states the suite's timeout once, at 30 s. Spawning a child
  process costs seconds on an ACL-heavy Windows workspace, and several cases here
  start real ones (`git`, `cargo`): measured, `scope.spec`'s real-repository case
  takes 5.8 s alone and 17.5 s under load, and `bridge-output.spec`'s job cases
  range from 2 s to 5 s. The 5 s default turned that into timeouts that read as
  failures of the code under test.

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

[1.0.0]: https://github.com/ds-hu/dsh-tool-bridge/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/ds-hu/dsh-tool-bridge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ds-hu/dsh-tool-bridge/releases/tag/v0.1.0
