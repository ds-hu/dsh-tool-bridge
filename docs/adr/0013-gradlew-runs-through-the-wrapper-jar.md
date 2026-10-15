# gradlew runs through the wrapper jar, never the .bat

**Status**: accepted

Android is a primary toolchain for the sessions this bridge serves, and its
only entry point is the wrapper: a `gradle` CLI is not on PATH (measured,
MISS), and every RN/Android project commits `gradlew.bat` plus
`gradle/wrapper/gradle-wrapper.jar` instead. Inside the file sandbox the
wrapper does not fail — it **hangs silently**: `gradlew assembleDebug` sat 30
minutes at CMake's `Detecting C compiler ABI info` with zero output, zero CPU
and no error, while the same build outside the sandbox finished in 1m07s.
That is a stronger reason to belong on the bridge than the one `npm` had
(ADR-0006): `spawn EPERM` fails loudly enough for a caller to reach for an
escalation, and a silent hang does not even tell the caller that anything is
wrong.

A package script is a working alternative — `"build:android": "cd android &&
gradlew.bat assembleDebug"` runs through `pnpm run` today, unconfined — so the
argument for a first-class `gradlew` is **control and visibility, not
reachability**: a script cannot force `--no-daemon`, cannot select tasks or
pass `-PreactNativeArchitectures=x86_64` without editing `package.json`, and
buries the real argv under `cmd.exe`. The same framing as ADR-0001: the
allowlist bounds recovery cost and surprise, and a wrapper hung mid-build with
no error is the most expensive surprise this bridge has measured.

So `gradlew` is admitted as a **wrapper entry**: the bridge runs
`%JAVA_HOME%\bin\java.exe -Dorg.gradle.appname=gradlew -classpath
<project>/gradle/wrapper/gradle-wrapper.jar
org.gradle.wrapper.GradleWrapperMain <args>` directly. `gradlew.bat` wraps
exactly one such line, so nothing is lost by skipping it — and `cmd.exe` stays
out of an argv that is supposed to have no shell, the same rule that bans the
`.cmd` wrapper for a **script binary**. The JVM comes from `JAVA_HOME` only,
never from PATH: a React Native toolchain is strict about its JDK (RN 0.87's
`jvmToolchain(17)` rejects JDK 21 outright), and a PATH java may be the wrong
one entirely. A missing `JAVA_HOME` or `bin\java.exe` is a loud refusal naming
what to set. Which JDK 17 Gradle *discovers* for compilation is the
developer's own `org.gradle.java.installations.paths` in
`~/.gradle/gradle.properties` — environment configuration this bridge
deliberately does not manage.

**The main class is named on `-classpath`, not left to `java -jar`.** The
commissioning brief quoted the newer wrapper script, which uses `-jar`, and
that form was measured working on the RN project it was written against. But
`-jar` depends on a `Main-Class` manifest attribute, and the wrapper jars on
this machine disagree about carrying one:

| project | jar size | `Main-Class` | its `gradlew.bat` line |
|---|---|---|---|
| `computer/SimpleApp` (RN, the briefed target) | 48,966 B | present | `-jar …gradle-wrapper.jar` |
| `cuplivo` (Flutter/Android) | 53,636 B | **absent** | `-classpath … org.gradle.wrapper.GradleWrapperMain` |
| `thu-info-app` | 43,583 B | **absent** | `-classpath … org.gradle.wrapper.GradleWrapperMain` |

`java -jar` answers `no main manifest attribute` on the two without it —
measured, not inferred — while the class itself is present in all three. So
the launch mirrors the **older, wider** script form, which is a strict
superset: it ran `:app:help` through `cuplivo`'s wrapper from the repo root
with `-p android` in 59s, `BUILD SUCCESSFUL`, 5 actionable tasks — and through
`SimpleApp`'s newer wrapper, the one the brief quoted, in 25s with 11
actionable tasks. Both runs left **zero java processes** once settled. Had the
brief's line been implemented as written, the feature would have worked on the
one project it was measured against and failed on most projects on the
machine, with an error naming a manifest attribute rather than anything the
caller could act on.

## The forced `--no-daemon`

Every `gradlew` argv is normalised at submit time to carry `--no-daemon`,
inserted directly behind the command name. Measured on the motivating build
(cold cache, same ABI, all runs exit 0):

| scenario | daemon | `--no-daemon` |
|---|---|---|
| cold start, no-change incremental | 34.4s | 33.0s (parity) |
| daemon warm, no-change incremental | 7.0s | 33.0s |
| daemon warm, clean full rebuild | 34.5s | 67.1s |

The absolute gap is a constant ~26–33s — the fixed cost of starting a JVM and
Gradle's configuration phase — so the daemon only pays from the *second*
build in a session, while a first build gains nothing. Against that stands
the resident cost: one process holding 591–612 MB, no self-retirement inside
90 minutes (default idle timeout is 3 hours). The deciding argument is an
invariant, not a timing: ADR-0008's closing claim is that *settled* and *no
residue from this run* are the same instant. A daemon this run spawned is
residue by definition — the kill machinery still works (a daemon detaches,
`taskkill /T /F` cannot reach it, but nothing needs to reach it) — so
`--no-daemon` makes the invariant hold by construction.

The flag is inserted at index 1, not appended, because `--` ends Gradle's
flag surface: appended, `gradlew :app:help -- --foo` would carry a
`--no-daemon` the task reads and Gradle never sees, and a daemon would start
behind an exit 0. Normalisation happens during validation — the **run
shorthand** rule — so the job JSON, the lane guess and the log all read the
one argv that runs.

## The flag surface: a deny list with two value guards

There is no verb list. Gradle task names are the project's own and cannot be
enumerated, and a task can execute arbitrary build-script code anyway — the
same terms `dart run` is accepted on. What is refused is the flag that
redirects an anchor (the working directory, the project, the machine's
Gradle state) or opens arbitrary execution:

- `-g`/`--gradle-user-home`, `--project-cache-dir` — machine-level state or a
  cache outside the pinned directory;
- `-I`/`--init-script` — an arbitrary script before the build, the same
  reason `pnpm exec` is narrowed (ADR-0004);
- `-c`/`--settings-file`, `-b`/`--build-file` — point the build at a
  different project;
- `-D` — **all** system properties, not just `org.gradle.*`: the legitimate
  ones have a project-side home in `gradle.properties`, and refusing the
  whole flag needs no value inspection;
- `--daemon` — fights the normalised `--no-daemon`;
- `-t`/`--continuous` — a watcher that never terminates; a build is a queue
  job;
- `--stop`/`--status` — manage the machine's shared daemons, state this
  surface never creates, so it does not manage it either.

Two flags are guarded rather than refused, because their *values* decide:

- **`-P`/`--project-prop`** is judged by its key, on the `--location`
  precedent: Gradle accepts the same redirects through project properties
  (`-Porg.gradle.java.home=…` picks the build JVM), so the `org.gradle.*` key
  space is refused while `-PreactNativeArchitectures=x86_64` — the measured
  real use — passes.
- **`-p`/`--project-dir`** satisfies the literal-path rules the `git restore`
  pathspec guard uses (literal, relative, no `..`, no bare `.`, no wildcards,
  no absolute path). The React Native layout keeps the wrapper one level
  below the session cwd — `<root>/android/gradle/wrapper/…` — and the cwd is
  fixed at submit time (ADR-0002), so refusing `-p` outright would dead-end
  every root-level session with a refusal only a human can act on, while a
  relative `-p android` stays inside the pinned cwd exactly the way
  `git restore -- lib/a.dart` stays inside the worktree. The wrapper jar
  resolves from the `-p` target; a target without one is a refusal naming
  the missing jar.

Scanning stops at `--`, whose task arguments may spell anything.

## Considered options

- **Resolve the wrapper from the cwd only, refuse `-p`.** Zero new guard
  machinery, one refusal message. Rejected: the motivating layout puts the
  wrapper outside the cwd, the cwd cannot be retargeted, and the commissioning
  measurements for this ADR were taken precisely because that layout is the
  normal one — deferring the guard until "bitten" defers it past the first
  day of use.
- **Run `gradlew.bat` via `cmd.exe`.** One line of code. Rejected: it puts a
  shell's parsing rules in the middle of an argv that is supposed to have
  none, the exact reason script binaries bypass `.cmd`.
- **Mirror the newer script's `-jar` line exactly,** as the commissioning brief
  proposed. Rejected on measurement: it fails with `no main manifest
  attribute` on two of the three wrapper jars on this machine, because it
  depends on a manifest attribute the older generation does not carry. Naming
  the main class on `-classpath` covers both generations, so `-jar` is the
  narrower form of the same idea.
- **Fall back to PATH java when `JAVA_HOME` is unset.** Friendlier on
  machines without JAVA_HOME. Rejected: RN's strict toolchain means a wrong
  JDK fails anyway, with a far less legible error than the refusal; and the
  wrapper script's own behaviour (JAVA_HOME only) is what is being mirrored.
- **Admit `java` itself to the allowlist** and let callers spell the whole
  command. Rejected: that is general command execution behind an allowlisted
  name, the one thing the exec narrowing exists to prevent.
- **Search upward for the wrapper** when the cwd has none. Rejected: a job
  runs in one known directory (ADR-0002); upward search makes "which project
  did this build" unpredictable.
- **A daemon Switch** (`--daemon` opt-in per conversation). Rejected: daemons
  are shared machine-level state keyed by Gradle version + JVM args + user
  home, not per conversation — one conversation's `--stop` would kill
  another's warm daemon, and per-conversation daemons need reference
  counting. The **Switch** concept stays "controls one half of the plugin".
- **A verb allowlist** like the package managers have. Rejected: task names
  are the project's own; the deny list covers everything that redirects.

## Consequences

- **gradlew jobs are queue jobs.** Concurrent Gradle builds corrupt `build/`
  for the same reason concurrent Flutter runs do, which is what the Queue
  lane exists for; no lane changes were needed (`wantsLongLane` already
  answers false for an unknown exe, and the never-terminating shapes are
  refused at validation).
- **`--help` and `tasks` are useless acceptance probes.** Measured: `help`
  exits 0 in an empty directory with "1 actionable task" where the real
  project answers 11 — a green that built nothing. Acceptance for a Gradle
  change must use a task the project owns (`:app:assembleDebug`) and assert
  the **artifact** exists, because exit 0 and `BUILD SUCCESSFUL` can both lie
  but an APK cannot. This is the same silent-failure family as ADR-0009's
  empty ring and ADR-0011's false green.
- **The launcher tests pin everything.** The gradle branch consults no PATH
  lookup at all — `JAVA_HOME` arrives as a parameter and the jar is read from
  the fixture — and one test makes any `which` call fail outright, the
  fixture-pin lesson ADR-0006 recorded (a test that leaked to the real
  machine passed while proving nothing).
- **The standing no-shell assertion.** The launch test asserts no argv token
  is `cmd.exe` or ends in `.bat`/`.cmd`, so the core claim of this ADR is
  re-proved by every test run rather than by a comment.
- **The wrapper's env habits are not replicated.** `gradlew.bat` folds
  `JAVA_OPTS`/`GRADLE_OPTS` into its JVM args; the bridge's argv is the
  single source of truth, and JVM-level needs belong in the project's
  `gradle.properties`. A developer relying on `GRADLE_OPTS` will notice the
  difference on the first build, loudly.
