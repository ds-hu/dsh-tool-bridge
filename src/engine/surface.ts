/**
 * The command surface, as tables.
 *
 * Everything here is data lifted from the retired server unchanged, because
 * these tables *are* the guardrail ADR-0001 argues about: what the tool accepts
 * by name, which verbs each package manager has, which flags are refused, and
 * how a scope reaches a command. Keeping them in one module with the refusals
 * next door is the point — a table and its refusal message drifting apart is
 * how a guardrail becomes a decoration.
 */

/**
 * SCRIPT_BINARIES — the project's own Node tools, accepted by name and resolved
 * inside the job's working directory rather than through `.bin` (a `.cmd`
 * wrapper would put `cmd.exe` back in the middle of an argv that is supposed to
 * have no shell).
 */
export const SCRIPT_BINARIES = new Set(['vite', 'vitest', 'svelte-check', 'svelte-kit', 'tsc'])

export const ALLOWED_EXES = new Set([
  'flutter', 'dart', 'git', 'npm', 'npx', 'pnpm', 'gradlew', ...SCRIPT_BINARIES,
])

/**
 * PACKAGE_MANAGERS — both package managers are accepted on the same terms: the
 * tool never detects which one a project uses (the lockfile is advisory and a
 * fork may carry either), so the caller names the manager its project resolves
 * with. ADR-0006 records why the second one was admitted.
 */
export const PACKAGE_MANAGERS = new Set(['npm', 'pnpm'])

/**
 * `npx` is accepted, but as an exec form rather than a verb-guarded manager: it
 * *is* `npm exec` with the package argument implied.
 */
export const PACKAGE_MANAGER_RUNNERS = new Set([...PACKAGE_MANAGERS, 'npx'])

/**
 * How a package manager's JavaScript entry point is found behind its Windows
 * wrapper, as paths relative to the wrapper's own directory. The general
 * fallback reads the wrapper itself (`nodeEntryFromShim`), which is what a
 * corepack-managed install needs because its wrapper names its own path.
 */
export const PACKAGE_MANAGER_ENTRIES: Record<string, readonly (readonly string[])[]> = {
  npm: [
    ['node_modules', 'npm', 'bin', 'npm-cli.js'],
    ['node_modules', 'npm', 'bin', 'npm-cli.cjs'],
  ],
  npx: [
    ['node_modules', 'npm', 'bin', 'npx-cli.js'],
    ['node_modules', 'npm', 'bin', 'npx-cli.cjs'],
  ],
  pnpm: [
    ['node_modules', 'pnpm', 'bin', 'pnpm.mjs'],
    ['node_modules', 'pnpm', 'bin', 'pnpm.cjs'],
  ],
}

/**
 * Node's own npm ships *inside* the Node installation, next to `node.exe`, so
 * its wrapper directory has no `node_modules/npm` of its own to probe. Measured
 * on nvm4w: `%USERPROFILE%\nvm4w\nodejs\npm.CMD` is the wrapper and the entry is
 * one directory down at `nodejs/node_modules/npm/bin/npm-cli.js`. Without this
 * the layout probe finds nothing and only the shim reader can answer.
 */
export const NODE_INSTALL_ENTRIES: readonly (readonly string[])[] = [
  ['node_modules', 'npm', 'bin', 'npm-cli.js'],
  ['node_modules', 'npm', 'bin', 'npm-cli.cjs'],
]

/**
 * pnpm verbs: install a tree (including the dependency build scripts a confined
 * install silently skips), run the project's own scripts, change dependencies
 * and inspect the result. Excluded by omission: `dlx`, `publish`,
 * `config`/`setup`/`self-update`, `store` and `link`/`unlink` — every one of
 * them writes machine state outside the project.
 */
export const PNPM_VERBS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade',
  'rebuild', 'dedupe', 'run', 'run-script', 'exec', 'why', 'list', 'ls',
  'outdated', 'audit', 'licenses',
])

/**
 * The npm peer of PNPM_VERBS. `ci` is the *strict* install (resolves only from
 * `package-lock.json`, never rewrites it); `link`/`unlink`/`publish`/`config`/
 * `init`/`pack`/`prune`/`owner`/`team`/`token`/`doctor`/`cache` are absent by
 * omission. Note `ls` is not pnpm's `ls`: npm lists packages where pnpm lists
 * scripts.
 */
export const NPM_VERBS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up',
  'upgrade', 'rebuild', 'dedupe', 'run', 'run-script', 'exec', 'why', 'explain',
  'list', 'ls', 'outdated', 'audit', 'licenses',
])

/**
 * npm's bare-script shorthands: only `npm test` and `npm start` are abbreviated,
 * and `npm build` is not something npm understands — accepting it would invent a
 * surface npm does not have.
 */
export const NPM_RUN_SHORTHANDS = new Set(['test', 'start'])

export const PACKAGE_MANAGER_VERBS: Record<string, Set<string>> = {
  npm: NPM_VERBS,
  pnpm: PNPM_VERBS,
}

/**
 * Flags that retarget one of the two anchors a job runs under: the working
 * directory (ADR-0002) and "this project, not this machine". `-C`/`--dir`/
 * `--prefix` move the directory, `--workspace-root` moves it up to the root of
 * the workspace, and `-g`/`--global` leaves the project entirely.
 *
 * **Per manager, because one spelling is two flags.** pnpm's `-w` and
 * `--workspace` are `--workspace-root` (a retarget, refused); npm's `-w` and
 * `--workspace` pick *one member* of the workspace (a **Workspace selector**,
 * accepted — see `PACKAGE_MANAGER_SELECTOR_FLAGS`). The `-w` collision is why
 * this is a record and not one set: the same token cannot be both.
 *
 * The "all members at once" spellings are refused with the retarget table
 * because they are the same failure one level out: one invocation that writes
 * into every package multiplies the writes and defeats the one-target-per-lane
 * assumption, which is what the long lane exists to keep.
 */
const PACKAGE_MANAGER_RETARGET_FLAGS = [
  '-C', '--dir', '--prefix', '--workspace-root', '-g', '--global',
]

export const PACKAGE_MANAGER_BLOCKED_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  pnpm: new Set([...PACKAGE_MANAGER_RETARGET_FLAGS, '-w', '--workspace']),
  npm: new Set([...PACKAGE_MANAGER_RETARGET_FLAGS, '--workspaces', '-ws', '--include-workspace-root']),
}

/**
 * The refused spellings that widen one invocation to the whole workspace, so the
 * refusal can say *that* instead of "a different directory": the difference
 * matters to a caller who meant "all my packages".
 */
export const PACKAGE_MANAGER_WHOLE_WORKSPACE_FLAGS: ReadonlySet<string> = new Set([
  '--workspaces', '-ws', '--include-workspace-root', '--workspace-root', '--workspace',
])

/**
 * The flags that pick *which* workspace member a command runs in: pnpm's
 * `--filter`/`-F` (its bundled help gives it the short alias) and npm's
 * `-w`/`--workspace`.
 *
 * A selector is not a retarget, and the difference is where the process starts:
 * the manager still launches in the pinned working directory, so the lane key
 * is unchanged. What the selector moves is the *script's* directory, to a member
 * of the workspace the pinned cwd already belongs to — the same terms `gradlew
 * -p android` is accepted on (ADR-0002, amended). A selector that names a
 * *directory* is therefore guarded by the literal-path rules; a selector that
 * names a package is the workspace's own grammar (`foo`, `@bar/*`, `...foo`).
 */
export const PACKAGE_MANAGER_SELECTOR_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(['-w', '--workspace']),
  pnpm: new Set(['--filter', '-F']),
}

/**
 * Flags whose value is the *next* token, so a script name can be read past a
 * flag that precedes it. `pnpm run --filter web dev` runs `dev`, and reading
 * `web` as the script is what put a dev server on the queue lane and starved
 * every build behind it.
 */
export const MANAGER_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--filter', '-F', '-w', '--workspace', '--location',
])

/** The one blocked flag whose *value* decides: `=global`/`=user` vs `=project`. */
export const PACKAGE_MANAGER_LOCATION_FLAG = '--location'
export const PACKAGE_MANAGER_GLOBAL_LOCATIONS = new Set(['global', 'user'])

/**
 * `pnpm exec`/`npm exec`/`npx` look in `node_modules/.bin` *and then on PATH*:
 * measured, `pnpm exec node --version` and `pnpm exec cmd /c echo hi` both work,
 * and npx additionally *fetches* what it cannot find. Left alone that is general
 * command execution behind an allowlisted verb, so the exec target must be a
 * script binary and these flags stay out.
 */
export const EXEC_BLOCKED_FLAGS = new Set(['-c', '--shell-mode', '-p', '--package'])

/**
 * Why each refused Gradle flag is refused, keyed by the flag. The key set is
 * `GRADLE_BLOCKED_FLAGS`, so the refusal and the table cannot drift apart —
 * the pairing this file's own header asks for.
 *
 * There is no verb list beside this: Gradle task names are the project's own
 * and cannot be enumerated, and a task can run arbitrary build-script code
 * anyway — the same terms `dart run` is accepted on (the Allowlist is a
 * Guardrail, not a privilege boundary; ADR-0001). What is refused is the flag
 * that redirects an anchor a job runs under (the working directory, the
 * project, the machine's Gradle state) or opens arbitrary execution.
 */
export const GRADLE_FLAG_REASONS: Readonly<Record<string, string>> = {
  '-g': "it moves Gradle's user home — machine-level caches and the daemon registry — off the default the developer's own builds share",
  '--gradle-user-home': "it moves Gradle's user home — machine-level caches and the daemon registry — off the default the developer's own builds share",
  '--project-cache-dir': 'it puts the project cache outside the pinned working directory',
  '-I': 'it runs an arbitrary script before the build — general execution behind an allowlisted name, the reason `pnpm exec` is narrowed',
  '--init-script': 'it runs an arbitrary script before the build — general execution behind an allowlisted name, the reason `pnpm exec` is narrowed',
  '-c': 'it points the build at a settings file other than the project\'s own',
  '--settings-file': 'it points the build at a settings file other than the project\'s own',
  '-b': 'it points the build at a build file other than the project\'s own',
  '--build-file': 'it points the build at a build file other than the project\'s own',
  '-D': 'system properties reach org.gradle.java.home and friends — machine-level redirection; the project\'s gradle.properties is the supported home for those',
  '--daemon': 'every gradlew argv is normalised to --no-daemon so a settled job leaves nothing behind',
  '-t': 'it is a watcher that never terminates; a build is a queue job',
  '--continuous': 'it is a watcher that never terminates; a build is a queue job',
  '--stop': "it manages the machine's shared Gradle daemons — state this surface never creates, so it does not manage it either",
  '--status': "it manages the machine's shared Gradle daemons — state this surface never creates, so it does not manage it either",
}

/** The flags `validateGradle` refuses; the reasons live one map up. */
export const GRADLE_BLOCKED_FLAGS = new Set(Object.keys(GRADLE_FLAG_REASONS))

/**
 * The Gradle flags whose *value* decides: `-P`/`--project-prop` set a project
 * property, and the `org.gradle.*` key space is the same redirection `-D` is
 * refused for (`-Porg.gradle.java.home=…` picks the JVM the build runs on).
 * The npm `--location` guard is the precedent: judge the value, not the name.
 */
export const GRADLE_PROPERTY_FLAGS = new Set(['-P', '--project-prop'])
export const GRADLE_RESERVED_PROPERTY_PREFIX = 'org.gradle.'

/**
 * The one Gradle flag that names another directory and is guarded rather than
 * refused: the wrapper and its project may live one level below the working
 * directory (the React Native layout keeps them in `android/`), and a relative
 * `-p android` stays inside the pinned cwd the way `git restore --
 * lib/a.dart` stays inside the worktree. The guard applies the Pathspec
 * rules: literal, relative, no `..`, no bare `.`, no wildcards, no absolute
 * path.
 */
export const GRADLE_PROJECT_DIR_FLAGS = new Set(['-p', '--project-dir'])

/** The two lanes a job may run on. */
export const LANE_QUEUE = 'queue'
export const LANE_LONG = 'long'

/**
 * Script names a project conventionally gives a server or a watcher. Detection
 * cannot be exact for `run <script>` (the name is the project's), and the two
 * error directions are not symmetric: a long job on the queue lane starves
 * everything until it is killed, while a one-shot job on the long lane merely
 * occupies it until it exits.
 */
export const LONG_SCRIPTS = new Set(['dev', 'start', 'serve', 'watch', 'storybook'])

/** git verbs this tool will run; everything else is refused by omission. */
export const GIT_VERBS = new Set([
  'status', 'diff', 'log', 'add', 'commit', 'branch', 'restore',
  'fetch', 'rebase', 'cherry-pick', 'push',
])

/**
 * Why a refused git flag is refused, per verb, because one spelling is several
 * flags: `-x` is rebase's `--exec` and cherry-pick's "record the source", `-f`
 * is fetch's overwrite and push's force, `-e` is cherry-pick's editor. A flat
 * table cannot say which, and the refusal *is* the model's feedback.
 *
 * Three families live here, and they are refused for three different reasons:
 *
 * - **It would block.** A job has no terminal, so an interactive rebase, an
 *   `--edit` cherry-pick or `--autosquash` (which implies `--interactive`) does
 *   not fail — it waits for an editor that will never answer, holding the Queue
 *   lane until somebody kills it. That is the same failure the long lane exists
 *   to prevent, so it is refused by name rather than discovered.
 * - **It runs something.** `--exec` after every rebased commit and
 *   `--upload-pack`/`--receive-pack` on the other side of a connection are
 *   general execution behind an allowlisted verb — the reason `gradlew -I` and
 *   the exec forms are narrowed.
 * - **It writes a ref the caller did not name.** `--update-refs` moves branch
 *   refs beside the one being rebased; fetch's `--tags`/`--force` and push's
 *   `--all`/`--branches`/`--tags`/`--mirror` publish or overwrite refs nobody
 *   named; `--delete` removes one.
 */
export const GIT_FLAG_REASONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  fetch: {
    '-f': 'fetch already forces remote-tracking refs; the flag only adds local ones — a tag or a branch it overwrites, which the fetch did not originate',
    '--force': 'fetch already forces remote-tracking refs; the flag only adds local ones — a tag or a branch it overwrites, which the fetch did not originate',
    '-t': 'it writes every remote tag into the clone — refs the caller never named',
    '--tags': 'it writes every remote tag into the clone — refs the caller never named',
    '--upload-pack': 'it runs an arbitrary program on the other side of the connection — general execution behind an allowlisted verb',
    '--receive-pack': 'it runs an arbitrary program on the other side of the connection — general execution behind an allowlisted verb',
    '--recurse-submodules': 'it writes inside submodules the caller never named',
  },
  rebase: {
    '-i': 'it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it',
    '--interactive': 'it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it',
    '--autosquash': 'it implies --interactive, so it would block waiting for an editor a job has no terminal for',
    '--edit-todo': 'it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it',
    '-x': 'it runs an arbitrary command after every commit — general execution behind an allowlisted verb',
    '--exec': 'it runs an arbitrary command after every commit — general execution behind an allowlisted verb',
    '--update-refs': 'it moves the branch refs of the commits it rewrites, not only the branch it is on — refs the caller never named',
  },
  'cherry-pick': {
    '-e': 'it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it',
    '--edit': 'it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it',
  },
  push: {
    '-f': 'a force push rewrites a remote anyone may already have fetched, and nothing here can undo it',
    '--force': 'a force push rewrites a remote anyone may already have fetched, and nothing here can undo it',
    '--force-with-lease': 'a force push rewrites a remote anyone may already have fetched, and nothing here can undo it',
    '--force-if-includes': 'a force push rewrites a remote anyone may already have fetched, and nothing here can undo it',
    '-d': 'it deletes a remote ref — the destination the caller is meant to name is meant to exist',
    '--delete': 'it deletes a remote ref — the destination the caller is meant to name is meant to exist',
    '--mirror': 'it publishes or deletes every ref the repository has, named or not',
    '--all': 'it publishes every local branch, named or not',
    '--branches': 'it publishes every local branch, named or not',
    '--tags': 'it publishes every tag, named or not',
    '--follow-tags': 'it publishes the annotated tags reachable from the pushed commit — refs the caller never named',
    '--prune': 'it deletes remote-tracking refs the caller never named',
    '--repo': 'it points the push at a repository other than the named remote',
    '--receive-pack': 'it runs an arbitrary program on the other side of the connection — general execution behind an allowlisted verb',
    '--exec': 'it runs an arbitrary program on the other side of the connection — general execution behind an allowlisted verb',
  },
}

/**
 * The per-verb blocked flag sets. The four new verbs derive theirs from
 * `GIT_FLAG_REASONS`, so a flag added to a reason table cannot be missing from
 * the guard — and a flag added without a reason fails the table-driven test.
 */
export const GIT_BLOCKED_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  branch: new Set(['-d', '-D', '--delete', '-m', '-M', '--move']),
  commit: new Set(),
  add: new Set(),
  status: new Set(),
  diff: new Set(),
  log: new Set(),
  fetch: new Set(Object.keys(GIT_FLAG_REASONS['fetch'] ?? {})),
  rebase: new Set(Object.keys(GIT_FLAG_REASONS['rebase'] ?? {})),
  'cherry-pick': new Set(Object.keys(GIT_FLAG_REASONS['cherry-pick'] ?? {})),
  push: new Set(Object.keys(GIT_FLAG_REASONS['push'] ?? {})),
}

/**
 * The flags a push accepts, as an allow list rather than a deny list.
 *
 * `restore` is the precedent (a deny list cannot express a complete surface),
 * and push needs it more: it is the one verb whose effect lands on other people,
 * so a flag nobody here vetted must be refused rather than passed through. What
 * is on it: publish this one branch (`-u` records the upstream for the next
 * call), and report what a push would do without doing it (`--dry-run`,
 * `--porcelain`, `--progress`, `--quiet`, `--verbose`), plus `--atomic` and
 * `--no-verify`.
 */
export const GIT_PUSH_ALLOWED_FLAGS: ReadonlySet<string> = new Set([
  '-u', '--set-upstream', '--dry-run', '--porcelain', '--progress', '--no-progress',
  '-q', '--quiet', '-v', '--verbose', '--atomic', '--no-verify',
])

/**
 * Verbs whose flag surface is an allow list rather than a deny list.
 *
 * `restore` is the one allowed verb that can irrecoverably discard uncommitted
 * work, so both directions of its blast radius are bounded: which flags, and
 * which pathspecs. The deny list cannot express that — the dangerous thing is
 * the default — so everything absent here (`--source`, `--pathspec-from-file`,
 * `-p/--patch`, `--recurse-submodules`, `-m/--merge`, `--overlay`) is refused by
 * omission.
 */
export const GIT_ALLOWED_FLAGS: Record<string, Set<string>> = {
  restore: new Set(['-S', '--staged', '-W', '--worktree', '-q', '--quiet']),
}

/**
 * Characters that make a pathspec a pattern instead of a path. The point of
 * allowing restore is "undo these named files"; `git restore .` is the
 * whole-worktree wipe the tool exists to keep out of reach.
 */
export const PATHSPEC_WILDCARDS = new Set(['*', '?', '[', ']'])

/** Arguments that carry a commit message, so the inline `message` cannot fight one. */
export const MESSAGE_SOURCE_FLAGS = new Set([
  '-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c',
  '--reedit-message', '--fixup', '--squash', '--no-edit',
])

/** The one scope a request may name: the working tree's uncommitted files. */
export const SCOPE_UNCOMMITTED = 'uncommitted'

/**
 * Verbs a scope may be applied to, split by *how*: `dart format` takes any
 * number of trailing paths, so the files are appended to argv and the tool
 * itself is narrowed. `dart analyze` takes at most one directory and `dart fix`
 * takes no path at all, so no argv can express "these files" — there the scope
 * narrows the *reported* lines instead and the exit code still covers the whole
 * project.
 */
export const SCOPE_EXPAND_VERBS = new Set(['format'])
export const SCOPE_FILTER_VERBS = new Set(['analyze', 'fix'])
export const SCOPE_COMMANDS = new Set(['dart', 'flutter'])

/** Endings a scoped command cares about: a changed README or ARB file is not a target. */
export const SCOPE_FILE_SUFFIX = '.dart'

/** How long `git status` may take before the scope is refused, in milliseconds. */
export const GIT_STATUS_TIMEOUT_MS = 20_000

/** The optional per-project known-failure registry (baseline attribution). */
export const KNOWN_FAILURES_RELPATH = '.toolbridge/known-failures.json'
export const KNOWN_FAILURES_MAX_BYTES = 512 * 1024

/**
 * Platforms an entry may be gated to. The tool knows one local distinction —
 * Windows or not — and that is the one that matters: CI runs Linux, where a
 * Windows-only family is expected to pass.
 */
export const KNOWN_PLATFORMS = new Set(['windows', 'posix'])

/**
 * Assessment families an entry may carry: `platform` (fails on this OS only),
 * `flaky` (intermittent), `environment` (setup/machine), `defect` (a real
 * pre-existing bug, in nobody's change) and `unclassified`.
 */
export const KNOWN_KINDS = new Set(['platform', 'flaky', 'environment', 'defect', 'unclassified'])

/** Where the registry lives, relative to the job's working directory. */
export function knownFailuresPath(cwd: string): string {
  return `${cwd.replace(/[\\/]+$/u, '')}\\${KNOWN_FAILURES_RELPATH.replaceAll('/', '\\')}`
}
