/**
 * The package a *git* install receives.
 *
 * The profile installs this plugin as `github:ds-hu/dsh-tool-bridge`, and a git
 * dependency ships the repository's **tracked** files — `files` in package.json
 * is applied to that checkout, but nothing in it is built. So the entry points
 * have to be committed: a build that is not staged ships a package whose `main`
 * does not exist, and the Loader answers
 * `1 entry did not activate toolbridge (@cup113/dsh-plugin-toolbridge): failed
 * to import` — measured as `ERR_MODULE_NOT_FOUND … \lib\index.js` against the
 * installed copy, after `.gitignore` still carried `lib/`.
 *
 * Two claims, because either one missing fails the same way:
 *
 * - the file **exists** (a build has run), and
 * - git **tracks** it (it reaches the tarball a git install unpacks).
 *
 * The second is the load-bearing one: `lib/` was ignored from the commit that
 * made this a plugin, so the first git install was the first broken one.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

interface Manifest {
  readonly main?: string
  readonly exports?: Readonly<Record<string, { readonly default?: string } | string>>
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest
const clientEntry = manifest.exports?.['./client']
const CLIENT = typeof clientEntry === 'string' ? clientEntry : clientEntry?.default
const ENTRIES = [manifest.main, CLIENT].filter((entry): entry is string => typeof entry === 'string')

/**
 * Whether git tracks `rel`, or null when git cannot be asked.
 *
 * `null` covers the three legitimate "no answer" cases: git absent, the checkout
 * is a tarball with no `.git`, and a sandboxed spawn (`EPERM` on piped stdio —
 * this suite runs under the bridge for that reason, and CI runs it unconfined).
 */
function tracked(rel: string): boolean | null {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', rel], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) {
    return null
  }
  if (result.status === 0) {
    return true
  }
  if (result.status === 1) {
    return false
  }
  return null
}

describe('the package a git install receives', () => {
  it('names two entry points in its manifest', () => {
    // A guard on the guard: an empty list would make both cases below vacuous.
    expect(ENTRIES, 'package.json must name a main and a ./client entry').toHaveLength(2)
  })

  it('builds the entry points its manifest names', () => {
    for (const rel of ENTRIES) {
      expect(existsSync(join(ROOT, rel)), `${rel} is missing — run \`pnpm build\``).toBe(true)
    }
  })

  it('tracks them, because a git install ships only tracked files', () => {
    for (const rel of ENTRIES) {
      const state = tracked(rel)
      if (state === null) {
        console.warn(`package spec skipped for ${rel}: git cannot answer in this environment`)
        continue
      }
      expect(state, `${rel} is not tracked — stage lib/ with the source change`).toBe(true)
    }
  })
})
