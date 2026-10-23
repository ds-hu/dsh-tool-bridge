import { describe, expect, it } from 'vitest'
import { RefusalError } from '../src/engine/errors'
import {
  CARGO_FLAG_REASONS,
  CARGO_VERB_REASONS,
  CARGO_VERBS,
  GIT_FLAG_REASONS,
  GRADLE_BLOCKED_FLAGS,
  SCRIPT_BINARIES,
} from '../src/engine/surface'
import { buildArgv, validate } from '../src/engine/validate'

/**
 * The refusal a call makes, read the way the model would.
 *
 * Every refusal in `validate`/`buildArgv` answered 403 at the retired route —
 * both are reached only through `ToolHub.submit`, inside the `/run` handler's
 * `except ValueError` branch — so the code is asserted here once instead of in
 * every case, which is also what keeps the ported message fragments honest.
 */
function refusal(run: () => void): string {
  try {
    run()
  } catch (error) {
    if (error instanceof RefusalError) {
      expect(error.code).toBe(403)
      return error.message
    }
    throw error
  }
  throw new Error('expected a refusal')
}

describe('git restore guard (RestoreGuardTests)', () => {
  // `git restore` is allowed only for literal paths inside the worktree.
  const ALLOWED: string[][] = [
    ['git', 'restore', '--', 'lib/a.dart', 'test/b_test.dart'],
    ['git', 'restore', 'lib/a.dart'],
    ['git', 'restore', '-q', 'lib/a.dart'],
    ['git', 'restore', '--staged', 'lib/a.dart'],
    ['git', 'restore', '-S', '-W', 'lib/a.dart'],
    ['git', 'restore', '-SW', 'lib/a.dart'],
    ['git', 'restore', '--no-staged', 'lib/a.dart'],
    ['git', 'restore', '--', 'test/desktop/-leading-dash.dart'],
  ]

  // argv -> (required fragment of the refusal, canary token that must survive)
  const REFUSED: ReadonlyArray<readonly [string[], string, string | null]> = [
    [['git', 'restore'], 'at least one explicit path', null],
    [['git', 'restore', '--'], 'at least one explicit path', null],
    [['git', 'restore', '.'], 'must name files inside', null],
    [['git', 'restore', './'], 'must name files inside', null],
    [['git', 'restore', 'canary-parent/../lib/a.dart'], 'canary-parent', 'canary-parent'],
    [['git', 'restore', 'canary-wild/*.dart'], 'canary-wild', 'canary-wild'],
    [['git', 'restore', 'canary-glob/**'], 'canary-glob', 'canary-glob'],
    [['git', 'restore', 'canary-q?.dart'], 'canary-q', 'canary-q'],
    [['git', 'restore', ':canary-magic'], 'canary-magic', 'canary-magic'],
    [['git', 'restore', ':/'], 'pathspec magic', null],
    [['git', 'restore', 'D:/canary-abs/a.dart'], 'canary-abs', 'canary-abs'],
    [['git', 'restore', '/canary-root/a.dart'], 'must be relative', 'canary-root'],
    [['git', 'restore', '--pathspec-from-file=canary-list.txt'], 'canary-list', 'canary-list'],
    [['git', 'restore', '--pathspec-file-nul', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '-s', 'HEAD~1', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '--source=HEAD~1', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '-p', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '--recurse-submodules', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '--merge', 'lib/a.dart'], 'not allowed', null],
    [['git', 'restore', '--conflict=diff3', 'lib/a.dart'], 'not allowed', null],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses the forms that would name work the caller did not', () => {
    for (const [argv, fragment, canary] of REFUSED) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain(fragment)
      if (canary !== null) {
        expect(message, `argv=${JSON.stringify(argv)}`).toContain(canary)
      }
    }
  })

  it('keeps the destructive verbs out', () => {
    for (const verb of ['reset', 'clean', 'checkout', 'switch', 'stash']) {
      refusal(() => validate(['git', verb, '--', 'lib/a.dart']))
    }
  })

  it('names the substitute in the checkout refusal', () => {
    const message = refusal(() => validate(['git', 'checkout', '--', 'lib/a.dart']))
    expect(message).toContain('git restore --')
  })

  it('still refuses a branch delete', () => {
    refusal(() => validate(['git', 'branch', '-D', 'feature']))
  })

  it('is not bypassed by a glob', () => {
    // The guard would be vacuous if a pattern slipped through.
    refusal(() => validate(['git', 'restore', '*']))
  })
})

describe('inline commit message (CommitMessageTests)', () => {
  // "message" is folded in as argv, so no temp file ever exists.
  it('folds the message in as -m', () => {
    const argv = buildArgv('git', ['commit', '--amend'], 'slice 2: 中文')
    expect(argv).toEqual(['git', 'commit', '-m', 'slice 2: 中文', '--amend'])
    validate(argv)
  })

  it('keeps a multiline message whole', () => {
    const body = 'subject line\n\nbody paragraph'
    const argv = buildArgv('git', ['commit'], body)
    expect(argv[3]).toBe(body)
  })

  it('leaves argv alone without a message', () => {
    expect(buildArgv('git', ['commit', '-m', 'x'], null)).toEqual(['git', 'commit', '-m', 'x'])
  })

  it('refuses a message without a git commit', () => {
    for (const args of [['status'], ['add', '-A'], ['', 'commit']]) {
      refusal(() => buildArgv('git', args, 'nope'))
    }
    refusal(() => buildArgv('flutter', ['test'], 'nope'))
  })

  it('refuses a message beside a message flag', () => {
    for (const token of ['-m', '--message=x', '-F', '--file=msg.txt']) {
      refusal(() => buildArgv('git', ['commit', token], 'inline'))
    }
  })

  it('refuses an empty message', () => {
    for (const message of ['', '   ', '\n']) {
      refusal(() => buildArgv('git', ['commit'], message))
    }
  })

  it('refuses a commit with no message at all', () => {
    const message = refusal(() => validate(['git', 'commit']))
    expect(message).toContain('message')
  })

  it('still allows the message sources git has', () => {
    for (const token of ['-m', '--message', '-F', '--file', '--reuse-message']) {
      validate(['git', 'commit', token])
    }
  })
})

describe('pnpm surface (PnpmSurfaceTests)', () => {
  const ALLOWED: string[][] = [
    ['pnpm', 'install'],
    ['pnpm', 'install', '--no-frozen-lockfile'],
    ['pnpm', 'add', '-D', 'svelte'],
    ['pnpm', 'update'],
    ['pnpm', 'run', 'build'],
    ['pnpm', 'run', 'dev', '--', '--host'],
    ['pnpm', 'exec', 'vitest', 'run', '--pool=threads'],
    ['pnpm', 'exec', '--', 'vitest', 'run'],
    ['pnpm', 'why', 'svelte'],
  ]

  const REFUSED: string[][] = [
    ['pnpm'],
    ['pnpm', '--version'],
    ['pnpm', 'publish'],
    ['pnpm', 'dlx', 'create-svelte'],
    ['pnpm', 'store', 'prune'],
    ['pnpm', '-C', 'elsewhere', 'run', 'build'],
    ['pnpm', 'install', '--prefix', 'elsewhere'],
    ['pnpm', 'install', '-g', 'typescript'],
    ['pnpm', 'run', 'build', '-w'],
    ['pnpm', 'exec', 'node', '--version'],
    ['pnpm', 'exec', 'cmd', '/c', 'echo hi'],
    ['pnpm', 'exec', './node_modules/.bin/vitest', 'run'],
    ['pnpm', 'exec', '-c', 'vitest run'],
    ['pnpm', 'exec'],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses everything else', () => {
    for (const argv of REFUSED) {
      refusal(() => validate([...argv]))
    }
  })

  it('says what a retargeting flag would have done', () => {
    // The refusal has to read as "run somewhere else", not as a typo.
    for (const argv of [
      ['pnpm', '-C', 'elsewhere', 'install'],
      ['pnpm', 'install', '--prefix=elsewhere'],
      ['pnpm', 'install', '-g', 'typescript'],
    ]) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain('pinned')
    }
  })

  it('names the substitute for an exec target outside the tool set', () => {
    const message = refusal(() => validate(['pnpm', 'exec', 'node', '-e', '1']))
    expect(message).toContain('pnpm run')
  })

  it('treats the script binaries as commands of their own', () => {
    for (const name of [...SCRIPT_BINARIES].sort()) {
      validate([name, '--version'])
    }
  })

  it('lists what is allowed for an unknown command', () => {
    // The refusal has to name the surface, so a typo is self-correcting.
    const message = refusal(() => validate(['yarn', 'install']))
    for (const name of ['npm', 'pnpm', 'vitest']) {
      expect(message).toContain(name)
    }
  })
})

describe('npm surface (NpmSurfaceTests)', () => {
  // `npm` is a package manager on the same terms as `pnpm`, plus its own two.
  //
  // What is npm-specific here, and why each is asserted:
  //
  // - `test`/`start` are the only bare-script shorthands npm itself has; they
  //   must be normalised to `run <script>`, not accepted as verbs of their own,
  //   or the long-lane guess and the digest would read a different argv.
  // - `--location=global` is refused while `--location=project` is not: the flag
  //   is the one blocked flag whose *value* decides, so a guard that only looked
  //   at the flag's name would be wrong in one of the two directions.
  // - `npx` is an exec form, not a manager: it has no verbs, so `npx install`
  //   must fail the same way `npx cow` does.
  const ALLOWED: string[][] = [
    ['npm', 'install'],
    ['npm', 'ci'],
    ['npm', 'install', '--no-audit', '--no-fund'],
    ['npm', 'add', '-D', 'svelte'],
    ['npm', 'update'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'dev', '--', '--host'],
    ['npm', 'exec', 'vitest', 'run', '--pool=threads'],
    ['npm', 'exec', '--', 'vitest', 'run'],
    ['npm', 'why', 'svelte'],
    ['npm', 'install', '--location=project'],
    ['npm', 'install', '--workspace', 'app'],
    ['npm', 'install', '-wapp'],
    ['npm', 'run', 'build', '-w', 'app'],
    ['npm', 'test', '-w', 'app'],
    ['npm', '-w', 'app', 'run', 'build'],
    ['npx', 'vitest', 'run'],
    ['npx', '--', 'vite', 'build'],
  ]

  const REFUSED: string[][] = [
    ['npm'],
    ['npm', '--version'],
    ['npm', 'publish'],
    ['npm', 'config', 'get', 'registry'],
    ['npm', 'init', '-y'],
    ['npm', 'link'],
    ['npm', 'unlink'],
    ['npm', 'cache', 'clean', '--force'],
    ['npm', 'install', '--prefix', 'elsewhere'],
    ['npm', 'install', '--prefix=elsewhere'],
    ['npm', 'install', '-C', 'elsewhere'],
    ['npm', 'install', '-Celsewhere'],
    ['npm', 'install', '-g', 'typescript'],
    ['npm', 'install', '--global', 'typescript'],
    ['npm', 'install', '--location=global'],
    ['npm', 'install', '--location', 'global'],
    ['npm', 'install', '--workspaces'],
    ['npm', 'install', '-ws'],
    ['npm', 'install', '--include-workspace-root'],
    ['npm', 'run', 'build', '--workspace-root'],
    ['npm', 'exec', 'node', '--version'],
    ['npm', 'exec', 'cmd', '/c', 'echo hi'],
    ['npm', 'exec'],
    ['npx', 'cowsay'],
    ['npx', '--yes', 'cowsay'],
    ['npx', '--package', 'left-pad', 'cowsay'],
    ['npx', '-p', 'left-pad', 'cowsay'],
    ['npx', '-c', 'echo hi'],
    ['npx'],
    ['npx', 'install'],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses everything else', () => {
    for (const argv of REFUSED) {
      refusal(() => validate([...argv]))
    }
  })

  it('normalises the shorthands rather than accepting them as verbs', () => {
    // `npm test` is `npm run test` by the time anything reads the argv.
    const cases: ReadonlyArray<readonly [string[], string[]]> = [
      [['npm', 'test'], ['npm', 'run', 'test']],
      [['npm', 'start'], ['npm', 'run', 'start']],
      [['npm', 'start', '--', '--host'], ['npm', 'run', 'start', '--', '--host']],
      [['npm', 'test', '--', '--coverage'], ['npm', 'run', 'test', '--', '--coverage']],
      // The shorthand is found through the selector, not read as the verb
      // `-w`: the normalised argv is what the lane guess and the digest read.
      [['npm', '-w', 'app', 'test'], ['npm', '-w', 'app', 'run', 'test']],
      [['npm', '--workspace=app', 'start'], ['npm', '--workspace=app', 'run', 'start']],
    ]
    for (const [argv, want] of cases) {
      const normalised = [...argv]
      validate(normalised)
      expect(normalised, `argv=${JSON.stringify(argv)}`).toEqual(want)
    }
  })

  it('treats only npm\'s own two names as shorthands', () => {
    // `npm build` is not a thing npm understands, so it is not a verb here.
    const message = refusal(() => validate(['npm', 'build']))
    expect(message).toContain('npm verb not allowed')
  })

  it('judges --location by its value', () => {
    // The value-dependent guard has to fail in exactly one direction.
    validate(['npm', 'install', '--location=project'])
    for (const argv of [
      ['npm', 'install', '--location=global'],
      ['npm', 'install', '--location', 'global'],
      ['npm', 'install', '--location=user'],
    ]) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain('--location')
    }
  })

  it('leaves a flag after the separator to the script', () => {
    // `--` ends the manager's surface; `npm run build -- --prefix x` is fine.
    validate(['npm', 'run', 'build', '--', '--prefix', 'webpack-thing'])
  })

  it('says what a retargeting flag would have done', () => {
    for (const argv of [
      ['npm', 'install', '--prefix', 'elsewhere'],
      ['npm', 'install', '-C', 'elsewhere'],
      ['npm', 'install', '-g', 'typescript'],
      ['npm', 'install', '--workspaces'],
      ['pnpm', 'install', '--workspace', 'app'],
      ['pnpm', 'run', 'build', '-w'],
    ]) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain('pinned')
    }
  })

  it('says "every member" when the refused spelling means the whole workspace', () => {
    // `--workspaces` is not "somewhere else", it is "all of them at once", and
    // the refusal has to read that way or the caller retries the same shape.
    for (const argv of [
      ['npm', 'install', '--workspaces'],
      ['npm', 'install', '-ws'],
      ['npm', 'install', '--include-workspace-root'],
    ]) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain('every workspace member')
    }
  })

  it('names the substitute for an exec target outside the tool set', () => {
    const cases: ReadonlyArray<readonly [string[], string]> = [
      [['npm', 'exec', 'node', '-e', '1'], 'npm run'],
      [['npx', 'cowsay'], 'npm run'],
      [['pnpm', 'exec', 'node', '-e', '1'], 'pnpm run'],
    ]
    for (const [argv, substitute] of cases) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain(substitute)
    }
  })

  it('keeps pnpm\'s own refusal wording', () => {
    // Two managers, one guard — but a refusal always names which one.
    const message = refusal(() => validate(['pnpm', 'install', '-g', 'typescript']))
    expect(message.startsWith('pnpm flag not allowed')).toBe(true)
  })
})

describe('gradlew surface (GradleSurfaceTests)', () => {
  // No verb list: the task name is the project's own. What is refused is the
  // flag that redirects an anchor or opens execution — plus two value guards:
  // `-p` (a relative project directory inside the cwd, the RN layout keeps
  // the wrapper one level down) and `-P` (judged by its key, because
  // `org.gradle.*` is the redirect `-D` is refused for).
  const ALLOWED: string[][] = [
    ['gradlew', ':app:assembleDebug'],
    ['gradlew', ':app:assembleDebug', '-PreactNativeArchitectures=x86_64'],
    ['gradlew', '-P', 'reactNativeArchitectures=x86_64', ':app:assembleDebug'],
    ['gradlew', '--project-prop', 'reactNativeArchitectures=x86_64', ':app:assembleDebug'],
    ['gradlew', '--project-prop=reactNativeArchitectures=x86_64', ':app:assembleDebug'],
    ['gradlew', '--no-daemon', ':app:help'],
    ['gradlew', '-p', 'android', ':app:help'],
    ['gradlew', '-pandroid', ':app:help'],
    ['gradlew', '--project-dir=android', ':app:help'],
    ['gradlew', '--project-dir', 'android', ':app:help'],
    ['gradlew', '--offline', '--console=plain', ':app:assembleDebug'],
    // `--` ends the flag surface: what follows belongs to the task.
    ['gradlew', ':app:help', '--', '-g', 'elsewhere'],
    ['gradlew', ':app:help', '--', '-Dorg.gradle.java.home=C:\\jdk17'],
    ['gradlew', ':app:help', '--', '--stop'],
  ]

  const REFUSED: string[][] = [
    ['gradlew', '-g', 'C:\\elsewhere'],
    ['gradlew', '-gC:\\elsewhere'],
    ['gradlew', '--gradle-user-home', 'C:\\elsewhere'],
    ['gradlew', '--gradle-user-home=C:\\elsewhere'],
    ['gradlew', '--project-cache-dir', 'elsewhere'],
    ['gradlew', '-I', 'x.gradle'],
    ['gradlew', '-Ix.gradle'],
    ['gradlew', '--init-script=x.gradle'],
    ['gradlew', '-c', 'other.settings.gradle'],
    ['gradlew', '--settings-file=x'],
    ['gradlew', '-b', 'other.build.gradle'],
    ['gradlew', '--build-file=x'],
    // Every -D is refused, not just org.gradle.*: the legitimate ones have a
    // project-side home in gradle.properties.
    ['gradlew', '-Dorg.gradle.java.home=C:\\jdk17'],
    ['gradlew', '-Dfile.encoding=UTF-8'],
    ['gradlew', '-D', 'org.gradle.java.home=C:\\jdk17'],
    // ...and -P is judged by its key, the --location precedent.
    ['gradlew', '-Porg.gradle.java.home=C:\\jdk17'],
    ['gradlew', '-P', 'org.gradle.java.home=C:\\jdk17'],
    ['gradlew', '--project-prop', 'org.gradle.java.home=C:\\jdk17'],
    ['gradlew', '--project-prop=org.gradle.java.home=C:\\jdk17'],
    ['gradlew', '-Porg.gradle.daemon=true', ':app:help'],
    ['gradlew', '--daemon'],
    ['gradlew', '-t', ':app:help'],
    ['gradlew', '--continuous'],
    ['gradlew', '--stop'],
    ['gradlew', '--status'],
    // The guarded -p: the literal-path rules, same as git restore pathspecs.
    ['gradlew', '-p', '..'],
    ['gradlew', '-p', '../elsewhere'],
    ['gradlew', '-p..'],
    ['gradlew', '-p', 'C:\\abs'],
    ['gradlew', '-p', '.'],
    ['gradlew', '-p', 'a*b'],
    ['gradlew', '--project-dir=..'],
    ['gradlew', '--project-dir', '/rooted'],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses everything else', () => {
    for (const argv of REFUSED) {
      refusal(() => validate([...argv]))
    }
  })

  it('normalises --no-daemon into every argv, exactly once', () => {
    // The job JSON must read the argv that runs: the Run shorthand rule.
    const cases: ReadonlyArray<readonly [string[], string[]]> = [
      [['gradlew', ':app:help'], ['gradlew', '--no-daemon', ':app:help']],
      [['gradlew', ':app:assembleDebug', '-PreactNativeArchitectures=x86_64'],
        ['gradlew', '--no-daemon', ':app:assembleDebug', '-PreactNativeArchitectures=x86_64']],
      // A caller's own flag is not duplicated.
      [['gradlew', '--no-daemon', ':app:help'], ['gradlew', '--no-daemon', ':app:help']],
      // After `--` it is a task argument, so the bridge injects its own.
      [['gradlew', ':app:help', '--', '--no-daemon'],
        ['gradlew', '--no-daemon', ':app:help', '--', '--no-daemon']],
    ]
    for (const [argv, want] of cases) {
      const normalised = [...argv]
      validate(normalised)
      expect(normalised, `argv=${JSON.stringify(argv)}`).toEqual(want)
    }
  })

  it('says why each blocked flag is refused', () => {
    // The reasons live beside the table; a refusal without its why is a
    // message the caller cannot act on.
    const message = refusal(() => validate(['gradlew', '-I', 'x.gradle']))
    expect(message).toContain('arbitrary script')
  })

  it('refuses every flag in the table from the gradlew surface itself', () => {
    // Table-driven on purpose: a flag added to the set with no reason of its
    // own fails here, and no case can pass by taking the generic
    // "command not allowed" path instead of the gradle guard.
    const flags = [...GRADLE_BLOCKED_FLAGS].sort()
    expect(flags.length).toBeGreaterThan(0)
    for (const flag of flags) {
      const message = refusal(() => validate(['gradlew', flag]))
      expect(message, `flag=${flag}`).toContain('gradlew flag not allowed')
      expect(message, `flag=${flag}`).not.toContain('not on the gradlew surface')
    }
  })

  it('judges -P by its key, like npm --location by its value', () => {
    const message = refusal(() => validate(['gradlew', '-Porg.gradle.java.home=C:\\jdk17']))
    expect(message).toContain('org.gradle')
    expect(message).toContain('gradle.properties')
  })

  it('keeps the daemon-management flags out with their reason', () => {
    for (const flag of ['--stop', '--status']) {
      const message = refusal(() => validate(['gradlew', flag]))
      expect(message, `flag=${flag}`).toContain('daemons')
    }
  })

  it('guards -p with the literal-path rules', () => {
    const message = refusal(() => validate(['gradlew', '-p', '..', ':app:help']))
    expect(message).toContain('the gradlew project directory')
    expect(message).toContain('..')
  })

  it('treats gradlew.bat and .\\gradlew as the same command', () => {
    const argv = ['gradlew.bat', ':app:help']
    validate(argv)
    expect(argv[1]).toBe('--no-daemon')
  })
})

describe('workspace selectors (WorkspaceSelectorTests)', () => {
  // A selector is not a retarget: the manager still launches in the pinned cwd,
  // so what is guarded is only the *directory* shapes that leave the tree. Both
  // flag positions are covered because both are accepted — and the post-verb one
  // used to pass unguarded, `--filter ../..` included.
  const ALLOWED: string[][] = [
    ['pnpm', '--filter', 'web', 'run', 'build'],
    ['pnpm', '-F', 'web', 'run', 'build'],
    ['pnpm', '--filter=@dsh/desktop', 'run', 'bundle'],
    ['pnpm', '-F@dsh/desktop', 'run', 'bundle'],
    ['pnpm', '--filter', '@dsh/*', 'run', 'test'],
    ['pnpm', '--filter', '...web', 'run', 'build'],
    ['pnpm', '--filter', '...@dsh/*', 'run', 'build'],
    ['pnpm', '--filter', '[origin/main]', 'run', 'test'],
    ['pnpm', '--filter', '.', 'run', 'build'],
    ['pnpm', '--filter', './packages/web', 'run', 'build'],
    ['pnpm', '--filter', '{packages}', 'run', 'build'],
    ['pnpm', 'run', '--filter', 'web', 'build'],
    ['pnpm', 'run', '--filter=web', 'build'],
    ['npm', '-w', 'app', 'run', 'build'],
    ['npm', '--workspace=app', 'run', 'build'],
    ['npm', 'run', 'build', '-w', 'app'],
    ['npm', 'exec', '-w', 'app', 'vitest', 'run'],
  ]

  const REFUSED: string[][] = [
    ['pnpm', '--filter', '../..', 'run', 'build'],
    ['pnpm', '--filter=../other', 'run', 'build'],
    ['pnpm', '--filter', 'D:\\elsewhere', 'run', 'build'],
    ['pnpm', '--filter', '/rooted', 'run', 'build'],
    ['pnpm', 'run', 'build', '--filter', '../..'],
    ['pnpm', 'run', 'build', '--filter=../other'],
    // The whole-workspace spelling: not a retarget, still refused.
    ['pnpm', '--filter', '!web', 'run', 'build'],
    // pnpm's -w/--workspace is --workspace-root, not a selector.
    ['pnpm', '-w', 'run', 'build'],
    ['pnpm', '--workspace', 'web', 'run', 'build'],
    // A selector with nothing after it names no member.
    ['pnpm', '--filter'],
    ['npm', '-w'],
  ]

  it('allows a selector on either side of the verb', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses a selector the tree does not contain', () => {
    for (const argv of REFUSED) {
      refusal(() => validate([...argv]))
    }
  })

  it('says which bound a selector broke', () => {
    const cases: ReadonlyArray<readonly [string[], string]> = [
      [['pnpm', '--filter', '../..', 'run', 'build'], 'must name a directory inside'],
      [['pnpm', '--filter', '/rooted', 'run', 'build'], 'must be relative'],
      [['pnpm', '--filter', '!web', 'run', 'build'], 'whole-workspace'],
      [['pnpm', '--filter'], 'needs a workspace selector value'],
      [['npm', '-w'], 'needs a workspace selector value'],
    ]
    for (const [argv, fragment] of cases) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain(fragment)
    }
  })

  it('still refuses pnpm\'s -w, which is a workspace root and not a selector', () => {
    const message = refusal(() => validate(['pnpm', 'run', 'build', '-w']))
    expect(message).toContain('pinned')
  })
})

describe('git write surface (GitWriteSurfaceTests)', () => {
  // The verbs added for a fork kept in step with upstream. What makes them a
  // surface rather than four new names is the third refusal reason:
  // **it would block**. A job has no terminal, so an interactive rebase or an
  // `--edit` cherry-pick waits for an editor that never answers, holding the
  // Queue lane — the failure the long lane exists to prevent.
  const ALLOWED: string[][] = [
    ['git', 'fetch'],
    ['git', 'fetch', 'upstream'],
    ['git', 'fetch', '--prune', 'origin'],
    ['git', 'fetch', '--all'],
    ['git', 'rebase', 'upstream/main'],
    ['git', 'rebase', '--onto', 'upstream/main', 'HEAD~3'],
    ['git', 'rebase', '--autostash', 'upstream/main'],
    ['git', 'rebase', '--continue'],
    ['git', 'rebase', '--abort'],
    ['git', 'rebase', '--skip'],
    ['git', 'cherry-pick', 'abc123'],
    ['git', 'cherry-pick', '-x', 'abc123'],
    ['git', 'cherry-pick', '-n', 'abc123'],
    ['git', 'cherry-pick', 'abc123..def456'],
    ['git', 'cherry-pick', '--abort'],
    ['git', 'push', 'origin', 'feature'],
    ['git', 'push', 'origin', 'HEAD:refs/heads/feature'],
    ['git', 'push', '-u', 'origin', 'feature'],
    ['git', 'push', '--dry-run', 'origin', 'feature'],
    ['git', 'push', 'origin', 'feature', 'other'],
    ['git', 'push', 'https://github.com/cup113/dsh-tool-bridge.git', 'feature'],
    ['git', 'push', 'git@github.com:cup113/dsh-tool-bridge.git', 'feature'],
    ['git', 'push', '--', 'origin', 'feature'],
  ]

  // argv -> the fragment its refusal must contain.
  const REFUSED: ReadonlyArray<readonly [string[], string]> = [
    [['git', 'push'], 'needs a remote and a destination ref'],
    [['git', 'push', 'origin'], 'needs a destination ref'],
    [['git', 'push', 'origin', '+feature'], 'must not force'],
    [['git', 'push', 'origin', ':feature'], 'not delete'],
    [['git', 'push', 'origin', 'refs/heads/*:refs/heads/*'], 'not a pattern'],
    [['git', 'push', '--force', 'origin', 'feature'], 'force push rewrites'],
    [['git', 'push', '-f', 'origin', 'feature'], 'force push rewrites'],
    [['git', 'push', '--force-with-lease', 'origin', 'feature'], 'force push rewrites'],
    [['git', 'push', '--delete', 'origin', 'feature'], 'deletes a remote ref'],
    [['git', 'push', '--mirror', 'origin'], 'every ref the repository has'],
    [['git', 'push', '--all', 'origin'], 'every local branch'],
    [['git', 'push', '--tags', 'origin'], 'every tag'],
    [['git', 'push', '--prune', 'origin'], 'remote-tracking refs'],
    [['git', 'push', '--repo', 'elsewhere', 'origin', 'feature'], 'other than the named remote'],
    [['git', 'push', 'origin', 'feature', '--push-option=ci.skip'], 'flag not allowed'],
    // A path remote writes into a repository the pinned cwd does not contain.
    [['git', 'push', '../elsewhere', 'feature'], 'not a local path'],
    [['git', 'push', 'file:///D:/elsewhere', 'feature'], 'not a local path'],
    // It would block: no terminal, so an editor never answers.
    [['git', 'rebase', '-i', 'upstream/main'], 'no terminal'],
    [['git', 'rebase', '--interactive', 'upstream/main'], 'no terminal'],
    [['git', 'rebase', '--autosquash', 'upstream/main'], 'implies --interactive'],
    [['git', 'rebase', '--edit-todo'], 'no terminal'],
    [['git', 'cherry-pick', '-e', 'abc123'], 'no terminal'],
    [['git', 'cherry-pick', '--edit=abc123'], 'no terminal'],
    // It runs something.
    [['git', 'rebase', '-x', 'make test'], 'arbitrary command'],
    [['git', 'rebase', '--exec=make test'], 'arbitrary command'],
    [['git', 'fetch', '--upload-pack=sh'], 'arbitrary program'],
    // It writes a ref the caller did not name.
    [['git', 'rebase', '--update-refs', 'upstream/main'], 'refs the caller never named'],
    [['git', 'fetch', '--force'], 'local ones'],
    [['git', 'fetch', '--tags'], 'every remote tag'],
    [['git', 'fetch', '--recurse-submodules'], 'submodules the caller never named'],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses the forms that would publish, rewrite or block', () => {
    for (const [argv, fragment] of REFUSED) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain(fragment)
    }
  })

  it('names the verbs it now accepts, so the refusal is self-correcting', () => {
    const message = refusal(() => validate(['git', 'push', '--force', 'origin', 'feature']))
    for (const verb of ['fetch', 'rebase', 'cherry-pick', 'push']) {
      // Only the unknown-verb refusal lists the surface; this one must still
      // say which flag and why, not list everything.
      expect(message).toContain('git push flag not allowed')
    }
  })

  it('refuses every flag in the reason tables with its own reason', () => {
    // Table-driven, the gradlew pattern: a flag added to a reason table cannot
    // slip through the guard, and a flag refused *without* a reason is visible
    // here rather than reading as the generic "not allowed".
    for (const [verb, reasons] of Object.entries(GIT_FLAG_REASONS)) {
      const flags = Object.keys(reasons).sort()
      expect(flags.length, verb).toBeGreaterThan(0)
      for (const flag of flags) {
        const message = refusal(() => validate(['git', verb, flag]))
        expect(message, `${verb} ${flag}`).toContain(`${verb} flag not allowed`)
        expect(message, `${verb} ${flag}`).toContain('—')
      }
    }
  })

  it('still refuses the verbs that stay out', () => {
    for (const verb of ['reset', 'clean', 'checkout', 'switch', 'stash', 'merge', 'pull']) {
      refusal(() => validate(['git', verb, '--', 'lib/a.dart']))
    }
  })

  it('does not let a push hide behind the -- separator', () => {
    // After `--` a token is a refspec, so a `:ref` there is still a deletion.
    refusal(() => validate(['git', 'push', 'origin', '--', ':feature']))
  })

  it('keeps git config injection out of every verb, push included', () => {
    // A config flag is an argv *before* the verb, and the verb may not be one.
    for (const verb of ['push', 'fetch', 'rebase']) {
      refusal(() => validate(['git', '-c', 'core.sshCommand=sh', verb]))
    }
  })
})

/**
 * The cargo surface (ADR-0015).
 *
 * Three properties carry it, and each is asserted below rather than described:
 * the verb list is an **allow** list (cargo dispatches an unknown name to
 * `cargo-<name>.exe` on PATH, so "any subcommand" is general execution), the
 * anchors are refused or guarded (`--target-dir`, `--config`, `-Z`, the
 * whole-workspace spellings, `+toolchain`, and a `--manifest-path` that has to
 * stay inside the pinned working directory), and `-p`/`--package` is a
 * **Workspace selector** rather than a retarget.
 */
describe('cargo surface (CargoSurfaceTests)', () => {
  const ALLOWED: string[][] = [
    ['cargo', 'build'],
    ['cargo', 'build', '--release'],
    ['cargo', 'build', '--offline'],
    ['cargo', 'build', '--features', 'serde'],
    ['cargo', 'check', '--all-features'],
    ['cargo', 'test'],
    ['cargo', 'test', '--locked'],
    ['cargo', 'test', '--', '--test-threads=1'],
    ['cargo', 'test', '--', '--exact', 'tests::it_works'],
    ['cargo', 'test', '-p', 'probe'],
    ['cargo', 'test', '--package=probe'],
    ['cargo', 'bench', '--no-run'],
    ['cargo', 'doc', '--no-deps'],
    ['cargo', 'fix', '--allow-dirty'],
    // The toolchain's own formatter and linter are external subcommands shipped
    // with it; they are on the list by name.
    ['cargo', 'clippy'],
    ['cargo', 'clippy', '--', '-D', 'warnings'],
    ['cargo', 'fmt'],
    ['cargo', 'fmt', '--check'],
    ['cargo', 'run', '--bin', 'probe', '--', '--help'],
    // After `--` the tokens are the program's, so a would-be blocked flag there
    // is nobody's surface but the program's.
    ['cargo', 'run', '--', '--target-dir', 'out'],
    ['cargo', 'clean'],
    // Resolving a crate is the reason cargo is here at all.
    ['cargo', 'fetch'],
    ['cargo', 'update', '--offline'],
    ['cargo', 'add', 'itoa@1'],
    ['cargo', 'remove', 'itoa'],
    ['cargo', 'rm', 'itoa'],
    ['cargo', 'tree'],
    ['cargo', 'metadata', '--format-version', '1'],
    ['cargo', 'generate-lockfile'],
    // A guarded anchor: relative and inside the pinned cwd, like `gradlew -p`.
    ['cargo', 'build', '--manifest-path', 'crates/foo/Cargo.toml'],
    ['cargo', 'build', '--manifest-path=Cargo.toml'],
    ['cargo.exe', 'test'],
  ]

  // argv -> the fragment its refusal must contain.
  const REFUSED: ReadonlyArray<readonly [string[], string]> = [
    [['cargo'], 'needs a verb'],
    // Verb-first, the package managers' rule: cargo accepts its global flags
    // after the verb too, so nothing is lost by refusing the other order.
    [['cargo', '--offline', 'build'], 'needs a verb before flags'],
    [['cargo', '+nightly', 'test'], 'machine configuration'],
    // Machine state outside the project.
    [['cargo', 'install', 'cargo-nextest'], 'cargo bin directory'],
    [['cargo', 'uninstall', 'probe'], 'cargo bin directory'],
    [['cargo', 'publish'], 'cannot be withdrawn'],
    [['cargo', 'yank', 'probe@0.1.0'], 'resolves from crates.io'],
    [['cargo', 'owner', '--list', 'probe'], 'remote state'],
    [['cargo', 'login'], 'token'],
    // Scaffolding that may name a path outside the pinned cwd.
    [['cargo', 'new', 'probe2'], 'scaffolds a project'],
    [['cargo', 'init'], 'scaffolds a project'],
    [['cargo', 'vendor'], 'vendor tree'],
    [['cargo', 'package'], 'distributable archive'],
    // The compiler reached around cargo.
    [['cargo', 'rustc', '--', '-Zunstable-options'], 'compiler with arbitrary extra flags'],
    [['cargo', 'rustdoc', '--', '--cfg', 'foo'], 'documentation compiler'],
    // The dispatcher: not on the list, so cargo would run it from PATH.
    [['cargo', 'nextest', 'run'], 'cargo-<name>.exe'],
    [['cargo', 'binstall', 'probe'], 'cargo-<name>.exe'],
    // Anchor redirection.
    [['cargo', 'build', '--target-dir', 'out'], 'outside the pinned working directory'],
    [['cargo', 'build', '--target-dir=out'], 'outside the pinned working directory'],
    [['cargo', 'build', '--config', 'build.rustc-wrapper=evil'], 'build.rustc-wrapper'],
    [['cargo', 'build', '--config=build.rustc-wrapper=evil'], 'build.rustc-wrapper'],
    [['cargo', 'build', '-Zbuild-std'], 'unstable-behaviour'],
    [['cargo', 'test', '-Z', 'script'], 'unstable-behaviour'],
    // Whole-workspace spellings.
    [['cargo', 'build', '--workspace'], 'every workspace member'],
    [['cargo', 'test', '--all'], 'older spelling of --workspace'],
    [['cargo', 'build', '--exclude', 'probe'], 'every member except the one named'],
    // The guarded manifest path, held to the literal-path rules.
    [['cargo', 'build', '--manifest-path', '../other/Cargo.toml'], 'the cargo manifest path'],
    [['cargo', 'build', '--manifest-path', '..\\other\\Cargo.toml'], 'the cargo manifest path'],
    [['cargo', 'build', '--manifest-path', 'C:/other/Cargo.toml'], 'the cargo manifest path'],
    [['cargo', 'build', '--manifest-path', 'crates/*/Cargo.toml'], 'the cargo manifest path'],
    // The selector, guarded rather than refused.
    [['cargo', 'test', '-p'], 'needs a workspace selector value'],
    [['cargo', 'test', '-p', '..'], 'the cargo workspace selector'],
    [['cargo', 'test', '--package', 'C:\\other'], 'the cargo workspace selector'],
  ]

  it('allows the documented forms', () => {
    for (const argv of ALLOWED) {
      validate([...argv])
    }
  })

  it('refuses the forms that reach outside the project or the toolchain', () => {
    for (const [argv, fragment] of REFUSED) {
      const message = refusal(() => validate([...argv]))
      expect(message, `argv=${JSON.stringify(argv)}`).toContain(fragment)
    }
  })

  it('names the dispatcher, so an unlisted verb is self-correcting', () => {
    const message = refusal(() => validate(['cargo', 'nextest', 'run']))
    expect(message).toContain('cargo-<name>.exe')
    expect(message).toContain('PATH')
    // And the surface it does accept, so the caller can pick a verb from it.
    expect(message).toContain("'build'")
    expect(message).toContain("'fetch'")
    expect(message).toContain("'test'")
  })

  it('says which form to use when the verb follows the flags', () => {
    const message = refusal(() => validate(['cargo', '--offline', 'build']))
    expect(message).toContain("'cargo build --offline'")
  })

  it('refuses every verb in the reason table, with its own reason', () => {
    // Table-driven, the gradlew pattern: a verb added to the reason table cannot
    // slip through the guard, and a refusal written without a reason is visible
    // here rather than reading as the generic "not allowed".
    const verbs = Object.keys(CARGO_VERB_REASONS).sort()
    expect(verbs.length).toBeGreaterThan(0)
    for (const verb of verbs) {
      const message = refusal(() => validate(['cargo', verb]))
      expect(message, verb).toContain('cargo verb not allowed')
      expect(message, verb).toContain(CARGO_VERB_REASONS[verb] as string)
    }
  })

  it('refuses every flag in the reason table, with its own reason', () => {
    const flags = Object.keys(CARGO_FLAG_REASONS).sort()
    expect(flags.length).toBeGreaterThan(0)
    for (const flag of flags) {
      const message = refusal(() => validate(['cargo', 'build', flag]))
      expect(message, flag).toContain(`cargo flag not allowed: '${flag}'`)
      expect(message, flag).toContain(CARGO_FLAG_REASONS[flag] as string)
    }
  })

  it('does not let the allow list be bypassed by a path or a suffix', () => {
    // `commandName` is what the tables are read through, so every spelling of
    // the same command has to meet the same guard.
    refusal(() => validate(['cargo', 'install', 'x']))
    refusal(() => validate(['C:\\Users\\me\\.cargo\\bin\\cargo.exe', 'install', 'x']))
    refusal(() => validate(['cargo.EXE', 'publish']))
  })

  it('rewrites nothing: a cargo argv is what runs', () => {
    // No shorthand, no forced flag — unlike `npm test` and `gradlew`, cargo has
    // no normalisation, so the job JSON and the lane guess read the caller's own
    // argv.
    const argv = ['cargo', 'test', '-p', 'probe']
    validate(argv)
    expect(argv).toEqual(['cargo', 'test', '-p', 'probe'])
  })

  it('keeps every listed verb acceptable, so the list is not decoration', () => {
    // The non-vacuity half of the allow list: every member really is accepted,
    // which is what makes the refusals above about policy rather than about a
    // guard that refuses everything.
    for (const verb of [...CARGO_VERBS].sort()) {
      validate(['cargo', verb])
    }
  })
})
