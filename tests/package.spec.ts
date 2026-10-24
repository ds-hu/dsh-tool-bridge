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
 *
 * A third claim lives beside them, about the same package: the peers this
 * manifest demands are **ranges** on the harness line. They were exact versions
 * (`0.2.0-rc.2`), which made every other build of that line fail the peer check
 * against a plugin that had not changed — and the dev tree is what keeps the
 * range honest, so every peer must also be a `devDependency`.
 *
 * The fourth is the plugin list's: the icon the manager renders is inlined from
 * `package.json.icon`, so the manifest has to point at a file the package
 * actually ships, in a format app-boot admits. These are app-boot's own rules
 * (`iconOf`), copied rather than approximated: relative path inside the package,
 * SVG/PNG/JPEG/WebP, at most 256 KiB.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The media types app-boot admits for a plugin icon, by file extension. */
const ICON_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp'])
/** `MAX_ICON_BYTES` in app-boot's `package-meta`: 256 KiB. */
const MAX_ICON_BYTES = 256 * 1024

interface Manifest {
  readonly main?: string
  readonly exports?: Readonly<Record<string, { readonly default?: string } | string>>
  readonly icon?: string
  readonly files?: readonly string[]
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
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

  it('requires its peers as ranges, not one pinned harness build', () => {
    const peers = manifest.peerDependencies ?? {}
    const dev = manifest.devDependencies ?? {}
    const names = Object.keys(peers)
    // Guard on the guard: an empty peer list would make both assertions below run
    // zero times and pass.
    expect(names.length, 'package.json must declare peerDependencies').toBeGreaterThan(0)
    for (const name of names) {
      expect(
        peers[name],
        `${name} is pinned to one exact build — a profile on any other build of the harness line then fails the peer check against a plugin that has not changed`,
      ).toMatch(/^\^/u)
      expect(
        dev[name],
        `${name} is a peer but not a devDependency — the dev tree would not contain the copy the types and the suite are read against`,
      ).toBeDefined()
    }
  })

  it('declares an icon the plugin list can inline, and ships it', () => {
    const icon = manifest.icon ?? ''
    // Guard on the guard: with no icon every assertion below is vacuous.
    expect(icon, 'package.json must declare an icon').not.toBe('')
    expect(
      isAbsolute(icon) || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon),
      `${icon} must be a relative file path — app-boot refuses an absolute path or a URL`,
    ).toBe(false)
    expect(
      relative(ROOT, resolve(ROOT, icon)),
      `${icon} must stay inside the package directory, which is what a git install receives`,
    ).not.toMatch(/^\.\.(?:[\\/]|$)/u)
    expect(
      ICON_EXTENSIONS.has(extname(icon).toLowerCase()),
      `${icon} must be SVG, PNG, JPEG or WebP`,
    ).toBe(true)
    const file = join(ROOT, icon)
    expect(
      existsSync(file),
      `${icon} is missing — the plugin list would carry a metadata error instead of the icon`,
    ).toBe(true)
    const { size } = statSync(file)
    expect(
      size,
      `${icon} is ${size} bytes; app-boot refuses an icon over ${MAX_ICON_BYTES}`,
    ).toBeLessThanOrEqual(MAX_ICON_BYTES)
    const files = manifest.files ?? []
    expect(
      files.some((entry) => entry === icon || entry === icon.replace(/^\.\//u, '')),
      `${icon} is not named in package.json#files, so the pack a git install unpacks leaves it out`,
    ).toBe(true)
  })
})
