import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // The DSH file sandbox denies the named pipes libuv needs for a forked
    // child's stdio, so the `forks` pool dies with `spawn EPERM` there while
    // `threads` (worker_threads, no named pipes) runs confined and unconfined
    // alike. The suite must be runnable in the environment it describes.
    pool: 'threads',
    // Spawning a child process is expensive on an ACL-heavy Windows workspace,
    // and several cases here start real ones (`git`, `cargo`) or wait for one to
    // settle: measured, `scope.spec`'s real-repository case takes 5.8 s alone on
    // an idle machine and 17.5 s under load, and `bridge-output.spec`'s job cases
    // range from 2 s to 5 s. The 5 s default turned that into timeouts that read
    // as failures of the code under test, so the budget is stated once here
    // instead of per case; a genuine hang still fails, just later.
    testTimeout: 30_000,
  },
})
