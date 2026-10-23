/**
 * Reading an argv back: what command is this, and does it run a test runner?
 *
 * These are the questions the digest and the long-lane guess ask *before*
 * looking at a log, so they live apart from both: resolution needs
 * `commandName`, the digest needs the exec-form peel, and neither should have to
 * import the other.
 */

import {
  MANAGER_VALUE_FLAGS,
  PACKAGE_MANAGER_BLOCKED_FLAGS,
  PACKAGE_MANAGER_RUNNERS,
  PACKAGE_MANAGER_SELECTOR_FLAGS,
  PACKAGE_MANAGERS,
} from './surface'

/** The bare tool name behind a path or a Windows wrapper suffix. */
export function commandName(cmd: string): string {
  const lastSlash = Math.max(cmd.lastIndexOf('/'), cmd.lastIndexOf('\\'))
  let exe = (lastSlash >= 0 ? cmd.slice(lastSlash + 1) : cmd).toLowerCase()
  for (const suffix of ['.bat', '.exe', '.cmd']) {
    if (exe.endsWith(suffix)) {
      exe = exe.slice(0, -suffix.length)
      break
    }
  }
  return exe
}

/**
 * The value a flag token carries, as the flag's own argument, or null.
 *
 * Reads the three shapes a value travels in: attached to a short flag
 * (`-pdir`), joined by `=` (`--project-dir=dir`), and the following token
 * (`-p dir`, `--project-dir dir`). A flag at the end of the argv has no
 * following token and answers null — whatever the tool itself does with that
 * is the tool's error to make. Both callers read it after `--` has ended the
 * flag region, so a task argument that merely looks like a value is never
 * picked up here.
 */
export function flagValue(
  token: string,
  flag: string,
  args: readonly string[],
  index: number,
): string | null {
  if (token === flag) {
    return args[index + 1] ?? null
  }
  if (token.startsWith(`${flag}=`)) {
    return token.slice(flag.length + 1)
  }
  if (flag.length === 2 && token.startsWith(flag) && token.length > flag.length) {
    return token.slice(flag.length)
  }
  return null
}

/** Whether argv is a `flutter test` / `dart test` invocation. */
export function isTestRun(argv: readonly string[]): boolean {
  if (argv.length < 2) return false
  const first = argv[0]
  const second = argv[1]
  if (first === undefined || second === undefined) return false
  return (commandName(first) === 'flutter' || commandName(first) === 'dart') && second === 'test'
}

/**
 * Whether argv is a `cargo test` invocation.
 *
 * Readable from the argv alone, unlike vitest behind a project's script name:
 * `cargo test` names its runner, and the surface puts the verb first
 * (`validateCargo`), so the second token is it.
 */
export function isCargoTestRun(argv: readonly string[]): boolean {
  const first = argv[0]
  const second = argv[1]
  if (first === undefined || second === undefined) return false
  return commandName(first) === 'cargo' && second === 'test'
}

/**
 * The blocked flag a token sets, if any.
 *
 * Handles the three shapes a flag travels in: `--dir x`, `--dir=x` and a short
 * one attached to its value (`-Cx`), which is why a short blocked flag is
 * matched as a prefix rather than by equality.
 *
 * It lives here rather than beside the refusals because it is a *read* of an
 * argv against a table, and both the guard and the workspace-selector split need
 * it: `-ws` is npm's `--workspaces` before it is pnpm's attached `-w s`.
 */
export function blockedFlag(token: string, blocked: ReadonlySet<string>): string | null {
  const equals = token.indexOf('=')
  const head = equals >= 0 ? token.slice(0, equals) : token
  if (blocked.has(head)) {
    return head
  }
  for (const short of blocked) {
    if (
      short.startsWith('-') &&
      !short.startsWith('--') &&
      token.startsWith(short) &&
      token.length > short.length
    ) {
      return short
    }
  }
  return null
}

/** One workspace-selector occurrence: its flag, and the value it carries. */
export interface ManagerSelector {
  readonly flag: string
  readonly value: string | null
}

/** Whether a token sets `flag`, in any of the three shapes a value travels in. */
function setsFlag(token: string, flag: string): boolean {
  return (
    token === flag ||
    token.startsWith(`${flag}=`) ||
    (flag.length === 2 && !flag.startsWith('--') && token.startsWith(flag) && token.length > flag.length)
  )
}

/**
 * The workspace selector a token spells, if it spells one.
 *
 * `value` is null in two different situations the caller must tell apart: the
 * flag is absent (the return is null), and the flag is present with nothing
 * after it (`pnpm --filter` — a refusal, not a verb). Every caller guards the
 * value; none guesses it.
 */
export function selectorAt(
  manager: string,
  tokens: readonly string[],
  index: number,
): ManagerSelector | null {
  const flags = PACKAGE_MANAGER_SELECTOR_FLAGS[manager]
  const token = tokens[index]
  if (flags === undefined || token === undefined) return null
  for (const flag of flags) {
    if (setsFlag(token, flag)) {
      return { flag, value: flagValue(token, flag, tokens, index) }
    }
  }
  return null
}

/** The pre-verb part of a package-manager argv, and the argv from the verb on. */
export interface ManagerGlobals {
  /** Selector occurrences, in the order the caller wrote them. */
  readonly selectors: readonly ManagerSelector[]
  /** The argv from the verb on — what a plain `args[0]` reader used to see. */
  readonly rest: readonly string[]
}

/**
 * Splits a package manager's argv at its verb, lifting the selectors in front.
 *
 * Both managers accept their selector before *or* after the verb, and after the
 * verb is where the guard used to leak: `pnpm run --filter ../.. build` passed
 * validation because nothing looked at `--filter` at all. So the selector is
 * read in one place (`selectorAt`), guarded in one place (the guard iterates
 * what this returns *and* scans the post-verb region), and the verb is read from
 * `rest` everywhere — by the npm run shorthands, by the long-lane guess, and by
 * validation.
 *
 * A blocked spelling stops the split instead of being taken as a selector: npm's
 * `-ws` is `--workspaces` (refused), not `-w s`, and leaving it in `rest` is
 * what lets validation refuse it by name.
 */
export function splitManagerGlobals(manager: string, args: readonly string[]): ManagerGlobals {
  const blocked = PACKAGE_MANAGER_BLOCKED_FLAGS[manager]
  const selectors: ManagerSelector[] = []
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] as string
    if (blocked !== undefined && blockedFlag(token, blocked) !== null) {
      return { selectors, rest: args.slice(index) }
    }
    const selector = selectorAt(manager, args, index)
    if (selector === null) {
      return { selectors, rest: args.slice(index) }
    }
    selectors.push(selector)
    if (token === selector.flag && index + 1 < args.length) {
      index += 1
    }
  }
  return { selectors, rest: [] }
}

/**
 * The script a `run`/`run-script` argv names, read past the flags in front of it.
 *
 * The first non-flag token is not the script when a flag takes a value:
 * `pnpm run --filter web dev` runs `dev`, and reading `web` as the script name
 * is what guessed a dev server onto the queue lane. `MANAGER_VALUE_FLAGS` is the
 * table of flags whose value is the next token; a value attached to its flag
 * (`-Fweb`, `--filter=web`) needs no skipping.
 */
export function runScriptToken(rest: readonly string[]): string | undefined {
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string
    if (token === '--') {
      return undefined
    }
    if (!token.startsWith('-')) {
      return token
    }
    const equals = token.indexOf('=')
    const head = equals >= 0 ? token.slice(0, equals) : token
    if (token === head && MANAGER_VALUE_FLAGS.has(head)) {
      index += 1
    }
  }
  return undefined
}

/**
 * Peel an exec form: the script binary it runs, and its own arguments.
 *
 * `pnpm exec vitest run`, `npm exec vitest run` and `npx vitest run` all mean
 * "run the project's vitest", so they are one shape with three spellings.
 * Returns undefined for anything else, including an exec form with no target or
 * one whose target is a flag.
 */
export function execTarget(argv: readonly string[]): { target: string; args: string[] } | undefined {
  const first = argv[0]
  if (first === undefined) return undefined
  const name = commandName(first)
  let rest: readonly string[]
  if (name === 'npx') {
    rest = argv.slice(1)
  } else if (PACKAGE_MANAGERS.has(name) && argv[1] === 'exec') {
    rest = argv.slice(2)
  } else {
    return undefined
  }
  const positional = rest.filter((token) => token !== '--')
  const head = positional[0]
  if (head === undefined || head.startsWith('-')) return undefined
  return { target: commandName(head), args: positional.slice(1) }
}

/**
 * Whether argv certainly runs vitest — the binary, or an exec form of it.
 *
 * `pnpm run test` (and `npm run test`, or the `npm test` shorthand) also runs
 * vitest and cannot be told from the argv, which is what `mightRunVitest` plus
 * the log sniff are for.
 */
export function isVitestRun(argv: readonly string[]): boolean {
  const first = argv[0]
  if (first === undefined) return false
  if (commandName(first) === 'vitest') return true
  const peeled = execTarget(argv)
  return peeled !== undefined && peeled.target === 'vitest'
}

/**
 * Whether argv *could* be a vitest run without naming it.
 *
 * Only a gate for the content sniff, so a `git log` or `dart analyze` job never
 * opens its log looking for a reporter it cannot have.
 */
export function mightRunVitest(argv: readonly string[]): boolean {
  const first = argv[0]
  return first !== undefined && (PACKAGE_MANAGER_RUNNERS.has(commandName(first)) || commandName(first) === 'vitest')
}

/**
 * Split a reporter `path: name` description, if it really has a path.
 *
 * A single-file run prints no path at all (`printPath` is on only when more than
 * one test file was selected) and a test name may contain a colon, so the head
 * has to *look* like a path: end in `.dart` or contain a separator.
 */
export function splitPathAndName(text: string): { file: string | null; name: string } {
  const separator = text.indexOf(': ')
  if (separator >= 0) {
    const head = text.slice(0, separator)
    const tail = text.slice(separator + 2)
    if (head.includes('/') || head.includes('\\') || head.endsWith('.dart')) {
      return { file: head, name: tail }
    }
  }
  return { file: null, name: text }
}
