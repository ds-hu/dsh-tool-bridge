# cargo joins the surface as a verb-guarded build tool

**Status**: accepted

The bridge already carries four toolchains on four different arguments. This one
is narrower than all of them, and the narrowness is the interesting part: cargo is
**not** "a tool the sandbox denies". Measured on this machine, all in the same
directory, with one dependency in `Cargo.toml`:

| run | where | result |
|---|---|---|
| `cargo fetch` (cold cache) | `workspace-write` shell | 3 retries, then `[35] SSL connect error (schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e) - 安全包中没有可用的凭证)`, exit 101 |
| `cargo fetch` | outside the sandbox | exit 0, writes `Cargo.lock`, registry cache reaches 728 files |
| `cargo build` (crate caches warm) | `workspace-write` shell | exit 0, `Finished dev profile [unoptimized + debuginfo] target(s) in 4.05s` |

So the boundary is not "cargo cannot run here" — a build with its crates already
on disk runs confined, and it even spawns `rustc` happily (unlike the Node tools,
which die on `spawn EPERM`, ADR-0004). What a confined cargo cannot do is **reach
crates.io**: DSH's Windows sandbox runs the confined child under a low-integrity
token (`whoami /groups` reports `Mandatory Label\Low Mandatory Level
S-1-16-4096`), and schannel refuses to acquire a credential handle there. Every
command that has to *resolve* a crate therefore fails — `fetch`, `add`, `update`,
and any `build`/`test` whose manifest or lockfile needs one — while every command
that only consumes what is on disk succeeds.

That is the reason cargo belongs on the bridge, and it is a sharper one than the
`gradlew` case (ADR-0013): a silent 30-minute hang misleads the caller into
thinking the build is merely slow, whereas this one names its own cause. It is
also the request that motivated the change — "至少保证能拉依赖" — so the verbs that
resolve or download a crate are the *point* of the surface, not an extra.

## The verb list is an allow list, and that is the whole design

`flutter`/`dart` take any subcommand (ADR-0001: the allowlist is a guardrail, and
`dart run` already executes arbitrary code). `gradlew` has no verb list at all,
because Gradle task names are the project's own and cannot be enumerated. cargo is
neither: its subcommands *are* enumerable, so a list is expressible — and it has
to be a list, because cargo **dispatches**:

```
cargo <name>  →  looks for cargo-<name>.exe on PATH and runs it
```

Measured, `%USERPROFILE%\.cargo\bin` on this machine holds, beside rustup's own
zero-byte shims:

| entry | size | origin |
|---|---|---|
| `cargo.exe`, `cargo-clippy.exe`, `cargo-fmt.exe`, `rustc.exe`, … | 0 B | rustup shims (hardlinks) |
| `cargo-binstall.exe` | 26,547,200 B | `cargo install` |
| `cargo-install-update.exe` | 4,015,104 B | `cargo install` |

An unfiltered verb space is therefore general execution behind an allowlisted
name — the identical reason `pnpm exec` is narrowed to a **Script binary**
(ADR-0004) and `gradlew -I` is refused. `cargo nextest run` and `cargo binstall`
are out for that reason, not because they are bad tools.

The same table settles how `clippy` and `fmt` are admitted: they are **external
subcommands that ship with the toolchain** (`cargo-clippy.exe`,
`cargo-fmt.exe`), and they are on the list **by name**, because provenance is not
a property the filesystem distinguishes — rustup's shims and `cargo install`'s
binaries share one directory on `PATH`. A "resolve it and check where it came
from" rule would need `rustup which` (a second process, and it fails for
non-toolchain binaries) or a hardlink inspection, to separate two files that
behave identically to `CreateProcess`.

So: `build`, `check`, `test`, `bench`, `doc`, `run`, `clean`, `fix`, `clippy`,
`fmt`, `generate-lockfile`, and the dependency verbs `fetch`, `update`, `add`,
`remove`/`rm`, `tree`, `metadata`. `run` is in on the `dart run` terms — arbitrary
code is already reachable, and it is the natural way to run a Rust CLI under the
bridge.

## What is refused, and why each are not merely conservative

**Machine state outside the project.** `install`/`uninstall` write
`%USERPROFILE%\.cargo\bin` — the directory rustup's own shims live in, so a job
would be rebuilding the developer's toolchain, not the project. `publish`/`yank`/
`owner` change crates.io irreversibly; `login`/`logout` write a token this plugin
has no store for. This is `npm publish`'s refusal one ecosystem over (ADR-0006).

**Scaffolding that can name a path outside the pinned cwd.** `new`/`init` take a
directory argument and are not bound by the working directory at all; `vendor`
writes a tree and rewrites `.cargo/config.toml`.

**The compiler reached around cargo.** `rustc`/`rustdoc` forward everything after
`--` to the compiler, which is the redirection family `-D` is refused for on the
gradlew surface (ADR-0013).

**Anchor redirection.** `--target-dir` writes build output outside the pinned
working directory — `gradlew --project-cache-dir`'s twin — and `--config` injects
arbitrary Cargo configuration, where `build.rustc-wrapper` and `target.*.runner`
run a program of the caller's choosing: `gradlew -I/--init-script` exactly. The
project's own `.cargo/config.toml` is the supported home for both, the way
`gradle.properties` is for `-D`. `-Z` is refused as a whole, because the unstable
namespace is where `-Zbuild-std`, `-Zscript` and `-Zconfig-include` live.

**Whole-workspace spellings.** `--workspace`/`--all` widen one invocation to
every member, and `--exclude` means every member *except* the one named — the
`!`-selector refusal (ADR-0002, amended). With `--workspace` refused, `--exclude`
has no other use.

**`+<toolchain>`.** `cargo +nightly test` puts a toolchain choice in the argv. The
toolchain is machine configuration — `rustup default`, or `RUSTUP_TOOLCHAIN` in
the environment — which is the posture `JAVA_HOME` is held to; and every
toolchain shares the one `target/` directory a job builds into, so a per-request
toolchain mixes artifacts.

Two flags are **guarded** rather than refused:

- **`-p`/`--package`** is the **Workspace selector** cargo's own way — it picks
  one member, the manager still launches in the pinned working directory, so the
  lane key does not move. A value that looks like a path is held to the literal
  path rules (`-p ..` and `-p C:\other` are refused); a package name or ID spec
  is the workspace's own grammar and is left to resolve. cargo's `-F` is
  `--features` and is deliberately *not* treated as a selector — the `-w`
  collision between pnpm and npm (ADR-0006), one toolchain over.
- **`--manifest-path`** is the `gradlew -p` decision repeated: a layout whose
  crate is not the session's directory would otherwise be a dead end, and the cwd
  is fixed at submit time (ADR-0002). A relative path stays inside the pinned
  directory; an absolute one, a `..` component or a wildcard is refused.

`--manifest-path` also has a second effect worth naming. cargo searches **upward**
for `Cargo.toml`, so a session in `src/` builds the ancestor project — that is
cargo's own semantics, the way Gradle finds `settings.gradle` upward, and it is
not a retarget the bridge performed. The guarded flag is the only thing that
*stops* that search, which makes it the narrow tool the pinned cwd needs rather
than a way around it.

## `cargo test` is a third digest flavor

The failure inventory is the reason this plugin exists, and `cargo test` writes a
log worth reading: libtest runs once per target (the unit-test binary, each
integration file, the doctest target), so counts are a **sum** over per-target
`test result:` lines, `ignored` is the "not run" bucket the other reporters call
`skipped`, and the `Running …` line above each block is what names the file a
failure came from. `flavor` is `cargo` — the tool that ran, symmetric with
`flutter`.

Two shapes in the measured logs are traps, and both are now fixtures:

- **`--quiet` writes no per-test progress lines.** The failure appears as
  `tests::it_fails --- FAILED` above the `failures:` block, with an `i.. 3/4`
  progress line where the default reporter lists `test … ok`. A parser anchored on
  `test <name> ... FAILED` reports *no failures* for a run that exited 101.
- **A mixed run's last `test result:` line belongs to a green target.** Under
  `--no-fail-fast`, a failed integration test is followed by the doctest target's
  `test result: ok.`, so "the last verdict wins" reads a red run as green off the
  counts of a target that passed. cargo's own `error: test failed, to rerun pass …`
  is what keeps the verdict red — ADR-0011's false green, one runner over.

A compile error produces no `test result:` line at all, so `counts` stays null and
the summary says `see log`; nothing here invents a zero.

## Considered options

- **Accept any subcommand, on the `dart` terms.** One guard less, and the
  `dart run` argument (the allowlist is a guardrail, not a boundary) is
  available. Rejected because it is not the same risk: `dart run` needs source in
  the workspace, while `cargo <anything>` runs whatever `cargo-<anything>.exe`
  happens to be on `PATH` — measured, that includes binaries somebody else
  installed into the shared cargo bin directory. "General execution behind an
  allowlisted name" is the one thing this surface has consistently refused.
- **Allow external subcommands after checking their provenance** (the toolchain's
  own `bin`, not the user's). Rejected on measurement: rustup's shims and
  `cargo install`'s binaries live in the same directory, so the check needs
  `rustup which` (fails for non-toolchain binaries) or hardlink archaeology for a
  distinction `CreateProcess` cannot see. A name list is smaller and says what it
  means.
- **Admit cargo without a digest, and add the flavor later.** Cheapest path to
  "拉依赖 works". Rejected: `cargo test` is the second most likely command on this
  surface, and a red run with only a `tail` is exactly the state ADR-0011 was
  written to end. The parser is ~120 lines and its fixtures are real runs.
- **Refuse `cargo clean`.** It is the one allowed verb that deletes. Rejected on
  the glossary's own definition: **Destructive** is "irreversible *and* not
  confined to the named paths", and `target/` is derived output reproducible by
  rebuilding — the cost is compilation time, not work. A poisoned `target/` is
  also a real recovery need.
- **Refuse `--manifest-path` outright** (the simplest anchor rule). Rejected:
  a non-workspace monorepo layout would be unreachable, and the cwd cannot be
  retargeted — the same dead end ADR-0013 refused to create for `gradlew -p`.
- **Guess `cargo run` onto the Long lane.** The documented asymmetry argues for
  it (a long job on the Queue starves everything; a one-shot on the Long lane
  merely occupies it). Rejected for consistency with `flutter run` and `dart run`,
  which are left to the caller: a guess that silently moves a one-shot command off
  the Queue is also a surprise. The tool description says to pass `long: true`
  for a server.
- **One flag table per verb** (`cargo test`'s flags are not `cargo add`'s).
  Rejected: unlike git — where `-x` means two things (ADR-0014) — every cargo flag
  in this table redirects an anchor or a toolchain, which is a property of the
  *tool*, not of the verb. Where two verbs genuinely differ, they differ in the
  verb table, not here.

## Consequences

- **No lane changes.** cargo jobs are Queue jobs: concurrent builds share one
  `target/` the way concurrent Flutter runs share `build/`, and `wantsLongLane`
  answers false for the exe. `cargo run` is the caller's `long: true`.
- **`scope: "uncommitted"` does not extend to cargo.** It is a `.dart` scope by
  construction (`SCOPE_FILE_SUFFIX`), and neither `cargo fmt` nor `cargo clippy`
  takes a file list — `cargo fmt` forwards to rustfmt, which reads the whole
  crate. A Rust scope is a separate decision with its own expansion/filter
  question, not a suffix to append.
- **The machine's `~/.cargo/config.toml` is out of reach and deliberately
  unmanaged** — like `~/.gradle/gradle.properties`. It can set `rustflags` and a
  `rustc-wrapper`; that is the developer's own configuration, and a job inherited
  it before this change too.
- **`CARGO_TERM_COLOR=never` joins the environment overrides.** cargo ignores
  `NO_COLOR` — it takes colour from `--color` and from this variable — and
  ADR-0010's measurement (a reporter colours a pipe on Windows) is the reason the
  overrides exist at all. The digest strips at read time regardless; this keeps
  the log file legible for the human who opens it.
- **`lib/` is rebuilt and committed with the change.** The profile installs this
  plugin from git, and a git install ships only tracked files (`tests/package.spec.ts`
  enforces it).
- **The tests pin what the ADR claims.** The verb and flag tables are asserted
  key-by-key against the refusals that use them (a reason without a guard, or a
  guard without a reason, fails), every listed verb is asserted *acceptable* so
  the allow list is not decoration, and the digest fixtures are real `cargo test`
  logs — including the `--quiet` and mixed-target shapes above.
