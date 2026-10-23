/**
 * The command surface, enforced: which argv this bridge will run, and why not.
 *
 * The tables live in `./surface`; the refusals that argue with them live beside
 * them here, which is the pairing the tables' own header asks for. Two
 * properties of the ported block are load-bearing and easy to lose:
 *
 * - `validate` **rewrites** the list it is handed: npm's bare-script shorthands
 *   become `run <script>`. The caller holds the spawned argv, so that rewrite is
 *   what the job JSON, the long-lane guess and the digest all read.
 * - Every refusal here answered **403**, never 400. The retired route reached
 *   this module only through `ToolHub.submit`, whose `except ValueError` sends
 *   403; every 400 in that handler was decided *before* the call (`cmd`/`args`/
 *   `message`/`scope` types, the log query, the scope mode). That is also why
 *   `buildArgv`'s `'message' must be a string` guard cannot fire over HTTP, and
 *   is kept only for a caller that reaches the function directly.
 */

import { blockedFlag, commandName, flagValue, selectorAt, splitManagerGlobals } from './argv'
import type { ManagerSelector } from './argv'
import { refuse } from './errors'
import {
  ALLOWED_EXES,
  CARGO_BLOCKED_FLAGS,
  CARGO_FLAG_REASONS,
  CARGO_MANIFEST_FLAGS,
  CARGO_TOOLCHAIN_PREFIX,
  CARGO_VERB_REASONS,
  CARGO_VERBS,
  EXEC_BLOCKED_FLAGS,
  GIT_ALLOWED_FLAGS,
  GIT_BLOCKED_FLAGS,
  GIT_FLAG_REASONS,
  GIT_PUSH_ALLOWED_FLAGS,
  GIT_VERBS,
  GRADLE_BLOCKED_FLAGS,
  GRADLE_FLAG_REASONS,
  GRADLE_PROJECT_DIR_FLAGS,
  GRADLE_PROPERTY_FLAGS,
  GRADLE_RESERVED_PROPERTY_PREFIX,
  MANAGER_VALUE_FLAGS,
  MESSAGE_SOURCE_FLAGS,
  NPM_RUN_SHORTHANDS,
  PACKAGE_MANAGER_BLOCKED_FLAGS,
  PACKAGE_MANAGER_GLOBAL_LOCATIONS,
  PACKAGE_MANAGER_LOCATION_FLAG,
  PACKAGE_MANAGER_VERBS,
  PACKAGE_MANAGER_WHOLE_WORKSPACE_FLAGS,
  PACKAGE_MANAGERS,
  PATHSPEC_WILDCARDS,
  SCRIPT_BINARIES,
} from './surface'

/**
 * Python's `repr` of a string, which is how every `{token!r}` in these refusals
 * was formatted.
 *
 * Worth reproducing rather than approximating, because the refusal *is* the
 * model's feedback: `'git'` reads as a quoted token where `git` reads as a word
 * in a sentence, and the single/double quote choice is part of the message a
 * test may assert. The rule is Python's: single quotes unless the text contains
 * one and not a double quote; backslash, the quoting character and the common
 * control characters escaped; printable non-ASCII kept as written.
 */
function repr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'"
  let out = ''
  for (const char of value) {
    if (char === '\\' || char === quote) {
      out += `\\${char}`
    } else if (char === '\n') {
      out += '\\n'
    } else if (char === '\r') {
      out += '\\r'
    } else if (char === '\t') {
      out += '\\t'
    } else if (char === ' ' || !/[\p{C}\p{Z}]/u.test(char)) {
      // Python's `str.isprintable` keeps the ASCII space and everything outside
      // the Unicode Other/Separator categories, which is what this mirrors.
      out += char
    } else {
      const code = char.codePointAt(0) ?? 0
      const digits = code.toString(16)
      out +=
        code <= 0xff
          ? `\\x${digits.padStart(2, '0')}`
          : code <= 0xffff
            ? `\\u${digits.padStart(4, '0')}`
            : `\\U${digits.padStart(8, '0')}`
    }
  }
  return `${quote}${out}${quote}`
}

/**
 * Python's `sorted(...)`, rendered as the list repr these messages carry.
 *
 * The default sort of both languages compares by code unit and neither is
 * numeric-aware, so the tables' lowercase-ASCII members come out in the same
 * order — which matters, because the refusal states the surface and a caller
 * diffing two refusals must not see them disagree.
 */
function sortedList(values: ReadonlySet<string>): string {
  return `[${[...values].sort().map((value) => repr(value)).join(', ')}]`
}

/**
 * Refuses anything outside the documented surface.
 *
 * May *normalise* `argv` in place — `npm test` becomes `npm run test` — so the
 * caller must treat the list it passed as possibly rewritten. One caller holds
 * the spawned argv (`ToolHub.submit`), which is what makes the rewrite visible
 * everywhere downstream: the job JSON, the long-lane guess and the digest all
 * read the normalised form rather than the caller's typing.
 */
export function validate(argv: string[]): void {
  shorthandToRun(argv)
  // An empty argv cannot arrive from the route (`cmd` must be a non-empty
  // string), so the missing head takes the same refusal a misspelled command
  // does rather than an IndexError no caller could read.
  const head = argv[0] ?? ''
  const exe = commandName(head)
  if (!ALLOWED_EXES.has(exe)) {
    refuse(403, `command not allowed: ${repr(head)} (allowed: ${sortedList(ALLOWED_EXES)})`)
  }
  if (exe === 'git') {
    validateGit(argv.slice(1))
    return
  }
  if (exe === 'gradlew') {
    ensureNoDaemon(argv)
    validateGradle(argv.slice(1))
    return
  }
  if (exe === 'cargo') {
    validateCargo(argv.slice(1))
    return
  }
  if (PACKAGE_MANAGERS.has(exe)) {
    validatePackageManager(exe, argv.slice(1))
    return
  }
  if (exe === 'npx') {
    validateNpx(argv.slice(1))
  }
}

/** The `git` surface: named verbs, per-verb flag guards, a message rule. */
export function validateGit(args: readonly string[]): void {
  const verb = args[0]
  if (verb === undefined) {
    refuse(403, 'git needs a verb')
  }
  if (verb.startsWith('-')) {
    // `git --version` and friends carry no repository risk, but keep the
    // surface honest: only the documented verbs. It is also what keeps
    // `git -c core.sshCommand=… push` out — a config injection is an argv
    // *before* the verb, not a flag of one.
    refuse(403, `git verb not allowed: ${repr(verb)}`)
  }
  if (!GIT_VERBS.has(verb)) {
    refuse(403, verbRefusal(verb))
  }
  const body = args.slice(1)
  const allowed = GIT_ALLOWED_FLAGS[verb]
  if (allowed !== undefined) {
    validateRestore(body, allowed)
    return
  }
  if (verb === 'push') {
    validatePush(body)
    return
  }
  validateGitDenyList(verb, body)
  if (verb === 'commit' && !hasMessageSource(body)) {
    refuse(
      403,
      "git commit needs a message: pass the inline 'message' field to " +
        '/run, or one of -m/--message/-F/--file/-C/--reuse-message',
    )
  }
}

/**
 * The deny-list guard behind the verbs that keep git's own flag surface.
 *
 * Stops at the `--` that ends the flag region: everything after it belongs to
 * git's positional grammar (pathspecs for `add`/`commit`, commits for
 * `cherry-pick`), where a token spelled like a flag means something else.
 */
export function validateGitDenyList(verb: string, body: readonly string[]): void {
  const blocked = GIT_BLOCKED_FLAGS[verb] ?? new Set<string>()
  for (const token of body) {
    if (token === '--') {
      return
    }
    if (!token.startsWith('-')) {
      continue
    }
    const hit = blockedFlag(token, blocked)
    if (hit !== null) {
      refuse(403, gitFlagRefusal(verb, hit))
    }
  }
}

/**
 * `git push`: one named remote, one named destination per refspec, nothing else.
 *
 * An **allow list** on the flags, the way `restore` has one, because a deny list
 * cannot say "this surface is complete" — and of every verb here, push is the
 * one whose effect outlives the machine it ran on. The refspec rules are
 * `restore`'s Pathspec guard one level over, on refs instead of paths:
 * `+feature` is a force push by another spelling, `:feature` deletes a remote
 * ref, and a wildcard publishes branches the caller never named.
 */
export function validatePush(body: readonly string[]): void {
  const positionals: string[] = []
  let afterSeparator = false
  for (const token of body) {
    if (afterSeparator) {
      positionals.push(token)
      continue
    }
    if (token === '--') {
      afterSeparator = true
      continue
    }
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }
    const hit = blockedFlag(token, GIT_BLOCKED_FLAGS['push'] ?? new Set<string>())
    if (hit !== null) {
      refuse(403, gitFlagRefusal('push', hit))
    }
    const equals = token.indexOf('=')
    const head = equals >= 0 ? token.slice(0, equals) : token
    if (!GIT_PUSH_ALLOWED_FLAGS.has(head)) {
      refuse(403, pushFlagRefusal(head))
    }
  }
  const remote = positionals[0]
  if (remote === undefined) {
    refuse(
      403,
      'git push needs a remote and a destination ref, e.g. git push origin ' +
        'feature-branch — a bare push publishes whatever the upstream config ' +
        'happens to say, so this surface never runs one',
    )
  }
  guardPushRemote(remote)
  const refspecs = positionals.slice(1)
  if (refspecs.length === 0) {
    refuse(
      403,
      `git push needs a destination ref, e.g. git push ${repr(remote)} ` +
        'feature-branch (or HEAD:refs/heads/feature-branch) — the ref ' +
        'published has to be named, not taken from the upstream config',
    )
  }
  for (const spec of refspecs) {
    guardPushRefspec(spec)
  }
}

/** Why a push flag is refused: the surface is complete, and this is it. */
export function pushFlagRefusal(flag: string): string {
  return (
    `git push flag not allowed: ${repr(flag)} (allowed: ${sortedList(GIT_PUSH_ALLOWED_FLAGS)}) ` +
    '— this surface publishes one named branch to one named remote and ' +
    'rewrites nothing already there'
  )
}

/**
 * A push's remote has to be a *remote*: a name git resolves through its config,
 * or a URL.
 *
 * A filesystem path is a remote git accepts — `git push ../other main` writes
 * into a repository the pinned working directory does not contain — so the same
 * reasoning that refuses `--prefix` refuses a path here.
 */
export function guardPushRemote(remote: string): void {
  const localPath =
    remote.startsWith('.') ||
    remote.startsWith('/') ||
    remote.startsWith('\\') ||
    remote.includes('\\') ||
    /^[A-Za-z]:/u.test(remote)
  if (localPath || /^file:/iu.test(remote)) {
    refuse(
      403,
      `git push remote must be a named remote or a URL, not a local path: ` +
        `${repr(remote)} — a path remote writes into a repository the pinned ` +
        'working directory does not contain',
    )
  }
}

/** The refspec rules: publish one ref, permanently, without forcing or deleting. */
export function guardPushRefspec(spec: string): void {
  if (!spec) {
    refuse(403, 'git push refspec must not be empty')
  }
  if (spec.startsWith('+')) {
    refuse(
      403,
      `git push refspec must not force: ${repr(spec)} — a '+' refspec is a ` +
        'force push by another spelling, and a force push rewrites a remote ' +
        'anyone may already have fetched',
    )
  }
  if (spec.startsWith(':')) {
    refuse(
      403,
      `git push refspec must name a ref to publish, not delete: ${repr(spec)} ` +
        '— a leading colon deletes a remote ref',
    )
  }
  if (spec.includes('*')) {
    refuse(
      403,
      `git push refspec must name one ref, not a pattern: ${repr(spec)} — a ` +
        'wildcard publishes branches the caller never named',
    )
  }
}

/**
 * Rewrites `npm test` / `npm start` into `npm run test` / `npm run start`.
 *
 * Done to the argv list in place, before validation and before the long-lane
 * guess, so the shorthand is not a second surface: everything downstream reads
 * the same `run <script>` argv every other script gets. `test` and `start` are
 * the only two names npm itself abbreviates — `npm build` is not a thing — so
 * nothing else is accepted as one.
 *
 * The shorthand is found through the same split the rest of validation uses, so
 * `npm -w app test` is normalised with its selector still in front of it rather
 * than being read as the verb `-w`.
 */
export function shorthandToRun(argv: string[]): void {
  const head = argv[0]
  if (argv.length < 2 || head === undefined || commandName(head) !== 'npm') {
    return
  }
  const { rest } = splitManagerGlobals('npm', argv.slice(1))
  const shorthand = argv[argv.length - rest.length]
  if (shorthand !== undefined && NPM_RUN_SHORTHANDS.has(shorthand)) {
    argv.splice(argv.length - rest.length, 0, 'run')
  }
}

/**
 * Normalises the forced `--no-daemon` into every `gradlew` argv.
 *
 * Inserted at index 1 — directly behind the command — so a caller's `--`
 * (after which everything belongs to the task, not to Gradle) cannot swallow
 * it: appended at the end, `gradlew :app:help -- --foo` would carry a
 * `--no-daemon` the task reads and Gradle never sees, and a daemon would
 * start behind an exit 0. Idempotent over the pre-`--` region only: a
 * `--no-daemon` the caller typed there is the same flag, while one after
 * `--` is a task argument and does not count. Done here, during validation,
 * for the reason the npm shorthands are rewritten here: the job JSON, the
 * lane guess and the log all read the argv that actually runs.
 */
export function ensureNoDaemon(argv: string[]): void {
  const head = argv[0]
  if (head === undefined || commandName(head) !== 'gradlew') {
    return
  }
  const separator = argv.indexOf('--')
  const surface = separator >= 0 ? argv.slice(0, separator) : argv
  if (!surface.includes('--no-daemon')) {
    argv.splice(1, 0, '--no-daemon')
  }
}

/**
 * The blocked flag a token sets, if any — re-exported from `./argv`, which is
 * where the read lives (the workspace-selector split needs it too).
 */
export { blockedFlag }

/** Why a retargeting flag is refused, and what the caller meant by it. */
export function flagRefusal(manager: string, flag: string): string {
  const where = manager === 'pnpm' ? 'the pinned working directory' : 'the pinned cwd'
  const scope = PACKAGE_MANAGER_WHOLE_WORKSPACE_FLAGS.has(flag)
    ? 'every workspace member at once, which is one invocation writing into all of them'
    : "a different directory, the workspace root, or the machine's global prefix"
  return (
    `${manager} flag not allowed: ${repr(flag)} — it would run outside ${where} ` +
    `(${scope}); the bridge pins one cwd per session and no request can ` +
    'retarget it'
  )
}

/** Why a workspace selector is refused: only a directory selector can escape. */
export function selectorRefusal(manager: string, flag: string): string {
  // The example is the manager's own shape: a package manager runs a script, a
  // cargo selector sits after the verb that reads it.
  const example = manager === 'cargo' ? `cargo test ${flag} web` : `${manager} ${flag} web run build`
  return (
    `${manager} ${repr(flag)} needs a workspace selector value, e.g. ` +
    `${example} — a selector with nothing after it names no member at all`
  )
}

/** Why a `!`-selector is refused: it means "every member except …". */
export function exclusionRefusal(manager: string, value: string): string {
  return (
    `${manager} selector not allowed: ${repr(value)} — a '!' selector means ` +
    'every member except the ones named, which is the whole-workspace run ' +
    '--workspaces is refused for (one invocation writing into all of them); ' +
    'name the members instead'
  )
}

/** Why `--location=<global>` is refused while `--location=project` is not. */
export function locationRefusal(manager: string, value: string): string {
  return (
    `${manager} flag not allowed: '--location=${value}' — it selects the ` +
    "machine's global prefix, which is outside the pinned project; " +
    "'--location=project' is accepted"
  )
}

/**
 * The value of a `--location` token, in either of its shapes.
 *
 * npm writes it as `--location=global` or as the two tokens
 * `--location global`, so both have to be read to refuse the global one.
 */
export function locationValue(token: string): string | null {
  if (token === PACKAGE_MANAGER_LOCATION_FLAG) {
    return ''
  }
  const equals = token.indexOf('=')
  if (equals >= 0 && token.slice(0, equals) === PACKAGE_MANAGER_LOCATION_FLAG) {
    return token.slice(equals + 1)
  }
  return null
}

/**
 * Whether a selector value names a *directory* rather than a package pattern.
 *
 * pnpm's grammar (its own bundled help) is four shapes: a package pattern
 * (`foo`, `@bar/*`, `...foo`), a directory (`./components`, `.`, `{packages}`),
 * a "changed since" clause (`[origin/main]`), and an exclusion (`!foo`). Only
 * the directory shape can leave the tree, so only it is judged by the literal
 * path rules; a scoped name's `/` and a `[since]` clause's `/` are grammar, not
 * separators.
 */
export function isDirectorySelector(value: string): boolean {
  if (value === '.') {
    return true
  }
  // pnpm's graph operators (`...foo`, `...^foo`, `"...@bar/*"`): a *name*
  // pattern with dependents attached, not a directory. `..` is still a directory.
  if (value.startsWith('...')) {
    return false
  }
  if (value.startsWith('@') || value.startsWith('[') || value.startsWith('{')) {
    return false
  }
  return (
    value.startsWith('.') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('/') ||
    value.includes('\\') ||
    /^[A-Za-z]:/u.test(value)
  )
}

/**
 * Guards one workspace selector, wherever it appeared.
 *
 * A selector is not a retarget (the manager still launches in the pinned cwd),
 * but a *directory* selector can still point out of the tree, so it goes through
 * the same `guardLiteralPath` the restore pathspecs and `gradlew -p` use. A
 * package pattern is the workspace's own topology and is left to resolve; a `!`
 * exclusion is refused because it selects everything else.
 */
export function guardSelectorValue(manager: string, selector: ManagerSelector): void {
  const value = selector.value
  if (value === null || value === '') {
    refuse(403, selectorRefusal(manager, selector.flag))
  }
  // pnpm's `.` is "every package under the current directory" — anchored at the
  // pinned cwd itself, which is the one directory that needs no path guard.
  if (value === '.') {
    return
  }
  if (value.startsWith('!')) {
    refuse(403, exclusionRefusal(manager, value))
  }
  // pnpm's `{<dir>}[<since>]`: the directory is guarded, the clause is grammar.
  const brace = value.startsWith('{') ? value.indexOf('}') : -1
  if (brace > 0) {
    guardLiteralPath(value.slice(1, brace), `the ${manager} workspace selector`, 'a directory')
    return
  }
  if (isDirectorySelector(value)) {
    guardLiteralPath(value, `the ${manager} workspace selector`, 'a directory')
  }
}

/**
 * Refuses a retargeting flag anywhere in a remaining-argv list.
 *
 * Stops at the `--` that ends the manager's own surface: everything after it
 * belongs to the script or binary being run, where a token spelled like a
 * manager flag means something else entirely.
 *
 * A workspace selector is *guarded* here rather than refused, in either flag
 * position — after the verb is where the old surface leaked, because nothing
 * looked at `--filter` at all.
 */
export function checkRetargeting(
  manager: string,
  tokens: readonly string[],
  extra: ReadonlySet<string>,
): void {
  const blocked = new Set([...(PACKAGE_MANAGER_BLOCKED_FLAGS[manager] ?? new Set<string>()), ...extra])
  for (const [index, token] of tokens.entries()) {
    if (token === '--') {
      return
    }
    if (!token.startsWith('-')) {
      continue
    }
    const hit = blockedFlag(token, blocked)
    if (hit !== null) {
      refuse(403, flagRefusal(manager, hit))
    }
    const selector = selectorAt(manager, tokens, index)
    if (selector !== null) {
      guardSelectorValue(manager, selector)
      continue
    }
    const value = locationValue(token)
    if (value === null) {
      continue
    }
    let selected = value
    if (!selected) {
      const following = tokens[index + 1] ?? ''
      selected = following.startsWith('-') ? '' : following
    }
    if (PACKAGE_MANAGER_GLOBAL_LOCATIONS.has(selected)) {
      refuse(403, locationRefusal(manager, selected))
    }
  }
}

/**
 * The package-manager surface: named verbs, no retargeting, `exec` guarded.
 *
 * The verb list is an allow list (unlike `flutter`/`dart`, which take any
 * subcommand) because the interesting question for a package manager is what it
 * is allowed to touch, and the answer differs per verb — and, for `ls`, per
 * manager.
 *
 * Both managers accept their **Workspace selector** before the verb as well as
 * after it, so the selectors are lifted first (`splitManagerGlobals`) and
 * guarded once; the verb is then read from what is left, which is also what
 * keeps npm's `-ws`/`-w` collision resolvable (blocked spellings stop the split
 * and meet their own refusal).
 */
export function validatePackageManager(manager: string, args: readonly string[]): void {
  const { selectors, rest } = splitManagerGlobals(manager, args)
  for (const selector of selectors) {
    guardSelectorValue(manager, selector)
  }
  const verb = rest[0]
  if (verb === undefined) {
    refuse(403, `${manager} needs a verb`)
  }
  const blocked = PACKAGE_MANAGER_BLOCKED_FLAGS[manager] ?? new Set<string>()
  const hit = blockedFlag(verb, blocked)
  if (hit !== null) {
    refuse(403, flagRefusal(manager, hit))
  }
  if (verb.startsWith('-')) {
    refuse(403, `${manager} needs a verb before flags: ${repr(verb)}`)
  }
  // `manager` is one of `PACKAGE_MANAGERS` by construction, so the empty
  // fallback is the record lookup the Python did, not a reachable surface.
  const verbs = PACKAGE_MANAGER_VERBS[manager] ?? new Set<string>()
  if (!verbs.has(verb)) {
    refuse(403, `${manager} verb not allowed: ${repr(verb)} (allowed: ${sortedList(verbs)})`)
  }
  if (verb === 'exec') {
    validateExec(manager, rest.slice(1))
    return
  }
  checkRetargeting(manager, rest.slice(1), new Set())
}

/**
 * `npx` is an exec form, not a manager: it runs, it does not install.
 *
 * `npx` **is** `npm exec` with the package named implicitly, so it gets the exec
 * narrowing and none of the verbs — there is no `npx install` to allow.
 */
export function validateNpx(args: readonly string[]): void {
  validateExec('npx', args)
}

/**
 * `npm exec`/`npx`/`pnpm exec` may run a project script binary, nothing else.
 *
 * Measured: the exec forms reach `node --version` and `cmd /c echo hi` because
 * they fall back to PATH, and npx fetches what it cannot find. Allowed as-is
 * that would hand out general command execution behind an allowlisted name —
 * the one thing this list exists to prevent (ADR-0001) — so the target has to
 * be a bare script binary name. Anything else is a 403 naming the run verb.
 */
export function validateExec(manager: string, args: readonly string[]): void {
  let target: string | null = null
  let targetIndex = args.length
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (token === '--') {
      continue
    }
    if (token.startsWith('-')) {
      // A flag's value is not the target: `npm exec -w app vitest` runs vitest.
      const equals = token.indexOf('=')
      const head = equals >= 0 ? token.slice(0, equals) : token
      if (token === head && MANAGER_VALUE_FLAGS.has(head)) {
        index += 1
      }
      continue
    }
    target = token
    targetIndex = index
    break
  }
  // The flag region is scanned in one pass, with the whole argv, so a selector's
  // value is readable: `npm exec -w app vitest` selects `app`, and a per-token
  // scan would see `-w` with nothing after it.
  checkRetargeting(manager, args.slice(0, targetIndex), EXEC_BLOCKED_FLAGS)
  if (target === null) {
    refuse(403, `${manager} needs a script binary to run, e.g. ${manager} vitest run`)
  }
  if (!SCRIPT_BINARIES.has(target)) {
    const substitute =
      manager === 'npm' || manager === 'npx' ? 'npm run <script>' : 'pnpm run <script>'
    refuse(
      403,
      `${manager} exec target not allowed: ${repr(target)} ` +
        `(allowed: ${sortedList(SCRIPT_BINARIES)}) — it runs anything it finds, ` +
        'including things on PATH (and npx fetches what it cannot find), so ' +
        "only the project's own tools are accepted; run a package script " +
        `with '${substitute}' instead`,
    )
  }
}

/** Why a refused git verb is refused, with the substitute when there is one. */
export function verbRefusal(verb: string): string {
  let message = `git verb not allowed: ${repr(verb)} (allowed: ${sortedList(GIT_VERBS)})`
  if (verb === 'checkout' || verb === 'switch') {
    message += " — to discard worktree changes to named paths, use 'git restore -- <path>'"
  }
  return message
}

/** Why a refused git flag is refused; the reasons live beside the table. */
export function gitFlagRefusal(verb: string, flag: string): string {
  const reason = GIT_FLAG_REASONS[verb]?.[flag]
  return reason === undefined
    ? `git ${verb} flag not allowed: ${repr(flag)}`
    : `git ${verb} flag not allowed: ${repr(flag)} — ${reason}`
}

/** Why a refused Gradle flag is refused; the reasons live beside the table. */
export function gradleFlagRefusal(flag: string): string {
  return `gradlew flag not allowed: ${repr(flag)} — ${GRADLE_FLAG_REASONS[flag] ?? 'not on the gradlew surface'}`
}

/** Why an `org.gradle.*` project property is refused while `-P` itself is not. */
export function gradlePropertyRefusal(property: string): string {
  return (
    `gradlew property not allowed: ${repr(property)} — the 'org.gradle.*' key space ` +
    'redirects the build the same way -D does (java.home picks the build JVM); ' +
    "set it in the project's gradle.properties instead"
  )
}

/** Why a refused cargo verb is refused, with its reason when the table has one. */
export function cargoVerbRefusal(verb: string): string {
  const listed = `cargo verb not allowed: ${repr(verb)} (allowed: ${sortedList(CARGO_VERBS)})`
  const reason = CARGO_VERB_REASONS[verb]
  if (reason !== undefined) {
    return `${listed} — ${reason}`
  }
  return (
    `${listed} — cargo dispatches a name it does not know to cargo-<name>.exe on ` +
    'PATH, which is general execution behind an allowlisted command (the reason ' +
    "`pnpm exec` is narrowed to the project's own tools); an installed helper " +
    'such as cargo-binstall or cargo-nextest is refused for the same reason'
  )
}

/** Why a refused cargo flag is refused; the reasons live beside the table. */
export function cargoFlagRefusal(flag: string): string {
  const reason = CARGO_FLAG_REASONS[flag]
  return `cargo flag not allowed: ${repr(flag)}${reason === undefined ? '' : ` — ${reason}`}`
}

/**
 * Why `cargo +<toolchain>` is refused: the toolchain is machine configuration,
 * and every toolchain builds into the one `target/` a job owns.
 */
export function cargoToolchainRefusal(token: string): string {
  return (
    `cargo toolchain selection is not an argv argument here: ${repr(token)} — ` +
    'the toolchain is machine configuration (rustup default, or RUSTUP_TOOLCHAIN ' +
    'in the environment), and every toolchain shares the one target/ directory ' +
    'a job builds into'
  )
}

/**
 * The `gradlew` surface: no verb list, a flag deny list, and two guarded
 * members.
 *
 * Gradle task names are the project's own and cannot be enumerated, so no
 * allow list is consulted — a task can run arbitrary build-script code
 * anyway, which is the same terms `dart run` is accepted on (the Allowlist is
 * a Guardrail, not a privilege boundary; ADR-0001). What is refused is the
 * flag that redirects an anchor (`GRADLE_BLOCKED_FLAGS`), plus two value
 * guards: `-P`/`--project-prop` is judged by its key (`org.gradle.*` is the
 * redirect `-D` is refused for) and `-p`/`--project-dir` must satisfy the
 * literal-path rules, because the React Native layout keeps the wrapper one
 * level below the working directory and a relative `-p android` stays inside
 * the pinned cwd the way `git restore -- lib/a.dart` stays inside the
 * worktree. Scanning stops at `--`, whose task arguments may spell anything.
 */
export function validateGradle(args: readonly string[]): void {
  for (const [index, token] of args.entries()) {
    if (token === '--') {
      return
    }
    if (!token.startsWith('-')) {
      continue
    }
    const hit = blockedFlag(token, GRADLE_BLOCKED_FLAGS)
    if (hit !== null) {
      refuse(403, gradleFlagRefusal(hit))
    }
    const property = [...GRADLE_PROPERTY_FLAGS]
      .map((flag) => flagValue(token, flag, args, index))
      .find((value) => value !== null)
    if (property !== undefined && property.startsWith(GRADLE_RESERVED_PROPERTY_PREFIX)) {
      refuse(403, gradlePropertyRefusal(property))
    }
    for (const flag of GRADLE_PROJECT_DIR_FLAGS) {
      const dir = flagValue(token, flag, args, index)
      if (dir !== null) {
        guardLiteralPath(dir, 'the gradlew project directory', 'a directory')
      }
    }
  }
}

/**
 * The `cargo` surface: an allow-listed verb, a flag deny list with two guarded
 * values, and no verb in front of the flags.
 *
 * Verb-first is the package managers' rule, kept for the same reason: reading
 * the verb past cargo's global flags would mean re-implementing cargo's own
 * grammar (`cargo --offline build` is legal cargo), while the refusal can name
 * the form that works. Nothing is lost, because everything cargo accepts
 * globally it also accepts *after* the verb — `cargo build --offline`,
 * `cargo test -p foo --locked`.
 *
 * No verb list is invented here: the members and the reasons live in
 * `surface.ts`, beside the refusals that argue with them.
 */
export function validateCargo(args: readonly string[]): void {
  const verb = args[0]
  if (verb === undefined) {
    refuse(403, 'cargo needs a verb, e.g. cargo build')
  }
  if (verb.startsWith(CARGO_TOOLCHAIN_PREFIX)) {
    refuse(403, cargoToolchainRefusal(verb))
  }
  if (verb.startsWith('-')) {
    refuse(
      403,
      `cargo needs a verb before flags: ${repr(verb)} — spell it after the ` +
        `verb instead, e.g. 'cargo build ${verb}'`,
    )
  }
  if (!CARGO_VERBS.has(verb)) {
    refuse(403, cargoVerbRefusal(verb))
  }
  validateCargoBody(args.slice(1))
}

/**
 * The flag region of a cargo argv: a deny list, a workspace selector, and a
 * guarded manifest path.
 *
 * The deepening `cargo test -- <libtest args>` is the tool's own grammar, not
 * this surface's, so scanning stops at `--`. The selector is *guarded* rather
 * than refused (it picks one member of a workspace, not another directory), and
 * `--manifest-path` goes through the literal-path rules `gradlew -p` uses, so a
 * relative path can name a crate inside the pinned cwd and nothing else.
 */
export function validateCargoBody(body: readonly string[]): void {
  for (const [index, token] of body.entries()) {
    if (token === '--') {
      return
    }
    if (!token.startsWith('-')) {
      continue
    }
    const hit = blockedFlag(token, CARGO_BLOCKED_FLAGS)
    if (hit !== null) {
      refuse(403, cargoFlagRefusal(hit))
    }
    const selector = selectorAt('cargo', body, index)
    if (selector !== null) {
      guardSelectorValue('cargo', selector)
      continue
    }
    for (const flag of CARGO_MANIFEST_FLAGS) {
      const value = flagValue(token, flag, body, index)
      if (value !== null) {
        guardLiteralPath(value, 'the cargo manifest path', 'a file')
      }
    }
  }
}

/**
 * Whether a flag token sets only allow-listed flags.
 *
 * `--no-X` is the same surface as `--X` (so it is canonicalised), and a short
 * cluster like `-SW`/`-SWq` sets each letter, so each one must be allowed.
 */
export function flagAllowed(token: string, allowed: ReadonlySet<string>): boolean {
  if (token.startsWith('--')) {
    return allowed.has(`--${token.slice(2).replace(/^no-/u, '')}`)
  }
  if (token.length > 2) {
    return [...token.slice(1)].every((char) => allowed.has(`-${char}`))
  }
  return allowed.has(token)
}

/**
 * Whether a pathspec would escape the worktree, in any of the three shapes
 * Python refused here.
 *
 * `os.path.isabs` (a drive *and* a root, a UNC share, or a leading separator),
 * `os.path.splitdrive` (also truthy for a drive-relative `C:lib/a.dart`) and
 * the explicit `spec[0] in "/\\"` check that catches a rooted path on Windows —
 * where `os.path.isabs` is false, yet git would still resolve it against the
 * drive. All three raise the same message, so folding them into one condition
 * changes nothing a caller or a test can see.
 */
function escapesWorktree(spec: string): boolean {
  return /^[A-Za-z]:/u.test(spec) || spec.startsWith('/') || spec.startsWith('\\')
}

/**
 * Refuses any pathspec that is not a literal path inside the worktree.
 *
 * `git restore` discards uncommitted work irrecoverably, so the only shape this
 * bridge accepts is "these named files, please": no pathspec magic, no globs,
 * no absolute paths, no `..`, and no bare `.` (which is the whole worktree).
 * The gradlew `-p` guard reuses the same rules with its own subject and noun,
 * which is why both are parameters: one rule, two wordings, no drift.
 */
export function guardLiteralPath(spec: string, what: string, noun: string): void {
  if (!spec) {
    refuse(403, `${what} must not be empty`)
  }
  if (spec.startsWith(':')) {
    refuse(403, `${what} magic is not allowed: ${repr(spec)}`)
  }
  if (escapesWorktree(spec)) {
    refuse(403, `${what} must be relative: ${repr(spec)}`)
  }
  const wildcard = [...new Set([...spec].filter((char) => PATHSPEC_WILDCARDS.has(char)))].sort()
  if (wildcard.length > 0) {
    refuse(
      403,
      `${what} must name ${noun}, not a pattern: ` +
        `${repr(spec)} contains ${repr(wildcard.join(''))}`,
    )
  }
  const parts = spec.split(/[\\/]/u).filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.includes('..')) {
    refuse(
      403,
      `${what} must name ${noun} inside the working ` + `directory: ${repr(spec)}`,
    )
  }
}

/** `guardLiteralPath` as `git restore` worded it, for the restore surface. */
export function guardRestorePathspec(spec: string): void {
  guardLiteralPath(spec, 'git restore pathspec', 'files')
}

/** The `restore` surface: an allow-listed flag set and literal pathspecs. */
export function validateRestore(args: readonly string[], allowed: ReadonlySet<string>): void {
  const pathspecs: string[] = []
  let afterSeparator = false
  for (const token of args) {
    if (afterSeparator) {
      pathspecs.push(token)
      continue
    }
    if (token === '--') {
      afterSeparator = true
      continue
    }
    if (token.startsWith('-')) {
      if (!flagAllowed(token, allowed)) {
        refuse(403, `git restore flag not allowed: ${repr(token)}`)
      }
      continue
    }
    pathspecs.push(token)
  }
  if (pathspecs.length === 0) {
    refuse(
      403,
      'git restore needs at least one explicit path, e.g.' +
        ' git restore -- lib/main.dart',
    )
  }
  for (const spec of pathspecs) {
    guardRestorePathspec(spec)
  }
}

/** Whether a `git commit` argv already carries a message. */
export function hasMessageSource(args: readonly string[]): boolean {
  for (const token of args) {
    const equals = token.indexOf('=')
    const head = equals >= 0 ? token.slice(0, equals) : token
    if (MESSAGE_SOURCE_FLAGS.has(head)) {
      return true
    }
  }
  return false
}

/**
 * Assembles the argv, folding an inline commit message in as `-m <text>`.
 *
 * `-m` rather than a temp file or stdin: no file exists for a later
 * `git add -A` to sweep up (the incident this closes), nothing to clean up, and
 * no pipe to deadlock on. The message therefore travels as argv — UTF-8 through
 * JSON, never through a shell or a pwsh `Set-Content`.
 */
export function buildArgv(
  cmd: string,
  args: readonly string[],
  message: string | null,
): string[] {
  if (message === null) {
    return [cmd, ...args]
  }
  if (typeof message !== 'string') {
    refuse(403, "'message' must be a string")
  }
  if (!message.trim()) {
    refuse(403, "'message' must not be empty")
  }
  const head = args[0]
  if (commandName(cmd) !== 'git' || head === undefined || head !== 'commit') {
    refuse(403, "'message' is only valid for git commit")
  }
  const body = args.slice(1)
  for (const token of body) {
    const equals = token.indexOf('=')
    const flag = equals >= 0 ? token.slice(0, equals) : token
    if (MESSAGE_SOURCE_FLAGS.has(flag)) {
      refuse(403, `pass the commit message either inline or as ${repr(token)}, not both`)
    }
  }
  return [cmd, 'commit', '-m', message, ...body]
}
