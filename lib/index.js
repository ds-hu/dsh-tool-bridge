// src/host/index.ts
import { mkdirSync as mkdirSync4 } from "node:fs";
import { homedir } from "node:os";
import { join as join6 } from "node:path";

// src/host/api.ts
var API_PREFIX = "/toolbridge/api";
function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("body must be a JSON object");
  }
  return parsed;
}
function registerApi(ctx, engine, switches, config) {
  return ctx.webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = url.pathname.slice(API_PREFIX.length);
      try {
        if (route === "/state" && req.method === "GET") {
          const sessionId = url.searchParams.get("sessionId") ?? "";
          if (sessionId === "") {
            send(res, 400, {
              error: {
                code: "bad-request",
                message: "sessionId is required: a panel answers for one conversation"
              }
            });
            return;
          }
          const state = await switches.state(sessionId);
          send(res, 200, {
            ...state,
            jobs: engine.listForOwner(sessionId),
            config: {
              dartFormatExe: config.dartFormatExe === "" ? null : config.dartFormatExe,
              defaultTimeoutSec: config.defaultTimeoutSec,
              playwright: {
                browser: config.playwright.browser,
                caps: config.playwright.caps,
                outputDir: config.playwright.outputDir === "" ? null : config.playwright.outputDir
              }
            }
          });
          return;
        }
        if (route === "/toggle" && req.method === "POST") {
          const body = await readJson(req);
          const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
          const key = body.key === "bridge" || body.key === "browser" ? body.key : null;
          if (sessionId === "" || key === null || typeof body.value !== "boolean") {
            send(res, 400, { error: { code: "bad-request", message: "sessionId, key (bridge|browser) and value are required" } });
            return;
          }
          const toggles = await switches.set(sessionId, key, body.value);
          send(res, 200, { sessionId, toggles });
          return;
        }
        if (route === "/job" && req.method === "GET") {
          const id = url.searchParams.get("id") ?? "";
          const grep = url.searchParams.get("grep");
          const tailRaw = url.searchParams.get("tail");
          const view = engine.read(id, grep, tailRaw === null ? void 0 : Number(tailRaw));
          if (view === void 0) {
            send(res, 404, { error: { code: "unknown-job", message: `unknown job: ${id}` } });
            return;
          }
          send(res, 200, view);
          return;
        }
        send(res, 404, { error: { code: "not-found", message: `no route: ${route}` } });
      } catch (error) {
        send(res, 500, {
          error: { code: "route-failed", message: error instanceof Error ? error.message : String(error) }
        });
      }
    }
  });
}

// src/host/bridge.ts
import { randomUUID } from "node:crypto";
import { mkdirSync as mkdirSync2 } from "node:fs";
import { join as join3 } from "node:path";

// src/engine/baseline.ts
import { readFileSync, statSync } from "node:fs";

// src/engine/errors.ts
var RefusalError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "RefusalError";
    this.code = code;
  }
};
function refuse(code, message) {
  throw new RefusalError(code, message);
}
var ToolFailure = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ToolFailure";
  }
};

// src/engine/surface.ts
var SCRIPT_BINARIES = /* @__PURE__ */ new Set(["vite", "vitest", "svelte-check", "svelte-kit", "tsc"]);
var ALLOWED_EXES = /* @__PURE__ */ new Set([
  "flutter",
  "dart",
  "git",
  "npm",
  "npx",
  "pnpm",
  "gradlew",
  "cargo",
  ...SCRIPT_BINARIES
]);
var PACKAGE_MANAGERS = /* @__PURE__ */ new Set(["npm", "pnpm"]);
var PACKAGE_MANAGER_RUNNERS = /* @__PURE__ */ new Set([...PACKAGE_MANAGERS, "npx"]);
var PACKAGE_MANAGER_ENTRIES = {
  npm: [
    ["node_modules", "npm", "bin", "npm-cli.js"],
    ["node_modules", "npm", "bin", "npm-cli.cjs"]
  ],
  npx: [
    ["node_modules", "npm", "bin", "npx-cli.js"],
    ["node_modules", "npm", "bin", "npx-cli.cjs"]
  ],
  pnpm: [
    ["node_modules", "pnpm", "bin", "pnpm.mjs"],
    ["node_modules", "pnpm", "bin", "pnpm.cjs"]
  ]
};
var NODE_INSTALL_ENTRIES = [
  ["node_modules", "npm", "bin", "npm-cli.js"],
  ["node_modules", "npm", "bin", "npm-cli.cjs"]
];
var PNPM_VERBS = /* @__PURE__ */ new Set([
  "install",
  "i",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "rebuild",
  "dedupe",
  "run",
  "run-script",
  "exec",
  "why",
  "list",
  "ls",
  "outdated",
  "audit",
  "licenses"
]);
var NPM_VERBS = /* @__PURE__ */ new Set([
  "install",
  "i",
  "ci",
  "add",
  "remove",
  "rm",
  "uninstall",
  "update",
  "up",
  "upgrade",
  "rebuild",
  "dedupe",
  "run",
  "run-script",
  "exec",
  "why",
  "explain",
  "list",
  "ls",
  "outdated",
  "audit",
  "licenses"
]);
var NPM_RUN_SHORTHANDS = /* @__PURE__ */ new Set(["test", "start"]);
var PACKAGE_MANAGER_VERBS = {
  npm: NPM_VERBS,
  pnpm: PNPM_VERBS
};
var PACKAGE_MANAGER_RETARGET_FLAGS = [
  "-C",
  "--dir",
  "--prefix",
  "--workspace-root",
  "-g",
  "--global"
];
var PACKAGE_MANAGER_BLOCKED_FLAGS = {
  pnpm: /* @__PURE__ */ new Set([...PACKAGE_MANAGER_RETARGET_FLAGS, "-w", "--workspace"]),
  npm: /* @__PURE__ */ new Set([...PACKAGE_MANAGER_RETARGET_FLAGS, "--workspaces", "-ws", "--include-workspace-root"])
};
var PACKAGE_MANAGER_WHOLE_WORKSPACE_FLAGS = /* @__PURE__ */ new Set([
  "--workspaces",
  "-ws",
  "--include-workspace-root",
  "--workspace-root",
  "--workspace"
]);
var PACKAGE_MANAGER_SELECTOR_FLAGS = {
  npm: /* @__PURE__ */ new Set(["-w", "--workspace"]),
  pnpm: /* @__PURE__ */ new Set(["--filter", "-F"]),
  // cargo's `-p`/`--package` picks one member of a workspace, which is the same
  // concept the other two spell their own way. Its `-F` is *not* one: that is
  // `--features`, so the second manager's `-F` and cargo's `-F` are two flags —
  // the `-w` collision in `PACKAGE_MANAGER_BLOCKED_FLAGS` one toolchain over.
  cargo: /* @__PURE__ */ new Set(["-p", "--package"])
};
var MANAGER_VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--filter",
  "-F",
  "-w",
  "--workspace",
  "--location"
]);
var PACKAGE_MANAGER_LOCATION_FLAG = "--location";
var PACKAGE_MANAGER_GLOBAL_LOCATIONS = /* @__PURE__ */ new Set(["global", "user"]);
var EXEC_BLOCKED_FLAGS = /* @__PURE__ */ new Set(["-c", "--shell-mode", "-p", "--package"]);
var GRADLE_FLAG_REASONS = {
  "-g": "it moves Gradle's user home \u2014 machine-level caches and the daemon registry \u2014 off the default the developer's own builds share",
  "--gradle-user-home": "it moves Gradle's user home \u2014 machine-level caches and the daemon registry \u2014 off the default the developer's own builds share",
  "--project-cache-dir": "it puts the project cache outside the pinned working directory",
  "-I": "it runs an arbitrary script before the build \u2014 general execution behind an allowlisted name, the reason `pnpm exec` is narrowed",
  "--init-script": "it runs an arbitrary script before the build \u2014 general execution behind an allowlisted name, the reason `pnpm exec` is narrowed",
  "-c": "it points the build at a settings file other than the project's own",
  "--settings-file": "it points the build at a settings file other than the project's own",
  "-b": "it points the build at a build file other than the project's own",
  "--build-file": "it points the build at a build file other than the project's own",
  "-D": "system properties reach org.gradle.java.home and friends \u2014 machine-level redirection; the project's gradle.properties is the supported home for those",
  "--daemon": "every gradlew argv is normalised to --no-daemon so a settled job leaves nothing behind",
  "-t": "it is a watcher that never terminates; a build is a queue job",
  "--continuous": "it is a watcher that never terminates; a build is a queue job",
  "--stop": "it manages the machine's shared Gradle daemons \u2014 state this surface never creates, so it does not manage it either",
  "--status": "it manages the machine's shared Gradle daemons \u2014 state this surface never creates, so it does not manage it either"
};
var GRADLE_BLOCKED_FLAGS = new Set(Object.keys(GRADLE_FLAG_REASONS));
var GRADLE_PROPERTY_FLAGS = /* @__PURE__ */ new Set(["-P", "--project-prop"]);
var GRADLE_RESERVED_PROPERTY_PREFIX = "org.gradle.";
var GRADLE_PROJECT_DIR_FLAGS = /* @__PURE__ */ new Set(["-p", "--project-dir"]);
var CARGO_VERBS = /* @__PURE__ */ new Set([
  "add",
  "bench",
  "build",
  "check",
  "clean",
  "clippy",
  "doc",
  "fetch",
  "fix",
  "fmt",
  "generate-lockfile",
  "metadata",
  "remove",
  "rm",
  "run",
  "test",
  "tree",
  "update"
]);
var CARGO_VERB_REASONS = {
  install: "it installs into the machine's cargo bin directory (%USERPROFILE%\\.cargo\\bin) \u2014 shared state outside the pinned project, and the same directory rustup's own shims live in",
  uninstall: "it removes a binary from the machine's cargo bin directory \u2014 shared state outside the pinned project",
  publish: "it uploads to crates.io, and a published version cannot be withdrawn",
  yank: "it changes what every other project resolves from crates.io",
  owner: "it changes who may publish a crate \u2014 remote state this surface cannot show or undo",
  login: "it stores a crates.io token on this machine, and the bridge holds no credential store",
  logout: "it removes the machine-wide crates.io token the developer's own cargo uses",
  new: "it scaffolds a project, and its path argument may point outside the pinned working directory \u2014 a file the sandbox owns, not this surface",
  init: "it scaffolds a project in a directory it did not have to stay inside",
  vendor: "it writes a vendor tree and rewrites the project's .cargo/config.toml to match",
  package: "it builds a distributable archive \u2014 a release step, not a build",
  rustc: "it is the compiler with arbitrary extra flags passed after `--` \u2014 the machine-level redirection `-D` is refused for on the gradlew surface, and this is the same shape one toolchain over",
  rustdoc: "it is the documentation compiler with arbitrary extra flags passed after `--` \u2014 the same redirection `rustc` is refused for"
};
var CARGO_FLAG_REASONS = {
  "--target-dir": "it puts the build output outside the pinned working directory; a project that wants another target directory has build.target-dir in its own .cargo/config.toml",
  "--config": "it injects arbitrary Cargo configuration, and build.rustc-wrapper / target.*.runner in that configuration run a program of the caller's choosing \u2014 the narrowing gradlew -I/--init-script gets",
  "-Z": "it is the unstable-behaviour switch (build-std, script, config-include) \u2014 configuration this surface does not accept as an argv flag",
  "--workspace": "it widens one invocation to every workspace member \u2014 the whole-workspace spelling the package managers refuse",
  "--all": "it is the older spelling of --workspace \u2014 one invocation writing into every member",
  "--exclude": "it means every member except the one named, the same reason a ! selector is refused; with --workspace refused it has no other use"
};
var CARGO_BLOCKED_FLAGS = new Set(Object.keys(CARGO_FLAG_REASONS));
var CARGO_MANIFEST_FLAGS = /* @__PURE__ */ new Set(["--manifest-path"]);
var CARGO_TOOLCHAIN_PREFIX = "+";
var LANE_QUEUE = "queue";
var LANE_LONG = "long";
var LONG_SCRIPTS = /* @__PURE__ */ new Set(["dev", "start", "serve", "watch", "storybook"]);
var GIT_VERBS = /* @__PURE__ */ new Set([
  "status",
  "diff",
  "log",
  "add",
  "commit",
  "branch",
  "restore",
  "fetch",
  "rebase",
  "cherry-pick",
  "push"
]);
var GIT_FLAG_REASONS = {
  fetch: {
    "-f": "fetch already forces remote-tracking refs; the flag only adds local ones \u2014 a tag or a branch it overwrites, which the fetch did not originate",
    "--force": "fetch already forces remote-tracking refs; the flag only adds local ones \u2014 a tag or a branch it overwrites, which the fetch did not originate",
    "-t": "it writes every remote tag into the clone \u2014 refs the caller never named",
    "--tags": "it writes every remote tag into the clone \u2014 refs the caller never named",
    "--upload-pack": "it runs an arbitrary program on the other side of the connection \u2014 general execution behind an allowlisted verb",
    "--receive-pack": "it runs an arbitrary program on the other side of the connection \u2014 general execution behind an allowlisted verb",
    "--recurse-submodules": "it writes inside submodules the caller never named"
  },
  rebase: {
    "-i": "it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it",
    "--interactive": "it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it",
    "--autosquash": "it implies --interactive, so it would block waiting for an editor a job has no terminal for",
    "--edit-todo": "it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it",
    "-x": "it runs an arbitrary command after every commit \u2014 general execution behind an allowlisted verb",
    "--exec": "it runs an arbitrary command after every commit \u2014 general execution behind an allowlisted verb",
    "--update-refs": "it moves the branch refs of the commits it rewrites, not only the branch it is on \u2014 refs the caller never named"
  },
  "cherry-pick": {
    "-e": "it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it",
    "--edit": "it opens an editor a job has no terminal for, so the run would block holding the Queue until somebody killed it"
  },
  push: {
    "-f": "a force push rewrites a remote anyone may already have fetched, and nothing here can undo it",
    "--force": "a force push rewrites a remote anyone may already have fetched, and nothing here can undo it",
    "--force-with-lease": "a force push rewrites a remote anyone may already have fetched, and nothing here can undo it",
    "--force-if-includes": "a force push rewrites a remote anyone may already have fetched, and nothing here can undo it",
    "-d": "it deletes a remote ref \u2014 the destination the caller is meant to name is meant to exist",
    "--delete": "it deletes a remote ref \u2014 the destination the caller is meant to name is meant to exist",
    "--mirror": "it publishes or deletes every ref the repository has, named or not",
    "--all": "it publishes every local branch, named or not",
    "--branches": "it publishes every local branch, named or not",
    "--tags": "it publishes every tag, named or not",
    "--follow-tags": "it publishes the annotated tags reachable from the pushed commit \u2014 refs the caller never named",
    "--prune": "it deletes remote-tracking refs the caller never named",
    "--repo": "it points the push at a repository other than the named remote",
    "--receive-pack": "it runs an arbitrary program on the other side of the connection \u2014 general execution behind an allowlisted verb",
    "--exec": "it runs an arbitrary program on the other side of the connection \u2014 general execution behind an allowlisted verb"
  }
};
var GIT_BLOCKED_FLAGS = {
  branch: /* @__PURE__ */ new Set(["-d", "-D", "--delete", "-m", "-M", "--move"]),
  commit: /* @__PURE__ */ new Set(),
  add: /* @__PURE__ */ new Set(),
  status: /* @__PURE__ */ new Set(),
  diff: /* @__PURE__ */ new Set(),
  log: /* @__PURE__ */ new Set(),
  fetch: new Set(Object.keys(GIT_FLAG_REASONS["fetch"] ?? {})),
  rebase: new Set(Object.keys(GIT_FLAG_REASONS["rebase"] ?? {})),
  "cherry-pick": new Set(Object.keys(GIT_FLAG_REASONS["cherry-pick"] ?? {})),
  push: new Set(Object.keys(GIT_FLAG_REASONS["push"] ?? {}))
};
var GIT_PUSH_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "-u",
  "--set-upstream",
  "--dry-run",
  "--porcelain",
  "--progress",
  "--no-progress",
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "--atomic",
  "--no-verify"
]);
var GIT_ALLOWED_FLAGS = {
  restore: /* @__PURE__ */ new Set(["-S", "--staged", "-W", "--worktree", "-q", "--quiet"])
};
var PATHSPEC_WILDCARDS = /* @__PURE__ */ new Set(["*", "?", "[", "]"]);
var MESSAGE_SOURCE_FLAGS = /* @__PURE__ */ new Set([
  "-m",
  "--message",
  "-F",
  "--file",
  "-C",
  "--reuse-message",
  "-c",
  "--reedit-message",
  "--fixup",
  "--squash",
  "--no-edit"
]);
var SCOPE_UNCOMMITTED = "uncommitted";
var SCOPE_EXPAND_VERBS = /* @__PURE__ */ new Set(["format"]);
var SCOPE_FILTER_VERBS = /* @__PURE__ */ new Set(["analyze", "fix"]);
var SCOPE_COMMANDS = /* @__PURE__ */ new Set(["dart", "flutter"]);
var SCOPE_FILE_SUFFIX = ".dart";
var GIT_STATUS_TIMEOUT_MS = 2e4;
var KNOWN_FAILURES_RELPATH = ".toolbridge/known-failures.json";
var KNOWN_FAILURES_MAX_BYTES = 512 * 1024;
var KNOWN_PLATFORMS = /* @__PURE__ */ new Set(["windows", "posix"]);
var KNOWN_KINDS = /* @__PURE__ */ new Set(["platform", "flaky", "environment", "defect", "unclassified"]);
function knownFailuresPath(cwd) {
  return `${cwd.replace(/[\\/]+$/u, "")}\\${KNOWN_FAILURES_RELPATH.replaceAll("/", "\\")}`;
}

// src/engine/baseline.ts
var IS_WINDOWS = process.platform === "win32";
function currentPlatform() {
  return IS_WINDOWS ? "windows" : "posix";
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
function sortedRepr(values) {
  return `[${[...values].sort().map((value) => `'${value}'`).join(", ")}]`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseKnownFailures(raw) {
  if (!isRecord(raw)) {
    refuse(400, "registry must be a JSON object");
  }
  const entries = raw["entries"];
  if (!Array.isArray(entries)) {
    refuse(400, "registry needs an 'entries' list");
  }
  const items = entries;
  const parsed = [];
  for (let index = 0; index < items.length; index += 1) {
    const where = `entries[${index}]`;
    const entry = items[index];
    if (!isRecord(entry)) {
      refuse(400, `${where} must be an object`);
    }
    const name2 = entry["name"] ?? null;
    const source = entry["match"] ?? null;
    if (name2 === null === (source === null)) {
      refuse(400, `${where} needs exactly one of 'name' or 'match'`);
    }
    if (name2 !== null && typeof name2 !== "string") {
      refuse(400, `${where}.name must be a string`);
    }
    let pattern = null;
    if (source !== null) {
      if (typeof source !== "string") {
        refuse(400, `${where}.match must be a string`);
      }
      try {
        pattern = new RegExp(source);
      } catch (error) {
        refuse(400, `${where}.match is not a valid regex: ${errorText(error)}`);
      }
    }
    const fileName = entry["file"] ?? null;
    if (fileName !== null && typeof fileName !== "string") {
      refuse(400, `${where}.file must be a string`);
    }
    const kind = entry["kind"] === void 0 ? "unclassified" : entry["kind"];
    if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
      refuse(400, `${where}.kind must be one of ${sortedRepr(KNOWN_KINDS)}`);
    }
    const platform = entry["platform"] ?? null;
    if (platform !== null && !(typeof platform === "string" && KNOWN_PLATFORMS.has(platform))) {
      refuse(400, `${where}.platform must be one of ${sortedRepr(KNOWN_PLATFORMS)}`);
    }
    const reason = entry["reason"] ?? null;
    if (reason !== null && typeof reason !== "string") {
      refuse(400, `${where}.reason must be a string`);
    }
    parsed.push({ file: fileName, name: name2, pattern, kind, platform, reason });
  }
  return parsed;
}
function loadKnownFailures(cwd) {
  const path = knownFailuresPath(cwd);
  const registry = {
    path: KNOWN_FAILURES_RELPATH,
    exists: false,
    entries: [],
    error: null
  };
  try {
    if (!statSync(path).isFile()) return registry;
  } catch {
    return registry;
  }
  registry.exists = true;
  try {
    if (statSync(path).size > KNOWN_FAILURES_MAX_BYTES) {
      refuse(400, `registry is larger than ${KNOWN_FAILURES_MAX_BYTES} bytes`);
    }
    const text = readFileSync(path).toString("utf8");
    const document = JSON.parse(text);
    registry.entries = parseKnownFailures(document);
  } catch (error) {
    registry.error = errorText(error);
  }
  return registry;
}
function pathMatches(actual, expected) {
  if (!actual) return false;
  let reported = actual.replaceAll("\\", "/");
  let wanted = expected.replaceAll("\\", "/").replace(/^\/+/u, "");
  if (IS_WINDOWS) {
    reported = reported.toLowerCase();
    wanted = wanted.toLowerCase();
  }
  return reported === wanted || reported.endsWith("/" + wanted);
}
function knownEntryFor(entries, failure) {
  const name2 = failure.name || "";
  const platform = currentPlatform();
  for (const entry of entries) {
    if (entry.platform !== null && entry.platform !== platform) continue;
    if (entry.file !== null && !pathMatches(failure.file, entry.file)) continue;
    if (entry.name !== null) {
      if (name2 === entry.name) return entry;
      continue;
    }
    if (entry.pattern !== null && entry.pattern.test(name2)) return entry;
  }
  return null;
}
function baselineReport(failures, counts, registry) {
  if (!registry.exists) return null;
  const report = {
    source: registry.path,
    known: 0,
    new: 0,
    failed: counts === null ? null : counts.failed,
    tests: 0,
    events: failures.length,
    unparsed: 0,
    newFailures: [],
    error: registry.error
  };
  const entries = registry.error === null ? registry.entries : [];
  const newFailures = [];
  const counted = /* @__PURE__ */ new Set();
  let known = 0;
  for (const failure of failures) {
    const entry = knownEntryFor(entries, failure);
    if (entry !== null) {
      failure.known = { kind: entry.kind, reason: entry.reason };
    }
    const key = JSON.stringify([failure.file, failure.name || ""]);
    if (counted.has(key)) continue;
    counted.add(key);
    if (entry === null) {
      newFailures.push(failure);
      continue;
    }
    known += 1;
  }
  report.known = known;
  report.new = newFailures.length;
  report.tests = counted.size;
  report.newFailures = newFailures;
  if (counts !== null) {
    report.unparsed = Math.max(0, counts.failed - counted.size);
  }
  return report;
}
function summarizeWithBaseline(summary, report) {
  if (summary === null || report === null || report.error !== null) return summary;
  if (!summary.includes("failed")) return summary;
  const failed = report.failed;
  if (failed === null || report.tests > failed) return summary;
  const { known, unparsed } = report;
  const fresh = report.new;
  if (known + fresh + unparsed === 0) return summary;
  const parts = [`${known} known`, `${fresh} new`];
  if (unparsed) parts.push(`${unparsed} unparsed`);
  return `${summary} (${parts.join(", ")})`;
}

// src/engine/resolve.ts
import { existsSync, readFileSync as readFileSync2, realpathSync, statSync as statSync2 } from "node:fs";
import { basename, delimiter, dirname, join, sep } from "node:path";

// src/engine/argv.ts
function commandName(cmd) {
  const lastSlash = Math.max(cmd.lastIndexOf("/"), cmd.lastIndexOf("\\"));
  let exe = (lastSlash >= 0 ? cmd.slice(lastSlash + 1) : cmd).toLowerCase();
  for (const suffix of [".bat", ".exe", ".cmd"]) {
    if (exe.endsWith(suffix)) {
      exe = exe.slice(0, -suffix.length);
      break;
    }
  }
  return exe;
}
function flagValue(token, flag, args, index) {
  if (token === flag) {
    return args[index + 1] ?? null;
  }
  if (token.startsWith(`${flag}=`)) {
    return token.slice(flag.length + 1);
  }
  if (flag.length === 2 && token.startsWith(flag) && token.length > flag.length) {
    return token.slice(flag.length);
  }
  return null;
}
function isTestRun(argv) {
  if (argv.length < 2) return false;
  const first = argv[0];
  const second = argv[1];
  if (first === void 0 || second === void 0) return false;
  return (commandName(first) === "flutter" || commandName(first) === "dart") && second === "test";
}
function isCargoTestRun(argv) {
  const first = argv[0];
  const second = argv[1];
  if (first === void 0 || second === void 0) return false;
  return commandName(first) === "cargo" && second === "test";
}
function blockedFlag(token, blocked) {
  const equals = token.indexOf("=");
  const head = equals >= 0 ? token.slice(0, equals) : token;
  if (blocked.has(head)) {
    return head;
  }
  for (const short of blocked) {
    if (short.startsWith("-") && !short.startsWith("--") && token.startsWith(short) && token.length > short.length) {
      return short;
    }
  }
  return null;
}
function setsFlag(token, flag) {
  return token === flag || token.startsWith(`${flag}=`) || flag.length === 2 && !flag.startsWith("--") && token.startsWith(flag) && token.length > flag.length;
}
function selectorAt(manager, tokens, index) {
  const flags = PACKAGE_MANAGER_SELECTOR_FLAGS[manager];
  const token = tokens[index];
  if (flags === void 0 || token === void 0) return null;
  for (const flag of flags) {
    if (setsFlag(token, flag)) {
      return { flag, value: flagValue(token, flag, tokens, index) };
    }
  }
  return null;
}
function splitManagerGlobals(manager, args) {
  const blocked = PACKAGE_MANAGER_BLOCKED_FLAGS[manager];
  const selectors = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (blocked !== void 0 && blockedFlag(token, blocked) !== null) {
      return { selectors, rest: args.slice(index) };
    }
    const selector = selectorAt(manager, args, index);
    if (selector === null) {
      return { selectors, rest: args.slice(index) };
    }
    selectors.push(selector);
    if (token === selector.flag && index + 1 < args.length) {
      index += 1;
    }
  }
  return { selectors, rest: [] };
}
function runScriptToken(rest) {
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--") {
      return void 0;
    }
    if (!token.startsWith("-")) {
      return token;
    }
    const equals = token.indexOf("=");
    const head = equals >= 0 ? token.slice(0, equals) : token;
    if (token === head && MANAGER_VALUE_FLAGS.has(head)) {
      index += 1;
    }
  }
  return void 0;
}
function execTarget(argv) {
  const first = argv[0];
  if (first === void 0) return void 0;
  const name2 = commandName(first);
  let rest;
  if (name2 === "npx") {
    rest = argv.slice(1);
  } else if (PACKAGE_MANAGERS.has(name2) && argv[1] === "exec") {
    rest = argv.slice(2);
  } else {
    return void 0;
  }
  const positional = rest.filter((token) => token !== "--");
  const head = positional[0];
  if (head === void 0 || head.startsWith("-")) return void 0;
  return { target: commandName(head), args: positional.slice(1) };
}
function isVitestRun(argv) {
  const first = argv[0];
  if (first === void 0) return false;
  if (commandName(first) === "vitest") return true;
  const peeled = execTarget(argv);
  return peeled !== void 0 && peeled.target === "vitest";
}
function mightRunVitest(argv) {
  const first = argv[0];
  return first !== void 0 && (PACKAGE_MANAGER_RUNNERS.has(commandName(first)) || commandName(first) === "vitest");
}
function splitPathAndName(text) {
  const separator = text.indexOf(": ");
  if (separator >= 0) {
    const head = text.slice(0, separator);
    const tail = text.slice(separator + 2);
    if (head.includes("/") || head.includes("\\") || head.endsWith(".dart")) {
      return { file: head, name: tail };
    }
  }
  return { file: null, name: text };
}

// src/engine/resolve.ts
var SCRIPT_BINARY_PACKAGES = {
  tsc: "typescript",
  "svelte-kit": "@sveltejs/kit"
};
function isFile(target) {
  try {
    return statSync2(target).isFile();
  } catch {
    return false;
  }
}
function realpathish(target) {
  try {
    return realpathSync(target);
  } catch {
    const parent = dirname(target);
    if (parent === target) return target;
    return join(realpathish(parent), basename(target));
  }
}
function pyRepr(value) {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let body = "";
  for (const character of value) {
    if (character === "\\") body += "\\\\";
    else if (character === quote) body += `\\${character}`;
    else body += character;
  }
  return `${quote}${body}${quote}`;
}
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function whichOnPath(name2) {
  if (name2.includes("/") || name2.includes("\\")) {
    return existsSync(name2) ? name2 : null;
  }
  const rawPath = process.env["PATH"];
  const searchPath = rawPath !== void 0 && rawPath !== "" ? rawPath : ".";
  const directories = searchPath.split(delimiter);
  if (!directories.includes(".")) directories.unshift(".");
  const extensions = (process.env["PATHEXT"] ?? "").split(delimiter);
  const lower = name2.toLowerCase();
  const files = extensions.some((extension) => lower.endsWith(extension.toLowerCase())) ? [name2] : extensions.map((extension) => name2 + extension);
  const seen = /* @__PURE__ */ new Set();
  for (const directory of directories) {
    const key = directory.toLowerCase().replaceAll("/", "\\");
    if (seen.has(key)) continue;
    seen.add(key);
    for (const file of files) {
      const candidate = join(directory, file);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
function dartFormatTarget(argv, pin) {
  if (pin === null || argv.length < 2) return null;
  const [first, second] = argv;
  if (first === void 0 || second === void 0) return null;
  if (commandName(first) !== "dart" || second !== "format") return null;
  return pin;
}
function wantsLongLane(cmd, args) {
  let parts = [...args];
  let exe = commandName(cmd);
  if (PACKAGE_MANAGERS.has(exe)) {
    const { rest } = splitManagerGlobals(exe, parts);
    const verb = rest[0] ?? "";
    const tail = rest.slice(1);
    if (verb === "exec") {
      const peeled = execTarget([cmd, ...rest]);
      if (peeled === void 0) return false;
      exe = peeled.target;
      parts = peeled.args;
    } else if (verb === "run" || verb === "run-script") {
      const script = runScriptToken(tail);
      return script !== void 0 && LONG_SCRIPTS.has(script);
    } else {
      return false;
    }
  } else if (exe === "npx") {
    const peeled = execTarget([cmd, ...args]);
    if (peeled === void 0) return false;
    exe = peeled.target;
    parts = peeled.args;
  }
  if (parts.some((token) => token === "--help" || token === "-h" || token === "--version" || token === "-v")) {
    return false;
  }
  const positional = parts.filter((token) => !token.startsWith("-"));
  if (exe === "vite") {
    const head = positional[0];
    return head === void 0 || head === "dev" || head === "serve" || head === "preview";
  }
  if (exe === "vitest") {
    return !positional.includes("run") && !parts.includes("--run");
  }
  return false;
}
function resolveLaunch(argv, dartFormatExe = null, cwd = null, which = whichOnPath, javaHome = process.env["JAVA_HOME"] ?? null) {
  const pin = dartFormatTarget(argv, dartFormatExe);
  if (pin !== null) {
    if (!isFile(pin)) {
      throw new ToolFailure(`pinned dart format executable is missing: ${pin}`);
    }
    return { argv: [pin, ...argv.slice(1)], env: {} };
  }
  const name2 = commandName(argv[0] ?? "");
  if (SCRIPT_BINARIES.has(name2)) {
    const target = resolveScriptBinary(cwd ?? process.cwd(), name2);
    return { argv: [nodeExe(which), target, ...argv.slice(1)], env: {} };
  }
  if (name2 === "gradlew") {
    return resolveGradleWrapper(cwd ?? process.cwd(), argv.slice(1), javaHome);
  }
  if (PACKAGE_MANAGER_RUNNERS.has(name2)) {
    return { argv: [...resolvePackageManager(name2, which), ...argv.slice(1)], env: {} };
  }
  const exe = which(argv[0] ?? "");
  if (exe === null) {
    throw new ToolFailure(`executable not found on PATH: ${argv[0] ?? ""}`);
  }
  if (exe.toLowerCase().endsWith(".bat") || exe.toLowerCase().endsWith(".cmd")) {
    const flutterBin = dirname(exe);
    const flutterRoot = dirname(flutterBin);
    const dartExe = join(flutterBin, "cache", "dart-sdk", "bin", "dart.exe");
    if (!existsSync(dartExe)) {
      throw new ToolFailure(`${exe} is a wrapper but its SDK dart.exe is missing: ${dartExe}`);
    }
    if (basename(exe).toLowerCase().startsWith("flutter")) {
      const snapshot = join(flutterBin, "cache", "flutter_tools.snapshot");
      if (!existsSync(snapshot)) {
        throw new ToolFailure(`flutter_tools.snapshot missing: ${snapshot}`);
      }
      return { argv: [dartExe, snapshot, ...argv.slice(1)], env: { FLUTTER_ROOT: flutterRoot } };
    }
    return { argv: [dartExe, ...argv.slice(1)], env: { FLUTTER_ROOT: flutterRoot } };
  }
  return { argv: [exe, ...argv.slice(1)], env: {} };
}
function nodeExe(which = whichOnPath) {
  const exe = which("node");
  if (exe === null) {
    throw new ToolFailure(
      "node is not on PATH \u2014 the bridge needs it to run a project's own vite/vitest/svelte-check/tsc"
    );
  }
  return exe;
}
function resolveScriptBinary(cwd, name2) {
  const packageName = SCRIPT_BINARY_PACKAGES[name2] ?? name2;
  const packageDir = join(cwd, "node_modules", ...packageName.split("/"));
  const manifest = join(packageDir, "package.json");
  if (!isFile(manifest)) {
    throw new ToolFailure(
      `${name2} is not installed in ${cwd}: ${manifest} is missing (install the project's dependencies first)`
    );
  }
  let document;
  try {
    document = JSON.parse(readFileSync2(manifest, "utf8"));
  } catch (error) {
    throw new ToolFailure(`cannot read ${manifest}: ${describeError(error)}`, { cause: error });
  }
  const record = typeof document === "object" && document !== null ? document : null;
  let entry = record === null ? void 0 : record["bin"];
  if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
    entry = entry[name2];
  }
  if (typeof entry !== "string" || entry === "") {
    throw new ToolFailure(`${packageName} declares no \`bin\` entry for ${pyRepr(name2)}`);
  }
  const root = realpathish(packageDir);
  const target = realpathish(join(packageDir, entry));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new ToolFailure(`${name2} points outside its package: ${pyRepr(entry)}`);
  }
  if (!isFile(target)) {
    throw new ToolFailure(`${name2} entry point is missing: ${target}`);
  }
  return target;
}
var GRADLE_WRAPPER_MAIN = "org.gradle.wrapper.GradleWrapperMain";
function resolveGradleWrapper(cwd, args, javaHome) {
  const jar = join(cwd, gradleProjectDir(args), "gradle", "wrapper", "gradle-wrapper.jar");
  if (!isFile(jar)) {
    throw new ToolFailure(
      `the working directory is not a Gradle project root: ${jar} is missing \u2014 start the session in the Gradle root, or name it with a relative '-p <dir>' inside the working directory`
    );
  }
  return {
    argv: [
      gradleJavaExe(javaHome),
      "-Dorg.gradle.appname=gradlew",
      "-classpath",
      jar,
      GRADLE_WRAPPER_MAIN,
      ...args
    ],
    env: {}
  };
}
function gradleProjectDir(args) {
  let dir = "";
  for (const [index, token] of args.entries()) {
    if (token === "--") {
      return dir;
    }
    for (const flag of GRADLE_PROJECT_DIR_FLAGS) {
      const value = flagValue(token, flag, args, index);
      if (value !== null) {
        dir = value;
      }
    }
  }
  return dir;
}
function gradleJavaExe(javaHome) {
  if (javaHome === null || javaHome === "") {
    throw new ToolFailure(
      "JAVA_HOME is not set \u2014 the bridge runs the Gradle wrapper with JAVA_HOME\\bin\\java.exe and does not fall back to PATH java, because a React Native toolchain is strict about its JDK"
    );
  }
  const exe = join(javaHome.replaceAll('"', ""), "bin", "java.exe");
  if (!isFile(exe)) {
    throw new ToolFailure(
      `JAVA_HOME does not point at a JDK: ${exe} is missing \u2014 point it at the JDK this project builds with (a strict toolchain, e.g. React Native 0.87, wants JDK 17 even when Gradle itself runs on a newer one)`
    );
  }
  return exe;
}
function resolvePackageManager(name2, which = whichOnPath) {
  const exe = which(name2);
  if (exe === null) {
    throw new ToolFailure(
      `${name2} is not on PATH \u2014 install it, or run the project's scripts with its own package manager`
    );
  }
  if (exe.toLowerCase().endsWith(".exe")) {
    return [exe];
  }
  const base = dirname(exe);
  for (const parts of PACKAGE_MANAGER_ENTRIES[name2] ?? []) {
    const candidate = join(base, ...parts);
    if (isFile(candidate)) {
      return [nodeExe(which), candidate];
    }
  }
  if (name2 === "npm" || name2 === "npx") {
    const node = which("node");
    if (node !== null) {
      const nodeDir = dirname(node);
      const suffix = name2 === "npx" ? "npx-cli" : "npm-cli";
      for (const parts of NODE_INSTALL_ENTRIES) {
        const candidate = join(nodeDir, ...parts);
        if (basename(candidate).includes(suffix) && isFile(candidate)) {
          return [nodeExe(which), candidate];
        }
      }
    }
  }
  const entry = nodeEntryFromShim(exe);
  if (entry !== null) {
    return [nodeExe(which), entry];
  }
  throw new ToolFailure(`cannot find ${name2}'s JavaScript entry point behind the wrapper ${exe}`);
}
function nodeEntryFromShim(shim) {
  let text;
  try {
    text = readFileSync2(shim, "utf8");
  } catch {
    return null;
  }
  const base = dirname(shim);
  const paths = [];
  for (const token of text.replaceAll("\r\n", "\n").replaceAll('"', "\n").split("\n")) {
    const trimmed = token.trim();
    const lowered = trimmed.toLowerCase();
    if (!lowered.endsWith(".mjs") && !lowered.endsWith(".cjs") && !lowered.endsWith(".js")) {
      continue;
    }
    let cleaned = trimmed;
    if (cleaned.toUpperCase().startsWith("SET")) {
      cleaned = cleaned.slice(3).trim();
    }
    if (cleaned.includes("=")) {
      cleaned = cleaned.slice(cleaned.indexOf("=") + 1);
    }
    for (const variable of ["%~dp0", "%dp0%", "%CD%"]) {
      if (cleaned.startsWith(variable)) {
        cleaned = cleaned.slice(variable.length).replace(/^[\\/]+/u, "");
        break;
      }
    }
    if (cleaned.includes("=")) {
      continue;
    }
    const parts = cleaned.replaceAll("/", "\\").split("\\").filter((part) => part !== "");
    if (parts.length >= 2) {
      paths.push(parts);
    }
  }
  const preferred = paths.filter((parts) => parts[parts.length - 1]?.includes("-cli.") === true);
  for (const parts of [...preferred.length > 0 ? preferred : paths].reverse()) {
    const resolved = join(base, ...parts);
    if (isFile(resolved)) {
      return resolved;
    }
  }
  return null;
}

// src/engine/scope.ts
import { execFile } from "node:child_process";

// src/engine/env.ts
var TOOL_ENV_OVERRIDES = {
  NO_COLOR: "1",
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  /**
   * cargo is the one tool here that ignores `NO_COLOR`: it takes its colour
   * decision from `--color` and from this variable, and colours a *pipe* when
   * the terminal it was told about looks colour-capable. The digest reads the
   * log after `stripAnsi`, so a coloured line is still *parsed*; this keeps the
   * log file itself legible for the human who opens it, which is the other
   * reader a job log has.
   */
  CARGO_TERM_COLOR: "never"
};

// src/engine/scope.ts
var GIT_STATUS_ARGV = [
  "--no-optional-locks",
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all"
];
function parsePorcelain(data) {
  const paths = [];
  const records = data.split("\0");
  let index = 0;
  while (index < records.length) {
    const record = records[index] ?? "";
    index += 1;
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (status === "??") {
      paths.push(path);
      continue;
    }
    if (status === "!!") continue;
    const kind = status.charAt(0);
    if (kind === "R" || kind === "C") index += 1;
    if (status.includes("D") || path === "") continue;
    paths.push(path);
  }
  return paths;
}
function gitStatusError(error, stderr) {
  if (error.killed === true) {
    return new RefusalError(
      400,
      `git status timed out after ${GIT_STATUS_TIMEOUT_MS / 1e3}s`
    );
  }
  if (typeof error.code === "number") {
    const detail = stderr.trim();
    return new RefusalError(
      400,
      `git status failed (exit ${error.code}): ${detail === "" ? "no detail" : detail}`
    );
  }
  return new RefusalError(400, `git status could not run: ${error.message}`);
}
function runGitStatus(cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      GIT_STATUS_ARGV,
      {
        cwd,
        timeout: GIT_STATUS_TIMEOUT_MS,
        // The counterpart of `creationflags=CREATE_NO_WINDOW`: a console would
        // flash on every scoped request.
        windowsHide: true,
        encoding: "utf8",
        // No credential prompt: this process has no terminal to answer one, so
        // a prompt would cost the whole request. The colour overrides ride along
        // for the same reason they do on a job: whatever this returns is parsed
        // and shown, and terminal bytes in it are nobody's friend.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...TOOL_ENV_OVERRIDES }
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(gitStatusError(error, stderr));
      }
    );
  });
}
async function uncommittedDartFiles(cwd, runGit) {
  const status = await (runGit ?? runGitStatus)(cwd);
  const wanted = new Set(
    parsePorcelain(status).filter((path) => path.endsWith(SCOPE_FILE_SUFFIX))
  );
  return [...wanted].sort();
}
function scopeMode(cmd, args) {
  const verb = args[0];
  if (!SCOPE_COMMANDS.has(commandName(cmd)) || verb === void 0) return null;
  if (SCOPE_FILTER_VERBS.has(verb)) return "filter";
  if (commandName(cmd) === "dart" && SCOPE_EXPAND_VERBS.has(verb)) return "expand";
  return null;
}
function scopeRefusal(cmd, args) {
  const verb = args[0] ?? "";
  return `scope is not supported for ${cmd} ${verb}`.trimEnd() + " (scoped: dart format \u2014 it expands to the uncommitted files; dart/flutter analyze and fix \u2014 they filter their output to them)";
}
function pathFilterRegex(paths) {
  return new RegExp(paths.map(escapeRegexLiteral).join("|"));
}
function escapeRegexLiteral(path) {
  return path.replace(/[.*+?^${}()|[\]\\\n\r\u2028\u2029]/gu, (character) => {
    switch (character) {
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        return `\\${character}`;
    }
  });
}

// src/engine/validate.ts
function repr(value) {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = "";
  for (const char of value) {
    if (char === "\\" || char === quote) {
      out += `\\${char}`;
    } else if (char === "\n") {
      out += "\\n";
    } else if (char === "\r") {
      out += "\\r";
    } else if (char === "	") {
      out += "\\t";
    } else if (char === " " || !/[\p{C}\p{Z}]/u.test(char)) {
      out += char;
    } else {
      const code = char.codePointAt(0) ?? 0;
      const digits = code.toString(16);
      out += code <= 255 ? `\\x${digits.padStart(2, "0")}` : code <= 65535 ? `\\u${digits.padStart(4, "0")}` : `\\U${digits.padStart(8, "0")}`;
    }
  }
  return `${quote}${out}${quote}`;
}
function sortedList(values) {
  return `[${[...values].sort().map((value) => repr(value)).join(", ")}]`;
}
function validate(argv) {
  shorthandToRun(argv);
  const head = argv[0] ?? "";
  const exe = commandName(head);
  if (!ALLOWED_EXES.has(exe)) {
    refuse(403, `command not allowed: ${repr(head)} (allowed: ${sortedList(ALLOWED_EXES)})`);
  }
  if (exe === "git") {
    validateGit(argv.slice(1));
    return;
  }
  if (exe === "gradlew") {
    ensureNoDaemon(argv);
    validateGradle(argv.slice(1));
    return;
  }
  if (exe === "cargo") {
    validateCargo(argv.slice(1));
    return;
  }
  if (PACKAGE_MANAGERS.has(exe)) {
    validatePackageManager(exe, argv.slice(1));
    return;
  }
  if (exe === "npx") {
    validateNpx(argv.slice(1));
  }
}
function validateGit(args) {
  const verb = args[0];
  if (verb === void 0) {
    refuse(403, "git needs a verb");
  }
  if (verb.startsWith("-")) {
    refuse(403, `git verb not allowed: ${repr(verb)}`);
  }
  if (!GIT_VERBS.has(verb)) {
    refuse(403, verbRefusal(verb));
  }
  const body = args.slice(1);
  const allowed = GIT_ALLOWED_FLAGS[verb];
  if (allowed !== void 0) {
    validateRestore(body, allowed);
    return;
  }
  if (verb === "push") {
    validatePush(body);
    return;
  }
  validateGitDenyList(verb, body);
  if (verb === "commit" && !hasMessageSource(body)) {
    refuse(
      403,
      "git commit needs a message: pass the inline 'message' field to /run, or one of -m/--message/-F/--file/-C/--reuse-message"
    );
  }
}
function validateGitDenyList(verb, body) {
  const blocked = GIT_BLOCKED_FLAGS[verb] ?? /* @__PURE__ */ new Set();
  for (const token of body) {
    if (token === "--") {
      return;
    }
    if (!token.startsWith("-")) {
      continue;
    }
    const hit = blockedFlag(token, blocked);
    if (hit !== null) {
      refuse(403, gitFlagRefusal(verb, hit));
    }
  }
}
function validatePush(body) {
  const positionals = [];
  let afterSeparator = false;
  for (const token of body) {
    if (afterSeparator) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      afterSeparator = true;
      continue;
    }
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }
    const hit = blockedFlag(token, GIT_BLOCKED_FLAGS["push"] ?? /* @__PURE__ */ new Set());
    if (hit !== null) {
      refuse(403, gitFlagRefusal("push", hit));
    }
    const equals = token.indexOf("=");
    const head = equals >= 0 ? token.slice(0, equals) : token;
    if (!GIT_PUSH_ALLOWED_FLAGS.has(head)) {
      refuse(403, pushFlagRefusal(head));
    }
  }
  const remote = positionals[0];
  if (remote === void 0) {
    refuse(
      403,
      "git push needs a remote and a destination ref, e.g. git push origin feature-branch \u2014 a bare push publishes whatever the upstream config happens to say, so this surface never runs one"
    );
  }
  guardPushRemote(remote);
  const refspecs = positionals.slice(1);
  if (refspecs.length === 0) {
    refuse(
      403,
      `git push needs a destination ref, e.g. git push ${repr(remote)} feature-branch (or HEAD:refs/heads/feature-branch) \u2014 the ref published has to be named, not taken from the upstream config`
    );
  }
  for (const spec of refspecs) {
    guardPushRefspec(spec);
  }
}
function pushFlagRefusal(flag) {
  return `git push flag not allowed: ${repr(flag)} (allowed: ${sortedList(GIT_PUSH_ALLOWED_FLAGS)}) \u2014 this surface publishes one named branch to one named remote and rewrites nothing already there`;
}
function guardPushRemote(remote) {
  const localPath = remote.startsWith(".") || remote.startsWith("/") || remote.startsWith("\\") || remote.includes("\\") || /^[A-Za-z]:/u.test(remote);
  if (localPath || /^file:/iu.test(remote)) {
    refuse(
      403,
      `git push remote must be a named remote or a URL, not a local path: ${repr(remote)} \u2014 a path remote writes into a repository the pinned working directory does not contain`
    );
  }
}
function guardPushRefspec(spec) {
  if (!spec) {
    refuse(403, "git push refspec must not be empty");
  }
  if (spec.startsWith("+")) {
    refuse(
      403,
      `git push refspec must not force: ${repr(spec)} \u2014 a '+' refspec is a force push by another spelling, and a force push rewrites a remote anyone may already have fetched`
    );
  }
  if (spec.startsWith(":")) {
    refuse(
      403,
      `git push refspec must name a ref to publish, not delete: ${repr(spec)} \u2014 a leading colon deletes a remote ref`
    );
  }
  if (spec.includes("*")) {
    refuse(
      403,
      `git push refspec must name one ref, not a pattern: ${repr(spec)} \u2014 a wildcard publishes branches the caller never named`
    );
  }
}
function shorthandToRun(argv) {
  const head = argv[0];
  if (argv.length < 2 || head === void 0 || commandName(head) !== "npm") {
    return;
  }
  const { rest } = splitManagerGlobals("npm", argv.slice(1));
  const shorthand = argv[argv.length - rest.length];
  if (shorthand !== void 0 && NPM_RUN_SHORTHANDS.has(shorthand)) {
    argv.splice(argv.length - rest.length, 0, "run");
  }
}
function ensureNoDaemon(argv) {
  const head = argv[0];
  if (head === void 0 || commandName(head) !== "gradlew") {
    return;
  }
  const separator = argv.indexOf("--");
  const surface = separator >= 0 ? argv.slice(0, separator) : argv;
  if (!surface.includes("--no-daemon")) {
    argv.splice(1, 0, "--no-daemon");
  }
}
function flagRefusal(manager, flag) {
  const where = manager === "pnpm" ? "the pinned working directory" : "the pinned cwd";
  const scope = PACKAGE_MANAGER_WHOLE_WORKSPACE_FLAGS.has(flag) ? "every workspace member at once, which is one invocation writing into all of them" : "a different directory, the workspace root, or the machine's global prefix";
  return `${manager} flag not allowed: ${repr(flag)} \u2014 it would run outside ${where} (${scope}); the bridge pins one cwd per session and no request can retarget it`;
}
function selectorRefusal(manager, flag) {
  const example = manager === "cargo" ? `cargo test ${flag} web` : `${manager} ${flag} web run build`;
  return `${manager} ${repr(flag)} needs a workspace selector value, e.g. ${example} \u2014 a selector with nothing after it names no member at all`;
}
function exclusionRefusal(manager, value) {
  return `${manager} selector not allowed: ${repr(value)} \u2014 a '!' selector means every member except the ones named, which is the whole-workspace run --workspaces is refused for (one invocation writing into all of them); name the members instead`;
}
function locationRefusal(manager, value) {
  return `${manager} flag not allowed: '--location=${value}' \u2014 it selects the machine's global prefix, which is outside the pinned project; '--location=project' is accepted`;
}
function locationValue(token) {
  if (token === PACKAGE_MANAGER_LOCATION_FLAG) {
    return "";
  }
  const equals = token.indexOf("=");
  if (equals >= 0 && token.slice(0, equals) === PACKAGE_MANAGER_LOCATION_FLAG) {
    return token.slice(equals + 1);
  }
  return null;
}
function isDirectorySelector(value) {
  if (value === ".") {
    return true;
  }
  if (value.startsWith("...")) {
    return false;
  }
  if (value.startsWith("@") || value.startsWith("[") || value.startsWith("{")) {
    return false;
  }
  return value.startsWith(".") || value.startsWith("/") || value.startsWith("\\") || value.includes("/") || value.includes("\\") || /^[A-Za-z]:/u.test(value);
}
function guardSelectorValue(manager, selector) {
  const value = selector.value;
  if (value === null || value === "") {
    refuse(403, selectorRefusal(manager, selector.flag));
  }
  if (value === ".") {
    return;
  }
  if (value.startsWith("!")) {
    refuse(403, exclusionRefusal(manager, value));
  }
  const brace = value.startsWith("{") ? value.indexOf("}") : -1;
  if (brace > 0) {
    guardLiteralPath(value.slice(1, brace), `the ${manager} workspace selector`, "a directory");
    return;
  }
  if (isDirectorySelector(value)) {
    guardLiteralPath(value, `the ${manager} workspace selector`, "a directory");
  }
}
function checkRetargeting(manager, tokens, extra) {
  const blocked = /* @__PURE__ */ new Set([...PACKAGE_MANAGER_BLOCKED_FLAGS[manager] ?? /* @__PURE__ */ new Set(), ...extra]);
  for (const [index, token] of tokens.entries()) {
    if (token === "--") {
      return;
    }
    if (!token.startsWith("-")) {
      continue;
    }
    const hit = blockedFlag(token, blocked);
    if (hit !== null) {
      refuse(403, flagRefusal(manager, hit));
    }
    const selector = selectorAt(manager, tokens, index);
    if (selector !== null) {
      guardSelectorValue(manager, selector);
      continue;
    }
    const value = locationValue(token);
    if (value === null) {
      continue;
    }
    let selected = value;
    if (!selected) {
      const following = tokens[index + 1] ?? "";
      selected = following.startsWith("-") ? "" : following;
    }
    if (PACKAGE_MANAGER_GLOBAL_LOCATIONS.has(selected)) {
      refuse(403, locationRefusal(manager, selected));
    }
  }
}
function validatePackageManager(manager, args) {
  const { selectors, rest } = splitManagerGlobals(manager, args);
  for (const selector of selectors) {
    guardSelectorValue(manager, selector);
  }
  const verb = rest[0];
  if (verb === void 0) {
    refuse(403, `${manager} needs a verb`);
  }
  const blocked = PACKAGE_MANAGER_BLOCKED_FLAGS[manager] ?? /* @__PURE__ */ new Set();
  const hit = blockedFlag(verb, blocked);
  if (hit !== null) {
    refuse(403, flagRefusal(manager, hit));
  }
  if (verb.startsWith("-")) {
    refuse(403, `${manager} needs a verb before flags: ${repr(verb)}`);
  }
  const verbs = PACKAGE_MANAGER_VERBS[manager] ?? /* @__PURE__ */ new Set();
  if (!verbs.has(verb)) {
    refuse(403, `${manager} verb not allowed: ${repr(verb)} (allowed: ${sortedList(verbs)})`);
  }
  if (verb === "exec") {
    validateExec(manager, rest.slice(1));
    return;
  }
  checkRetargeting(manager, rest.slice(1), /* @__PURE__ */ new Set());
}
function validateNpx(args) {
  validateExec("npx", args);
}
function validateExec(manager, args) {
  let target = null;
  let targetIndex = args.length;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      continue;
    }
    if (token.startsWith("-")) {
      const equals = token.indexOf("=");
      const head = equals >= 0 ? token.slice(0, equals) : token;
      if (token === head && MANAGER_VALUE_FLAGS.has(head)) {
        index += 1;
      }
      continue;
    }
    target = token;
    targetIndex = index;
    break;
  }
  checkRetargeting(manager, args.slice(0, targetIndex), EXEC_BLOCKED_FLAGS);
  if (target === null) {
    refuse(403, `${manager} needs a script binary to run, e.g. ${manager} vitest run`);
  }
  if (!SCRIPT_BINARIES.has(target)) {
    const substitute = manager === "npm" || manager === "npx" ? "npm run <script>" : "pnpm run <script>";
    refuse(
      403,
      `${manager} exec target not allowed: ${repr(target)} (allowed: ${sortedList(SCRIPT_BINARIES)}) \u2014 it runs anything it finds, including things on PATH (and npx fetches what it cannot find), so only the project's own tools are accepted; run a package script with '${substitute}' instead`
    );
  }
}
function verbRefusal(verb) {
  let message = `git verb not allowed: ${repr(verb)} (allowed: ${sortedList(GIT_VERBS)})`;
  if (verb === "checkout" || verb === "switch") {
    message += " \u2014 to discard worktree changes to named paths, use 'git restore -- <path>'";
  }
  return message;
}
function gitFlagRefusal(verb, flag) {
  const reason = GIT_FLAG_REASONS[verb]?.[flag];
  return reason === void 0 ? `git ${verb} flag not allowed: ${repr(flag)}` : `git ${verb} flag not allowed: ${repr(flag)} \u2014 ${reason}`;
}
function gradleFlagRefusal(flag) {
  return `gradlew flag not allowed: ${repr(flag)} \u2014 ${GRADLE_FLAG_REASONS[flag] ?? "not on the gradlew surface"}`;
}
function gradlePropertyRefusal(property) {
  return `gradlew property not allowed: ${repr(property)} \u2014 the 'org.gradle.*' key space redirects the build the same way -D does (java.home picks the build JVM); set it in the project's gradle.properties instead`;
}
function cargoVerbRefusal(verb) {
  const listed = `cargo verb not allowed: ${repr(verb)} (allowed: ${sortedList(CARGO_VERBS)})`;
  const reason = CARGO_VERB_REASONS[verb];
  if (reason !== void 0) {
    return `${listed} \u2014 ${reason}`;
  }
  return `${listed} \u2014 cargo dispatches a name it does not know to cargo-<name>.exe on PATH, which is general execution behind an allowlisted command (the reason \`pnpm exec\` is narrowed to the project's own tools); an installed helper such as cargo-binstall or cargo-nextest is refused for the same reason`;
}
function cargoFlagRefusal(flag) {
  const reason = CARGO_FLAG_REASONS[flag];
  return `cargo flag not allowed: ${repr(flag)}${reason === void 0 ? "" : ` \u2014 ${reason}`}`;
}
function cargoToolchainRefusal(token) {
  return `cargo toolchain selection is not an argv argument here: ${repr(token)} \u2014 the toolchain is machine configuration (rustup default, or RUSTUP_TOOLCHAIN in the environment), and every toolchain shares the one target/ directory a job builds into`;
}
function validateGradle(args) {
  for (const [index, token] of args.entries()) {
    if (token === "--") {
      return;
    }
    if (!token.startsWith("-")) {
      continue;
    }
    const hit = blockedFlag(token, GRADLE_BLOCKED_FLAGS);
    if (hit !== null) {
      refuse(403, gradleFlagRefusal(hit));
    }
    const property = [...GRADLE_PROPERTY_FLAGS].map((flag) => flagValue(token, flag, args, index)).find((value) => value !== null);
    if (property !== void 0 && property.startsWith(GRADLE_RESERVED_PROPERTY_PREFIX)) {
      refuse(403, gradlePropertyRefusal(property));
    }
    for (const flag of GRADLE_PROJECT_DIR_FLAGS) {
      const dir = flagValue(token, flag, args, index);
      if (dir !== null) {
        guardLiteralPath(dir, "the gradlew project directory", "a directory");
      }
    }
  }
}
function validateCargo(args) {
  const verb = args[0];
  if (verb === void 0) {
    refuse(403, "cargo needs a verb, e.g. cargo build");
  }
  if (verb.startsWith(CARGO_TOOLCHAIN_PREFIX)) {
    refuse(403, cargoToolchainRefusal(verb));
  }
  if (verb.startsWith("-")) {
    refuse(
      403,
      `cargo needs a verb before flags: ${repr(verb)} \u2014 spell it after the verb instead, e.g. 'cargo build ${verb}'`
    );
  }
  if (!CARGO_VERBS.has(verb)) {
    refuse(403, cargoVerbRefusal(verb));
  }
  validateCargoBody(args.slice(1));
}
function validateCargoBody(body) {
  for (const [index, token] of body.entries()) {
    if (token === "--") {
      return;
    }
    if (!token.startsWith("-")) {
      continue;
    }
    const hit = blockedFlag(token, CARGO_BLOCKED_FLAGS);
    if (hit !== null) {
      refuse(403, cargoFlagRefusal(hit));
    }
    const selector = selectorAt("cargo", body, index);
    if (selector !== null) {
      guardSelectorValue("cargo", selector);
      continue;
    }
    for (const flag of CARGO_MANIFEST_FLAGS) {
      const value = flagValue(token, flag, body, index);
      if (value !== null) {
        guardLiteralPath(value, "the cargo manifest path", "a file");
      }
    }
  }
}
function flagAllowed(token, allowed) {
  if (token.startsWith("--")) {
    return allowed.has(`--${token.slice(2).replace(/^no-/u, "")}`);
  }
  if (token.length > 2) {
    return [...token.slice(1)].every((char) => allowed.has(`-${char}`));
  }
  return allowed.has(token);
}
function escapesWorktree(spec) {
  return /^[A-Za-z]:/u.test(spec) || spec.startsWith("/") || spec.startsWith("\\");
}
function guardLiteralPath(spec, what, noun) {
  if (!spec) {
    refuse(403, `${what} must not be empty`);
  }
  if (spec.startsWith(":")) {
    refuse(403, `${what} magic is not allowed: ${repr(spec)}`);
  }
  if (escapesWorktree(spec)) {
    refuse(403, `${what} must be relative: ${repr(spec)}`);
  }
  const wildcard = [...new Set([...spec].filter((char) => PATHSPEC_WILDCARDS.has(char)))].sort();
  if (wildcard.length > 0) {
    refuse(
      403,
      `${what} must name ${noun}, not a pattern: ${repr(spec)} contains ${repr(wildcard.join(""))}`
    );
  }
  const parts = spec.split(/[\\/]/u).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) {
    refuse(
      403,
      `${what} must name ${noun} inside the working directory: ${repr(spec)}`
    );
  }
}
function guardRestorePathspec(spec) {
  guardLiteralPath(spec, "git restore pathspec", "files");
}
function validateRestore(args, allowed) {
  const pathspecs = [];
  let afterSeparator = false;
  for (const token of args) {
    if (afterSeparator) {
      pathspecs.push(token);
      continue;
    }
    if (token === "--") {
      afterSeparator = true;
      continue;
    }
    if (token.startsWith("-")) {
      if (!flagAllowed(token, allowed)) {
        refuse(403, `git restore flag not allowed: ${repr(token)}`);
      }
      continue;
    }
    pathspecs.push(token);
  }
  if (pathspecs.length === 0) {
    refuse(
      403,
      "git restore needs at least one explicit path, e.g. git restore -- lib/main.dart"
    );
  }
  for (const spec of pathspecs) {
    guardRestorePathspec(spec);
  }
}
function hasMessageSource(args) {
  for (const token of args) {
    const equals = token.indexOf("=");
    const head = equals >= 0 ? token.slice(0, equals) : token;
    if (MESSAGE_SOURCE_FLAGS.has(head)) {
      return true;
    }
  }
  return false;
}
function buildArgv(cmd, args, message) {
  if (message === null) {
    return [cmd, ...args];
  }
  if (typeof message !== "string") {
    refuse(403, "'message' must be a string");
  }
  if (!message.trim()) {
    refuse(403, "'message' must not be empty");
  }
  const head = args[0];
  if (commandName(cmd) !== "git" || head === void 0 || head !== "commit") {
    refuse(403, "'message' is only valid for git commit");
  }
  const body = args.slice(1);
  for (const token of body) {
    const equals = token.indexOf("=");
    const flag = equals >= 0 ? token.slice(0, equals) : token;
    if (MESSAGE_SOURCE_FLAGS.has(flag)) {
      refuse(403, `pass the commit message either inline or as ${repr(token)}, not both`);
    }
  }
  return [cmd, "commit", "-m", message, ...body];
}

// src/host/jobsource.ts
import { closeSync, openSync, readSync, statSync as statSync3 } from "node:fs";

// src/engine/ansi.ts
var ANSI_RE = /[\u001b\u009b](?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/gu;
var ESCAPE_LOOKBACK = 32;
var ESC = 27;
function stripAnsi(text) {
  return text.includes("\x1B") || text.includes("\x9B") ? text.replace(ANSI_RE, "") : text;
}
function incompleteEscapeSuffix(bytes) {
  const end = bytes.length;
  const floor = Math.max(0, end - ESCAPE_LOOKBACK);
  for (let index = end - 1; index >= floor; index -= 1) {
    const byte = bytes[index];
    if (byte !== ESC) continue;
    const next = bytes[index + 1];
    if (next === void 0) return end - index;
    if (next === 91) {
      for (let scan = index + 2; scan < end; scan += 1) {
        const candidate = bytes[scan];
        if (candidate >= 64 && candidate <= 126) return 0;
      }
      return end - index;
    }
    if (next === 93) {
      for (let scan = index + 2; scan < end; scan += 1) {
        if (bytes[scan] === 7) return 0;
        if (bytes[scan] === ESC && bytes[scan + 1] === 92) return 0;
      }
      return end - index;
    }
    return 0;
  }
  return 0;
}

// src/host/jobsource.ts
var JOB_OUTPUT_MIRROR_BYTES = 4 * 1024 * 1024;
function completeUtf8Prefix(bytes) {
  const end = bytes.length;
  const floor = Math.max(0, end - 3);
  for (let index = end - 1; index >= floor; index -= 1) {
    const byte = bytes[index];
    if ((byte & 192) === 128) continue;
    const needed = byte >= 240 ? 4 : byte >= 224 ? 3 : byte >= 192 ? 2 : 1;
    const have = end - index;
    return needed > have ? index : end;
  }
  return end;
}
var LogOutputSource = class {
  constructor(path, cap = JOB_OUTPUT_MIRROR_BYTES) {
    this.path = path;
    this.cap = cap;
  }
  /** The log's bytes are one stream; the run merges stderr into it on purpose. */
  channel = "stdout";
  /** The lowest offset this source can still serve (`0` until the cap bites). */
  served = 0;
  /**
   * The log's current size, or null when it does not exist yet.
   * @returns the byte length.
   */
  size() {
    try {
      return statSync3(this.path).size;
    } catch {
      return null;
    }
  }
  /** The bytes in `[from, to)`, or null when the file cannot be read. */
  bytesOf(from, to) {
    const length = to - from;
    if (length <= 0) return Buffer.alloc(0);
    let handle;
    try {
      handle = openSync(this.path, "r");
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.allocUnsafe(length);
      const read = readSync(handle, buffer, 0, length, from);
      return buffer.subarray(0, read);
    } catch {
      return null;
    } finally {
      closeSync(handle);
    }
  }
  /**
   * Everything the log gained since `fromByte`.
   *
   * A read below the window floor is lossy and returns the surviving tail, which
   * the registry turns into a gap chunk — the discontinuity is shown, not
   * silently spliced. `nextOffset` never moves backwards, which is the ring's
   * own assumption: consumers concatenate chunks by offset, so a cursor that
   * regressed would duplicate text rather than recover it.
   * @param fromByte - the whole-stream byte offset to resume from.
   * @returns the delta, the next offset, the lossy flag, and the log as spill path.
   */
  read(fromByte) {
    const size = this.size();
    if (size === null) return { text: "", nextOffset: Math.max(0, Math.trunc(fromByte)), lossy: false };
    const floor = Math.max(0, size - this.cap);
    if (floor > this.served) this.served = floor;
    const lossy = fromByte < this.served;
    const start = lossy ? this.served : Math.max(0, Math.trunc(fromByte));
    if (start >= size) return { text: "", nextOffset: start, lossy, spillPath: this.path };
    const bytes = this.bytesOf(start, size);
    if (bytes === null) return { text: "", nextOffset: start, lossy: false };
    const whole = completeUtf8Prefix(bytes);
    const usable = whole - incompleteEscapeSuffix(bytes.subarray(0, whole));
    return {
      text: stripAnsi(bytes.subarray(0, usable).toString("utf8")),
      nextOffset: start + usable,
      lossy,
      spillPath: this.path
    };
  }
};
function logMirror(logPath) {
  return logPath === null ? [] : [new LogOutputSource(logPath)];
}

// src/host/logfile.ts
import { closeSync as closeSync2, openSync as openSync2, readFileSync as readFileSync3, readSync as readSync2, statSync as statSync4 } from "node:fs";
var TAIL_SCAN_BYTES = 256 * 1024;
var DEFAULT_TAIL_LINES = 200;
var MAX_TAIL_LINES = 5e3;
function readWindow(path, bytes) {
  let size;
  try {
    size = statSync4(path).size;
  } catch {
    return { text: "", whole: true };
  }
  const start = Math.max(0, size - bytes);
  const length = size - start;
  if (length <= 0) return { text: "", whole: true };
  const handle = openSync2(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const read = readSync2(handle, buffer, 0, length, start);
    return { text: buffer.subarray(0, read).toString("utf8"), whole: start === 0 };
  } catch {
    return { text: "", whole: true };
  } finally {
    closeSync2(handle);
  }
}
function readTailText(path, lines) {
  if (lines <= 0) return "";
  const { text, whole } = readWindow(path, TAIL_SCAN_BYTES);
  let split = stripAnsi(text).split(/\r\n|[\r\n]/u);
  if (!whole && split.length > 1) split = split.slice(1);
  if (split.at(-1) === "") split.pop();
  return split.slice(-lines).join("\n");
}
function readFiltered(path, grep, lines) {
  if (grep === null) {
    return {
      text: readTailText(path, lines),
      log: { grep: null, matched: null, returned: null, scannedLines: null, truncated: false }
    };
  }
  let text;
  try {
    text = stripAnsi(readFileSync3(path, "utf8"));
  } catch {
    text = "";
  }
  const all = text.split(/\r\n|[\r\n]/u);
  if (all.at(-1) === "") all.pop();
  const kept = [];
  let matched = 0;
  let scanned = 0;
  for (const line of all) {
    scanned += 1;
    if (grep.test(line)) {
      matched += 1;
      if (lines > 0) {
        kept.push(line);
        if (kept.length > lines) kept.shift();
      }
    }
  }
  const returned = kept.length;
  return {
    text: kept.join("\n"),
    log: { grep: grep.source, matched, returned, scannedLines: scanned, truncated: matched > returned }
  };
}
function clampTail(lines) {
  if (lines === void 0) return DEFAULT_TAIL_LINES;
  if (!Number.isFinite(lines)) return DEFAULT_TAIL_LINES;
  return Math.max(0, Math.min(MAX_TAIL_LINES, Math.trunc(lines)));
}

// src/host/queue.ts
var Lanes = class {
  lanes = /* @__PURE__ */ new Map();
  /**
   * Queue `work` on one lane of one directory and return its place in line.
   *
   * The line is joined synchronously — the caller's `aheadOf` describes the
   * state at submit time, which is the only moment it can be observed — while
   * the work itself starts only after everything ahead of it has settled.
   * @param cwd - the directory whose lane this job joins.
   * @param lane - `queue` for anything that finishes, `long` for anything that runs until killed.
   * @param work - the job body, started once its turn arrives.
   * @returns the caller's position in line and the work's result.
   */
  enqueue(cwd, lane, work) {
    const key = `${lane}\0${cwd.toLowerCase()}`;
    const state = this.lanes.get(key) ?? { tail: Promise.resolve(), pending: 0 };
    this.lanes.set(key, state);
    const aheadOf = state.pending;
    state.pending += 1;
    const result = state.tail.then(work);
    state.tail = result.then(
      () => void 0,
      () => void 0
    );
    void result.catch(() => void 0).finally(() => {
      state.pending -= 1;
    });
    return { aheadOf, result };
  }
  /** Unfinished jobs on one lane of one directory: the running one and the waiting ones. */
  depth(cwd, lane = LANE_QUEUE) {
    return this.lanes.get(`${lane}\0${cwd.toLowerCase()}`)?.pending ?? 0;
  }
  /** Both lanes of one directory, for the sidebar's view. */
  snapshot(cwd) {
    return { queue: this.depth(cwd, LANE_QUEUE), long: this.depth(cwd, LANE_LONG) };
  }
};

// src/host/runner.ts
import { spawn as spawn2 } from "node:child_process";
import { appendFileSync, createWriteStream, mkdirSync } from "node:fs";
import { dirname as dirname2 } from "node:path";

// src/engine/digest.ts
import { readFileSync as readFileSync4 } from "node:fs";
var TEST_COUNTS_RE = /^(?:\d\d:\d\d )?\+(\d+)(?: ~(\d+))?(?: -(\d+))?: /;
var TEST_FAILURE_RE = /^(?:\d\d:\d\d )?\+(\d+)(?: ~\d+)?(?: -\d+)?: (?<name>.+?)(?<unfinished> - did not complete)? \[E\]$/;
var TEST_BLOCK_HEADER = "Failing tests:";
var TEST_BLOCK_MORE_RE = /^\.\.\. and (\d+) more$/;
var TEST_DID_NOT_COMPLETE = " (did not complete)";
var TEST_PASSED_MARKERS = [
  "All tests passed!",
  "All other tests passed!",
  "All tests skipped."
];
var TEST_FAILED_MARKERS = ["Some tests failed."];
var VITEST_TESTS_LINE_RE = /^ *Tests {2,}(?<body>\S.*)$/;
var VITEST_FILES_LINE_RE = /^ *Test Files {2,}(?<body>\S.*)$/;
var VITEST_COUNT_RE = /(\d+) (failed|passed|skipped|todo)/g;
var VITEST_TOTAL_RE = /\((\d+)\)\s*$/;
var VITEST_SECTION_RE = /^[^\p{L}\p{N}_\s]{2,} (?<name>Failed Tests|Failed Suites|Unhandled Errors) (?<count>\d+) /u;
var VITEST_FAIL_RE = /^ *FAIL {2,}(?<rest>\S.*)$/;
var VITEST_NO_TESTS = "no tests";
var VITEST_LOAD_PREFIX = "loading ";
var CARGO_RESULT_RE = /^test result: (?<verdict>ok|FAILED)\. (?<passed>\d+) passed; (?<failed>\d+) failed; (?<ignored>\d+) ignored; (?<measured>\d+) measured; (?<filtered>\d+) filtered out; finished in /u;
var CARGO_TEST_RE = /^test (?<name>.+?) \.\.\. (?<outcome>ok|FAILED|ignored\b.*|bench:.*)$/u;
var CARGO_QUIET_FAILED_RE = /^(?<name>\S.*?) --- FAILED$/u;
var CARGO_TARGET_RE = /^ +Running (?<target>.+?) \([^)]*\)$/u;
var CARGO_DOCTEST_RE = /^ +Doc-tests /u;
var CARGO_FAILURES_HEADER = "failures:";
var CARGO_UNITTESTS_PREFIX = "unittests ";
var CARGO_ERROR_MARKERS = [
  "error: could not compile",
  "error: test failed"
];
function readLogLines(logPath) {
  let text;
  try {
    text = stripAnsi(readFileSync4(logPath, "utf8"));
  } catch {
    return void 0;
  }
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function emptyDigest() {
  return { flavor: null, summary: null, counts: null, failures: [] };
}
function splitBlockEntry(text) {
  const finished = !text.endsWith(TEST_DID_NOT_COMPLETE);
  const described = finished ? text : text.slice(0, -TEST_DID_NOT_COMPLETE.length);
  const { file, name: name2 } = splitPathAndName(described);
  return { file, name: name2, didNotComplete: !finished };
}
function attachPaths(failures, block) {
  const used = /* @__PURE__ */ new Set();
  for (const entry of failures) {
    for (const [index, candidate] of block.entries()) {
      if (used.has(index) || candidate.name !== entry.name) continue;
      used.add(index);
      if (entry.file === null) entry.file = candidate.file;
      entry.didNotComplete = Boolean(entry.didNotComplete || candidate.didNotComplete);
      break;
    }
  }
  for (const [index, candidate] of block.entries()) {
    if (!used.has(index)) failures.push({ ...candidate });
  }
  return failures;
}
function summarizeTestRun(counts, verdict) {
  if (counts === null) return verdict === "passed" ? "all tests passed" : "see log";
  const { passed, failed, skipped } = counts;
  if (failed) return `${passed} passed, ${failed} failed`;
  if (verdict === "failed") return "see log";
  if (verdict === "unfinished") return "see log";
  return `${passed} passed` + (skipped ? `, ${skipped} skipped` : "");
}
function parseFlutterLog(logPath) {
  const result = emptyDigest();
  result.flavor = "flutter";
  const failures = [];
  const block = [];
  let counts = null;
  let verdict = "unfinished";
  let inBlock = false;
  const lines = readLogLines(logPath);
  if (lines === void 0) return result;
  for (const line of lines) {
    if (inBlock) {
      const stripped = line.trim();
      if (TEST_BLOCK_MORE_RE.test(stripped)) {
        inBlock = false;
        continue;
      }
      if (line.startsWith("  ") && stripped) {
        block.push(splitBlockEntry(stripped));
        continue;
      }
      inBlock = false;
    }
    if (line === TEST_BLOCK_HEADER) {
      inBlock = true;
      continue;
    }
    const failure = TEST_FAILURE_RE.exec(line);
    if (failure) {
      const { file, name: name2 } = splitPathAndName(failure.groups?.name ?? "");
      failures.push({
        file,
        name: name2,
        didNotComplete: Boolean(failure.groups?.unfinished)
      });
    }
    const progress = TEST_COUNTS_RE.exec(line);
    if (progress) {
      counts = {
        passed: Number(progress[1] ?? 0),
        skipped: Number(progress[2] ?? 0),
        failed: Number(progress[3] ?? 0)
      };
    }
    if (TEST_PASSED_MARKERS.some((marker) => line.includes(marker))) verdict = "passed";
    else if (TEST_FAILED_MARKERS.some((marker) => line.includes(marker))) verdict = "failed";
  }
  result.failures = attachPaths(failures, block);
  result.counts = counts;
  result.summary = summarizeTestRun(counts, verdict);
  return result;
}
function looksLikeVitest(logPath) {
  const lines = readLogLines(logPath);
  if (lines === void 0) return false;
  for (const line of lines) {
    if (VITEST_TESTS_LINE_RE.test(line) || VITEST_FILES_LINE_RE.test(line) || VITEST_SECTION_RE.test(line)) {
      return true;
    }
  }
  return false;
}
function splitVitestFailure(rest) {
  const separator = rest.indexOf(" > ");
  if (separator >= 0) {
    const tail = rest.slice(separator + 3);
    if (tail) return { file: rest.slice(0, separator).trim(), name: tail.trim() };
  }
  return { file: null, name: rest };
}
function parseVitestCounts(body) {
  if (body.includes(VITEST_NO_TESTS)) return { passed: 0, skipped: 0, failed: 0 };
  const counts = { passed: 0, skipped: 0, failed: 0 };
  for (const match of body.matchAll(VITEST_COUNT_RE)) {
    const number = Number(match[1] ?? 0);
    const kind = match[2];
    if (kind === "failed") counts.failed += number;
    else if (kind === "passed") counts.passed += number;
    else counts.skipped += number;
  }
  const total = VITEST_TOTAL_RE.exec(body);
  if (total !== null) {
    const unaccounted = Number(total[1] ?? 0) - counts.passed - counts.failed;
    if (unaccounted >= 0) counts.skipped = unaccounted;
  }
  return counts;
}
function parseVitestLog(logPath) {
  const result = emptyDigest();
  result.flavor = "vitest";
  const failures = [];
  let counts = null;
  let suitesFailed = 0;
  let inSuites = false;
  const lines = readLogLines(logPath);
  if (lines === void 0) return result;
  for (const line of lines) {
    const section = VITEST_SECTION_RE.exec(line);
    if (section) {
      inSuites = section.groups?.name === "Failed Suites";
      if (inSuites) suitesFailed = Number(section.groups?.count ?? 0);
      continue;
    }
    const failed = VITEST_FAIL_RE.exec(line);
    if (failed) {
      const rest = (failed.groups?.rest ?? "").trim();
      if (inSuites) {
        const file = rest.split(" [ ", 1)[0]?.trim() ?? "";
        failures.push({ file, name: VITEST_LOAD_PREFIX + file, didNotComplete: false });
      } else {
        const { file, name: name2 } = splitVitestFailure(rest);
        failures.push({ file, name: name2, didNotComplete: false });
      }
      continue;
    }
    const tests = VITEST_TESTS_LINE_RE.exec(line);
    if (tests) counts = parseVitestCounts(tests.groups?.body ?? "");
  }
  if (counts !== null && suitesFailed) counts.failed += suitesFailed;
  result.failures = failures;
  result.counts = counts;
  result.summary = summarizeTestRun(counts, counts === null ? "unfinished" : "passed");
  return result;
}
function parseCargoLog(logPath) {
  const result = emptyDigest();
  result.flavor = "cargo";
  const failures = [];
  const block = [];
  const lines = readLogLines(logPath);
  if (lines === void 0) return result;
  let counts = null;
  let verdict = "unfinished";
  let cargoSaidError = false;
  let file = null;
  let inBlock = false;
  let pending = [];
  for (const line of lines) {
    if (line === CARGO_FAILURES_HEADER) {
      inBlock = true;
      pending = [];
      continue;
    }
    if (inBlock) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (line.startsWith("    ") && !trimmed.startsWith("----")) {
        pending.push({ file, name: trimmed, didNotComplete: false });
        continue;
      }
      inBlock = false;
    }
    const summary = CARGO_RESULT_RE.exec(line);
    if (summary !== null) {
      const groups = summary.groups ?? {};
      const running = counts ?? { passed: 0, failed: 0, skipped: 0 };
      counts = {
        passed: running.passed + Number(groups["passed"] ?? 0),
        failed: running.failed + Number(groups["failed"] ?? 0),
        skipped: running.skipped + Number(groups["ignored"] ?? 0)
      };
      verdict = groups["verdict"] === "FAILED" ? "failed" : "passed";
      block.push(...pending);
      pending = [];
      continue;
    }
    if (CARGO_DOCTEST_RE.test(line)) {
      file = null;
      continue;
    }
    const target = CARGO_TARGET_RE.exec(line);
    if (target !== null) {
      const named = (target.groups?.["target"] ?? "").trim();
      file = named.startsWith(CARGO_UNITTESTS_PREFIX) ? named.slice(CARGO_UNITTESTS_PREFIX.length).trim() : named;
      continue;
    }
    const test = CARGO_TEST_RE.exec(line);
    if (test !== null) {
      if (test.groups?.["outcome"] === "FAILED") {
        failures.push({ file, name: (test.groups?.["name"] ?? "").trim(), didNotComplete: false });
      }
      continue;
    }
    const quiet = CARGO_QUIET_FAILED_RE.exec(line);
    if (quiet !== null) {
      failures.push({ file, name: (quiet.groups?.["name"] ?? "").trim(), didNotComplete: false });
      continue;
    }
    if (CARGO_ERROR_MARKERS.some((marker) => line.startsWith(marker))) {
      cargoSaidError = true;
    }
  }
  if (cargoSaidError && verdict !== "failed") verdict = "failed";
  result.failures = attachPaths(failures, block);
  result.counts = counts;
  result.summary = summarizeTestRun(counts, verdict);
  return result;
}
function analyzeTestLog(argv, logPath) {
  if (isTestRun(argv)) return parseFlutterLog(logPath);
  if (isCargoTestRun(argv)) return parseCargoLog(logPath);
  if (isVitestRun(argv) || mightRunVitest(argv) && looksLikeVitest(logPath)) {
    return parseVitestLog(logPath);
  }
  return emptyDigest();
}

// src/host/killtree.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";
var TREE_KILL_TIMEOUT_MS = 1e4;
var DETAIL_MAX_CHARS = 400;
var NO_TREE_KILL = () => Promise.resolve({ ok: true, detail: null });
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
function oneLine(text) {
  return text.replace(/\s+/gu, " ").trim().slice(0, DETAIL_MAX_CHARS);
}
function taskkillExe(env = process.env, exists = existsSync2) {
  const root = env["SystemRoot"] ?? env["windir"] ?? "";
  if (root === "") return null;
  const candidate = join2(root, "System32", "taskkill.exe");
  return exists(candidate) ? candidate : null;
}
function spawnTaskkill(command, args) {
  return spawn(command, [...args], {
    // Only stderr is read: it carries the reason a kill was refused ("Access is
    // denied", "not found"), while stdout is a human line nothing parses.
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
}
function taskkillTree(command, pid, options = {}) {
  const spawnHelper = options.spawn ?? spawnTaskkill;
  const timeoutMs = options.timeoutMs ?? TREE_KILL_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== void 0) clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawnHelper(command, ["/T", "/F", "/PID", String(pid)]);
    } catch (error) {
      resolve({ ok: false, detail: `cannot start taskkill: ${describe(error)}` });
      return;
    }
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < DETAIL_MAX_CHARS) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({ ok: false, detail: `taskkill failed: ${error.message}` });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true, detail: null });
        return;
      }
      const reason = oneLine(stderr);
      finish({
        ok: false,
        detail: `taskkill exited ${String(code)}${reason === "" ? "" : `: ${reason}`}`
      });
    });
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      finish({ ok: false, detail: `taskkill did not finish within ${timeoutMs} ms` });
    }, timeoutMs);
    timer.unref();
  });
}
function defaultTreeKill() {
  if (process.platform !== "win32") return NO_TREE_KILL;
  const command = taskkillExe();
  if (command === null) {
    return () => Promise.resolve({
      ok: false,
      detail: "taskkill.exe is not under %SystemRoot%\\System32, so the process tree was not swept"
    });
  }
  return (pid) => taskkillTree(command, pid);
}

// src/host/runner.ts
function planRun(spec, cwd, dartFormatExe) {
  const argv = [spec.cmd, ...spec.args];
  const { argv: resolvedArgv, env } = resolveLaunch(argv, dartFormatExe === "" ? null : dartFormatExe, cwd);
  const merged = { ...process.env, ...env, ...TOOL_ENV_OVERRIDES };
  return { argv, resolvedArgv, env: merged };
}
function spawnProcess(argv, cwd, env) {
  return spawn2(argv[0], argv.slice(1), {
    cwd,
    env,
    // Combined on purpose: the caller reads one stream, and the toolchains
    // interleave progress with diagnostics.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
}
var ProcessRun = class {
  constructor(resolvedArgv, cwd, env, logPath, options = {}) {
    this.resolvedArgv = resolvedArgv;
    this.cwd = cwd;
    this.env = env;
    this.logPath = logPath;
    this.spawnProcess = options.spawnProcess ?? spawnProcess;
    this.killTree = options.killTree ?? defaultTreeKill();
    this.settled = new Promise((resolve) => {
      this.settledResolve = resolve;
    });
  }
  child;
  sink;
  killed = false;
  settledResolve;
  /** The pending tree sweep; settlement waits for it. Resolved until a cancel asks for one. */
  sweep = Promise.resolve();
  /** Cancel notes waiting to be appended at the log's end; see {@link note}. */
  notes = [];
  spawnProcess;
  killTree;
  /** Resolves once the process has exited and its log is flushed. */
  settled;
  /** Start the process. Throws when the executable cannot be started at all. */
  start() {
    mkdirSync(dirname2(this.logPath), { recursive: true });
    this.sink = createWriteStream(this.logPath, { flags: "a" });
    let child;
    try {
      child = this.spawnProcess(this.resolvedArgv, this.cwd, this.env);
    } catch (error) {
      this.finish(null, `cannot start ${this.resolvedArgv[0] ?? "?"}: ${String(error)}`);
      throw new ToolFailure(`cannot start ${this.resolvedArgv[0] ?? "?"}: ${String(error)}`);
    }
    this.child = child;
    child.stdout?.on("data", (chunk) => this.sink?.write(chunk));
    child.stderr?.on("data", (chunk) => this.sink?.write(chunk));
    child.on("error", (error) => {
      this.finish(null, `cannot start ${this.resolvedArgv[0] ?? "?"}: ${error.message}`);
    });
    child.on("close", (code) => {
      this.finish(code, null);
    });
  }
  /** The process's pid, for the kill message. */
  get pid() {
    return this.child?.pid;
  }
  /**
   * Terminate the process this run owns **and every process below it**.
   *
   * Two steps, in a fixed order, because each covers the other's failure mode.
   * The tree sweep runs **first, and the owned kill waits for it**: `taskkill
   * /T` walks the parent-child chain from the root, and it resolves that pid
   * when it finally runs, not when it is spawned — measured here, a sweep
   * started alongside the kill came back `taskkill exited 128: process "N" not
   * found` because the root was already gone by the time the helper looked, and
   * every descendant was then missed. So the walk gets its moment, and the
   * owned handle is the fallback that ends the direct child when the sweep is
   * refused, missing, or too slow (see `killtree.ts` for why that fallback
   * still matters under a sandbox). Nothing waits on it beyond the sweep:
   * settlement waits for the same promise, so the job's own timing is unchanged.
   *
   * The method stays synchronous because the job registry's `cancel` contract
   * says so; only the OS work behind it is deferred.
   */
  cancel() {
    if (this.killed) return false;
    this.killed = true;
    const child = this.child;
    if (child === void 0 || child.exitCode !== null || child.signalCode !== null) {
      if (child === void 0) this.finish(null, null);
      return false;
    }
    const endOwned = () => {
      try {
        child.kill();
      } catch {
      }
    };
    const pid = child.pid;
    if (pid === void 0) {
      endOwned();
      return true;
    }
    this.sweep = this.killTree(pid).then(
      (outcome) => {
        if (!outcome.ok && outcome.detail !== null) this.note(outcome.detail);
        endOwned();
      },
      (error) => {
        this.note(`process tree was not swept: ${String(error)}`);
        endOwned();
      }
    );
    return true;
  }
  /**
   * Record a cancel's own outcome in the run's log.
   *
   * The log is the one artifact that outlives the process, so it is where "the
   * tree was not swept" has to be legible: a later reader who finds a
   * still-running child has the reason rather than the same mystery this
   * comment opened with. It is only worth a line when it is bad news.
   *
   * The line is queued rather than written, and that is not stylistic: the log
   * is an append stream whose file does not exist until its asynchronous open
   * completes, so a direct write here could land *before* bytes the process had
   * already produced — measured, with a note that arrived first in a log whose
   * first line was printed before the kill. Queuing keeps the log's one real
   * contract, that it is the process's output in order, and the queue is flushed
   * at settlement, after the stream has finished for good.
   */
  note(detail) {
    this.notes.push(detail);
  }
  /** Append every queued note at the log's end. Best-effort: this is a diagnostic. */
  flushNotes() {
    if (this.notes.length === 0) return;
    const text = this.notes.splice(0).map((detail) => `[toolbridge] ${detail}
`).join("");
    try {
      appendFileSync(this.logPath, text, "utf8");
    } catch {
    }
  }
  finish(code, error) {
    const sink = this.sink;
    this.sink = void 0;
    const settle = () => {
      const resolve = this.settledResolve;
      this.settledResolve = void 0;
      void this.sweep.then(() => {
        this.flushNotes();
        resolve?.({ exitCode: code, killed: this.killed, error });
      });
    };
    if (sink === void 0) {
      settle();
      return;
    }
    sink.end(settle);
  }
};
function readTestDigest(argv, logPath) {
  const digest = analyzeTestLog([...argv], logPath);
  return { summary: digest.summary, counts: digest.counts, failures: digest.failures };
}

// src/host/bridge.ts
var BridgeEngine = class {
  constructor(ctx, lanes, options) {
    this.ctx = ctx;
    this.lanes = lanes;
    this.options = options;
    mkdirSync2(this.options.logDir, { recursive: true });
  }
  records = /* @__PURE__ */ new Map();
  /**
   * Submit a command: normalise, guard, resolve, and register it as a job.
   *
   * The guardrail runs at submit time, so a refused command costs a request
   * rather than a queued job — the same reason the uncommitted scope is computed
   * here, where "nothing is uncommitted" can still be refused instead of
   * becoming a job that formats the whole tree.
   * @param request - the caller's command.
   * @param agent - the calling agent: its session owns the job and supplies the working directory.
   * @returns the job's initial view, with its id and its place in line.
   */
  async submitCommand(request, agent) {
    const argv = buildArgv(request.cmd, request.args, request.message ?? null);
    validate(argv);
    const cmd = argv[0];
    const args = argv.slice(1);
    const cwd = workingDirectory(agent);
    let grep = null;
    const scope = request.scope ?? null;
    if (scope !== null) {
      if (scope !== SCOPE_UNCOMMITTED) {
        refuse(400, `unknown scope: ${JSON.stringify(scope)} (supported: ${SCOPE_UNCOMMITTED})`);
      }
      const mode = scopeMode(cmd, args);
      if (mode === null) refuse(403, scopeRefusal(cmd, args));
      const files = await uncommittedDartFiles(cwd);
      if (files.length === 0) {
        refuse(400, "no uncommitted .dart files to scope this command to");
      }
      if (mode === "expand") {
        args.push(...files);
      } else {
        grep = pathFilterRegex(files).source;
      }
    }
    const plan = planRun({ cmd, args }, cwd, this.options.dartFormatExe);
    const lane = request.long ?? wantsLongLane(cmd, args) ? LANE_LONG : LANE_QUEUE;
    return this.register({
      owner: agent.id,
      cwd,
      lane,
      kind: "cmd",
      scope,
      argv: plan.argv,
      resolvedArgv: plan.resolvedArgv,
      env: plan.env,
      mirrorOutput: true,
      body: async (record, job) => {
        const run = new ProcessRun(record.resolvedArgv ?? [], record.cwd, record.env, record.logPath);
        record.run = run;
        job.updateProgress(`${record.argv[0] ?? ""} ${record.argv[1] ?? ""}`.trim());
        run.start();
        const settlement = await run.settled;
        record.exitCode = settlement.exitCode;
        record.error = settlement.error;
        record.status = settlement.killed ? "killed" : settlement.error !== null ? "failed" : settlement.exitCode === 0 ? "done" : "failed";
        this.annotate(record);
      }
    });
  }
  /**
   * Submit a job whose body this engine runs itself.
   *
   * A sub-tool is a Job like any other — it queues behind a running build, it is
   * killed by the same id, its log is its own — and the only difference is what
   * the single worker executes. `argv` is a display line nothing spawns.
   * @param args - the display argv and the body to run.
   * @returns the job's initial view.
   */
  submitSubTool(args) {
    return this.register({
      owner: args.owner,
      cwd: args.cwd,
      lane: LANE_QUEUE,
      kind: "arb-edit",
      scope: null,
      argv: args.displayArgv,
      resolvedArgv: [],
      env: process.env,
      // A sub-tool narrates through `JobHandle.append` (its own lines about what
      // it edited), so a second source over the gen-l10n log would interleave
      // two accounts of the same job. Its log is for the `tail`/`grep` view.
      mirrorOutput: false,
      body: args.body
    });
  }
  /** Unfinished depth of both lanes for one directory, for the sidebar. */
  depth(cwd) {
    return this.lanes.snapshot(cwd);
  }
  /** Every job this engine still holds, oldest first. */
  list() {
    return [...this.records.values()].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)).map((record) => this.view(record));
  }
  /**
   * One conversation's jobs, for the sidebar panel.
   *
   * Ownership is deliberately absent from {@link BridgeJobView}: the model reads
   * that shape, and which session owns a job is not its business. The panel asks
   * by owner instead, here, where the ledger knows.
   * @param owner - the session whose jobs to list.
   * @returns those jobs, oldest first.
   */
  listForOwner(owner) {
    return [...this.records.values()].filter((record) => record.owner === owner).sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)).map((record) => this.view(record));
  }
  /**
   * One job's view, with the caller's log knobs applied.
   * @param id - the job id.
   * @param grep - an optional pattern selecting log lines.
   * @param tail - how many lines to return.
   * @returns the view, or undefined for a job this engine never had.
   */
  read(id, grep, tail) {
    const record = this.records.get(id);
    if (record === void 0) return void 0;
    return this.view(record, { grep, tail });
  }
  /**
   * The view a tool returns, or a failure naming the unknown id.
   * @param id - the job id.
   * @param grep - an optional pattern selecting log lines.
   * @param tail - how many lines to return.
   * @returns the view.
   */
  result(id, grep, tail) {
    const view = this.read(id, grep, tail);
    if (view === void 0) throw new ToolFailure(`unknown job: ${id}`);
    return view;
  }
  /**
   * Stop one job and its process, through the job registry so the registry's own
   * bookkeeping (status, completion notice, roster) stays authoritative.
   * @param id - the job to stop.
   * @param reason - recorded in the job's terminal detail.
   * @returns whether a kill was requested.
   */
  kill(id, reason) {
    const record = this.records.get(id);
    if (record === void 0 || record.id === null) return false;
    try {
      return this.ctx.jobs.kill(record.id, record.owner, reason) === "requested";
    } catch {
      return false;
    }
  }
  /**
   * Drop a settled job's record once its caller has collected the result.
   *
   * A foreground run's result is already in the model's hands, so leaving it in
   * the roster would only repeat it; a job the model may still read is kept.
   * @param id - the settled job to forget.
   */
  forget(id) {
    const record = this.records.get(id);
    if (record === void 0 || record.id === null) return;
    this.records.delete(id);
    try {
      this.ctx.jobs.remove(record.id, record.owner);
    } catch {
    }
  }
  register(options) {
    const record = {
      id: null,
      owner: options.owner,
      cwd: options.cwd,
      lane: options.lane,
      kind: options.kind,
      scope: options.scope,
      long: options.lane === LANE_LONG,
      logPath: join3(this.options.logDir, `${Date.now()}-${randomUUID().slice(0, 8)}.log`),
      argv: options.argv,
      env: options.env,
      resolvedArgv: options.resolvedArgv,
      status: "queued",
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      summary: null,
      counts: null,
      failures: [],
      baseline: null,
      error: null,
      result: null,
      aheadOf: this.lanes.depth(options.cwd, options.lane),
      run: null,
      cancelled: false
    };
    this.ctx.jobs.start({
      kind: "bridge",
      label: record.argv.join(" "),
      owner: options.owner,
      // The ring is fed from the log the run writes, and the registry owns the
      // cadence: this is what makes `job_output` see a bridge job's output at
      // all (see `jobsource.ts` for the measurement that made it a fix rather
      // than a feature).
      output: logMirror(options.mirrorOutput ? record.logPath : null),
      run: (job) => {
        record.id = job.id;
        this.records.set(job.id, record);
        const queued = this.lanes.enqueue(options.cwd, options.lane, async () => {
          if (record.cancelled) return;
          record.status = "running";
          record.startedAt = Date.now();
          try {
            await options.body(record, job);
          } finally {
            record.finishedAt = Date.now();
          }
        });
        record.aheadOf = queued.aheadOf;
        return {
          cancel: (reason) => {
            record.cancelled = true;
            if (record.status === "queued") record.status = "killed";
            if (reason !== void 0 && reason !== "") record.error = reason;
            record.run?.cancel();
          },
          done: queued.result.then(
            () => this.terminal(record),
            (error) => ({
              status: record.cancelled ? "killed" : "failed",
              detail: error instanceof Error ? error.message : String(error)
            })
          )
        };
      }
    });
    return this.view(record);
  }
  /** A job's terminal outcome, as the registry records it. */
  terminal(record) {
    if (record.status === "killed") {
      return { status: "killed", ...record.error === null ? {} : { detail: record.error } };
    }
    if (record.status === "failed") {
      return {
        status: "failed",
        detail: record.exitCode === null ? record.error ?? "failed" : `exit code: ${record.exitCode}`
      };
    }
    return {
      status: "completed",
      ...record.exitCode === null || record.exitCode === 0 ? {} : { detail: `exit code: ${record.exitCode}` }
    };
  }
  /** Read a finished job's log back as a digest, plus the known-failure split. */
  annotate(record) {
    const digest = readTestDigest(record.argv, record.logPath);
    record.counts = digest.counts;
    record.failures = digest.failures;
    const registry = loadKnownFailures(record.cwd);
    if (registry.exists) {
      record.baseline = baselineReport(record.failures, record.counts, registry);
      record.summary = summarizeWithBaseline(digest.summary, record.baseline);
    } else {
      record.baseline = null;
      record.summary = digest.summary;
    }
  }
  view(record, log) {
    const end = record.finishedAt ?? Date.now();
    const view = {
      id: record.id ?? "",
      kind: record.kind,
      argv: record.argv,
      resolvedArgv: record.resolvedArgv,
      status: record.status,
      lane: record.lane,
      long: record.long,
      scope: record.scope,
      aheadOf: record.aheadOf,
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      durationSec: record.startedAt === null ? null : Math.round((end - record.startedAt) / 100 / 10),
      summary: record.summary,
      counts: record.counts,
      error: record.error,
      logPath: record.logPath
    };
    if (record.kind === "arb-edit") view.result = record.result;
    if (log !== void 0) {
      const pattern = log.grep === null ? null : compileGrep(log.grep);
      const read = readFiltered(record.logPath, pattern, clampTail(log.tail));
      view.tail = read.text;
      view.log = read.log;
      if (record.kind === "cmd") {
        view.failures = record.failures;
        view.baseline = record.baseline;
      }
    }
    return view;
  }
};
function compileGrep(pattern) {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new RefusalError(400, `grep is not a valid regex: ${String(error)}`);
  }
}
function workingDirectory(agent) {
  return agent.session.header.cwd ?? process.cwd();
}

// src/host/config.ts
import z from "@deepseek-ai/schemastery";
var PlaywrightConfig = z.object({
  /**
   * Browser channel. `msedge` drives the Edge Windows already ships, so no
   * `playwright install` download and no browser cache (measured: the channel
   * launches with no download).
   */
  browser: z.string().default("msedge"),
  /**
   * Capabilities to enable. `vision` adds the coordinate mouse tools — the only
   * pointer a canvas-rendered page can be driven with — and `devtools` adds the
   * video/trace recorders. Measured: 44 tools with both, ~25 for core alone.
   */
  caps: z.string().default("vision,devtools"),
  /**
   * Where video, trace and PDF files are written. Deliberately outside any
   * session workspace: an artifact for the human is copied in on purpose, and
   * the copy is the model's step (README, "The browser half").
   */
  outputDir: z.string().default(""),
  /**
   * A screenshot or a stopped video can take longer than the 60 s MCP default.
   */
  toolCallTimeoutMs: z.number().min(1).default(12e4),
  /** Extra arguments appended after the flags above, for an unusual setup. */
  args: z.array(z.string()).default([])
});
var Config = z.object({
  /**
   * Where the plugin keeps its own state (the per-session toggle record). Empty
   * means `$DSH_HOME/toolbridge`, or `~/.dsh/toolbridge` without that variable.
   * The plugin process is not confined, so this is an ordinary directory.
   */
  stateDir: z.string().default(""),
  /** Whether a new conversation starts with each half on. */
  defaults: z.object({
    /**
     * The toolchain half. On by default: it is the reason the plugin exists,
     * and its two tool schemas are cheap next to a browser catalog.
     */
    bridge: z.boolean().default(true),
    /**
     * The browser half. Off by default, because turning it on is what makes a
     * session pay for Playwright MCP's tool catalog and spawn a server.
     */
    browser: z.boolean().default(false)
  }).default({}),
  /**
   * The formatter pin: a standalone `dart.exe` whose version matches the one a
   * project's CI formats with. `dart format` output changes between releases, so
   * formatting with a newer local SDK is what turns CI's
   * `dart format --set-exit-if-changed` check red. Only `dart format` routes to
   * the pin; every other `dart`/`flutter` command keeps the PATH SDK, because
   * `dart analyze` also depends on the Flutter framework version resolved
   * through the package config, which a formatter pin cannot align.
   */
  dartFormatExe: z.string().default(""),
  /** The browser half's MCP server. */
  playwright: PlaywrightConfig.default({}),
  /**
   * How long a foreground `bridge_run` may wait before returning the job as it
   * stands, in seconds. The job is never killed by this: the caller reads it on
   * with `job_output`.
   */
  defaultTimeoutSec: z.number().min(1).default(600)
});

// src/host/browser.ts
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import { createScope } from "@deepseek-ai/dsh-scope";
var BROWSER_SERVER_NAME = "ui";
function playwrightArgs(config) {
  const args = [
    "-y",
    "@playwright/mcp@latest",
    `--browser=${config.playwright.browser}`,
    `--caps=${config.playwright.caps}`
  ];
  if (config.playwright.outputDir !== "") {
    args.push(`--output-dir=${config.playwright.outputDir}`);
  }
  args.push(...config.playwright.args);
  return args;
}
async function mountBrowser(ctx, agent, config) {
  const scope = createScope(ctx, agent);
  try {
    await scope.ctx.plugin(
      McpClient,
      McpClient.Config({
        transport: "stdio",
        serverName: BROWSER_SERVER_NAME,
        command: "npx",
        args: playwrightArgs(config),
        ...agent.session.header.cwd === void 0 ? {} : { cwd: agent.session.header.cwd },
        toolCallTimeoutMs: config.playwright.toolCallTimeoutMs,
        // A browser that cannot start must not take the conversation with it:
        // unlike the harness's resident provider, this is an optional half, and
        // the caller reads the failure from the plugin's log instead.
        failOnStartupError: true,
        reconnect: { enabled: false }
      })
    );
  } catch (error) {
    await scope.dispose();
    throw error;
  }
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await scope.dispose();
  };
}

// src/host/sessions.ts
var BRIDGE_TOOL_NAMES = ["bridge_run", "bridge_arb_edit"];
var SessionSwitches = class {
  constructor(ctx, engine, store, config) {
    this.ctx = ctx;
    this.engine = engine;
    this.store = store;
    this.config = config;
  }
  applied = /* @__PURE__ */ new Map();
  /** Live agents by session id, so a panel read can report a session's directory. */
  live = /* @__PURE__ */ new Map();
  /** Why a conversation's last browser mount failed; cleared by a successful mount or a switch-off. */
  browserErrors = /* @__PURE__ */ new Map();
  /**
   * Bring one freshly created agent in line with its conversation's switches.
   *
   * Registered on the serial `agent/created` event, so the tools and the
   * connection exist before the conversation's first model request — a
   * restriction applied later would still cost the schemas of the request that
   * raced it.
   * @param agent - the created agent.
   */
  async onAgentCreated(agent) {
    const cwd = agent.session.header.cwd;
    if (cwd !== void 0) this.store.remember(agent.id, cwd);
    this.live.set(agent.id, agent);
    const state = this.store.get(agent.id);
    agent.ctx.effect(() => async () => {
      await this.detach(agent.id);
    }, "toolbridge switches");
    if (!state.bridge) this.applyRestriction(agent);
    if (state.browser) await this.attachBrowser(agent);
  }
  /** Release whatever one session had applied, on its disposal. */
  async onAgentDisposed(agent) {
    this.live.delete(agent.id);
    await this.detach(agent.id);
  }
  /**
   * Flip one switch and apply it to the live conversation when there is one.
   * @param sessionId - the conversation.
   * @param key - which half.
   * @param value - its new state.
   * @returns the conversation's complete switch state.
   */
  async set(sessionId, key, value) {
    const toggles = this.store.set(sessionId, key, value);
    const agent = this.ctx.agents.get(sessionId);
    if (agent !== void 0) {
      if (key === "bridge") {
        if (value) this.applied.get(sessionId)?.unrestrict?.();
        else this.applyRestriction(agent);
      } else if (value) {
        await this.attachBrowser(agent);
      } else {
        await this.detachBrowser(sessionId);
      }
    }
    return toggles;
  }
  /**
   * Everything the sidebar needs about one conversation.
   *
   * The conversation is named by the caller and never inferred here. It used to
   * accept an empty id and fall back to "the only live session", which is what
   * made a panel with no conversation render as a well-formed `Jobs (0)` rather
   * than as the absence it was: the browser half asked with no id exactly when it
   * did not know which pane it was in, and this answered confidently about a
   * different question (ADR-0012).
   * @param sessionId - the conversation, named by the seat the panel is drawn in.
   * @returns the panel's view.
   */
  async state(sessionId) {
    const toggles = this.store.get(sessionId);
    const known = this.store.cwd(sessionId);
    const live = this.live.get(sessionId) ?? this.ctx.agents.get(sessionId);
    const cwd = live?.session.header.cwd ?? known;
    return {
      sessionId,
      toggles,
      defaults: this.store.defaultState,
      cwd: cwd ?? null,
      lanes: cwd === void 0 ? { queue: 0, long: 0 } : this.engine.depth(cwd),
      browserMounted: this.applied.get(sessionId)?.unmountBrowser !== void 0,
      browserError: this.browserErrors.get(sessionId) ?? null
    };
  }
  applyRestriction(agent) {
    const applied = this.applied.get(agent.id) ?? {};
    if (applied.unrestrict !== void 0) return;
    applied.unrestrict = agent.ctx.tools.restrict({ deny: [...BRIDGE_TOOL_NAMES] });
    this.applied.set(agent.id, applied);
  }
  async attachBrowser(agent) {
    const applied = this.applied.get(agent.id) ?? {};
    if (applied.unmountBrowser !== void 0) return;
    try {
      const unmount = await mountBrowser(this.ctx, agent, this.config);
      this.applied.set(agent.id, { ...applied, unmountBrowser: unmount });
      this.browserErrors.delete(agent.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.browserErrors.set(agent.id, reason);
      this.ctx.logger.error(
        `toolbridge: browser MCP for ${BROWSER_SERVER_NAME} failed to start for session ${agent.id}: ${reason}`
      );
    }
  }
  async detachBrowser(sessionId) {
    this.browserErrors.delete(sessionId);
    const applied = this.applied.get(sessionId);
    if (applied === void 0) return;
    const unmount = applied.unmountBrowser;
    if (unmount === void 0) return;
    applied.unmountBrowser = void 0;
    await unmount();
  }
  async detach(sessionId) {
    const applied = this.applied.get(sessionId);
    if (applied === void 0) return;
    this.applied.delete(sessionId);
    applied.unrestrict?.();
    await applied.unmountBrowser?.();
  }
};

// src/host/toggles.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync5, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname3, join as join4 } from "node:path";
var EMPTY = { version: 1, sessions: {} };
var ToggleStore = class {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.document = this.load();
  }
  document;
  load() {
    try {
      const raw = JSON.parse(readFileSync5(this.file, "utf8"));
      if (raw.version !== 1 || typeof raw.sessions !== "object" || raw.sessions === null) return { ...EMPTY };
      return { version: 1, sessions: raw.sessions };
    } catch {
      return { ...EMPTY };
    }
  }
  persist() {
    mkdirSync3(dirname3(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.document, null, 2), "utf8");
    renameSync(temporary, this.file);
  }
  /**
   * The switches for one session.
   * @param sessionId - the conversation's session id.
   * @returns its state, or the configured defaults when it never changed one.
   */
  get(sessionId) {
    const record = this.document.sessions[sessionId];
    if (record === void 0) return { ...this.defaults };
    return { bridge: record.bridge, browser: record.browser };
  }
  /** The directory this session was last seen in, for the sidebar. */
  cwd(sessionId) {
    return this.document.sessions[sessionId]?.cwd;
  }
  /** Remember the directory a session runs in, without touching its switches. */
  remember(sessionId, cwd) {
    const record = this.document.sessions[sessionId];
    if (record?.cwd === cwd) return;
    this.document.sessions[sessionId] = {
      ...record ?? { ...this.defaults, changedAt: Date.now() },
      cwd,
      changedAt: record?.changedAt ?? Date.now()
    };
    this.persist();
  }
  /**
   * Set one switch for one session and write it durably.
   * @param sessionId - the conversation.
   * @param key - which half.
   * @param value - its new state.
   * @returns the session's complete state after the change.
   */
  set(sessionId, key, value) {
    const record = this.document.sessions[sessionId] ?? { ...this.defaults, changedAt: Date.now() };
    this.document.sessions[sessionId] = { ...record, [key]: value, changedAt: Date.now() };
    this.persist();
    return this.get(sessionId);
  }
  /** The configured defaults, for the sidebar and the API. */
  get defaultState() {
    return { ...this.defaults };
  }
};
function toggleFile(stateDir) {
  return join4(stateDir, "toggles.json");
}

// src/host/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";

// src/engine/arbedit.ts
import { existsSync as existsSync3, readFileSync as readFileSync6, readdirSync, statSync as statSync5, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, join as join5 } from "node:path";
var ALLOWED_TOP_FIELDS = /* @__PURE__ */ new Set(["groups", "dryRun"]);
var KEY_PATTERN = /^\s*"([^"]+)"\s*:/;
var UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
function detectLineEnding(raw) {
  for (let index = 0; index + 1 < raw.length; index += 1) {
    if (raw[index] === 13 && raw[index + 1] === 10) return "\r\n";
  }
  return "\n";
}
function findKeyLine(lines, key) {
  for (const [index, line] of lines.entries()) {
    const match = KEY_PATTERN.exec(line);
    if (match !== null && match[1] === key) return index;
  }
  return void 0;
}
function findClosingBrace(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const stripped = (lines[index] ?? "").trim();
    if (stripped === "}") return index;
    if (stripped !== "") break;
  }
  return void 0;
}
function jsonStringEscape(text) {
  return JSON.stringify(text);
}
function lineIndent(line) {
  return /^(\s*)/.exec(line)?.[1] ?? "";
}
function rstrip(text) {
  return text.replace(/\s+$/, "");
}
function splitLines(text) {
  return text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
}
function pyRepr2(text) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  return `'${escaped}'`;
}
function isNone(value) {
  return value === void 0 || value === null;
}
function asRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  return value;
}
function pyFalsy(value) {
  if (value === void 0 || value === null || value === false) return true;
  if (value === 0 || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}
function newFieldsOrEmpty(raw) {
  return Array.isArray(raw) ? raw : [];
}
function isDirectory(path) {
  return existsSync3(path) && statSync5(path).isDirectory();
}
function nextNonBlankIsBrace(lines, index) {
  for (const line of lines.slice(index + 1)) {
    const stripped = line.trim();
    if (stripped === "") continue;
    return stripped === "}";
  }
  return false;
}
function braceCloseIndex(lines, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index] ?? "") {
      if (inString) {
        if (escape) escape = false;
        else if (char === "\\") escape = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
    }
    if (depth === 0) return index;
  }
  return void 0;
}
function extendToIncludeMetadata(lines, end) {
  let index = end + 1;
  while (index < lines.length && (lines[index] ?? "").trim() === "") index += 1;
  if (index >= lines.length) return end;
  const match = KEY_PATTERN.exec(lines[index] ?? "");
  if (match !== null && (match[1] ?? "").startsWith("@")) {
    const closing = braceCloseIndex(lines, index);
    if (closing !== void 0) return closing;
  }
  return end;
}
function stripTrailingCommaIfLast(lines) {
  const braceIndex = findClosingBrace(lines);
  if (braceIndex === void 0) return;
  for (let index = braceIndex - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const stripped = rstrip(line);
    if (stripped.endsWith(",")) lines[index] = stripped.slice(0, -1);
    return;
  }
}
function deleteRange(lines, deleteFrom, deleteTo) {
  const start = findKeyLine(lines, deleteFrom);
  const end = findKeyLine(lines, deleteTo);
  if (start === void 0) throw new Error(`deleteFrom key not found: ${pyRepr2(deleteFrom)}`);
  if (end === void 0) throw new Error(`deleteTo key not found: ${pyRepr2(deleteTo)}`);
  if (start > end) {
    throw new Error(
      `deleteFrom (${pyRepr2(deleteFrom)} at line ${start + 1}) comes after deleteTo (${pyRepr2(deleteTo)} at line ${end + 1})`
    );
  }
  const last = extendToIncludeMetadata(lines, end);
  const indent = lineIndent(lines[start] ?? "");
  const removedKeys = [];
  for (const line of lines.slice(start, last + 1)) {
    if (lineIndent(line) !== indent) continue;
    const match = KEY_PATTERN.exec(line);
    if (match !== null && match[1] !== void 0) removedKeys.push(match[1]);
  }
  const result = [...lines.slice(0, start), ...lines.slice(last + 1)];
  stripTrailingCommaIfLast(result);
  return { lines: result, removedKeys };
}
function insertAfterKey(lines, anchorKey, newEntries) {
  const working = [...lines];
  let insertIndex;
  let atEnd;
  let indent;
  let tailBeforeBrace;
  if (anchorKey === "__END__") {
    const closing = findClosingBrace(working);
    if (closing === void 0) throw new Error("could not find the closing brace of the ARB file");
    insertIndex = closing;
    atEnd = true;
    indent = "  ";
    let prevIndex = insertIndex - 1;
    while (prevIndex >= 0 && (working[prevIndex] ?? "").trim() === "") prevIndex -= 1;
    if (prevIndex >= 0) {
      const previous = working[prevIndex] ?? "";
      indent = lineIndent(previous);
      if (previous.trim() !== "{" && !rstrip(previous).endsWith(",")) {
        working[prevIndex] = `${rstrip(previous)},`;
      }
    }
    tailBeforeBrace = true;
  } else {
    const anchorIndex = findKeyLine(working, anchorKey);
    if (anchorIndex === void 0) {
      throw new Error(`insertAfter key not found: ${pyRepr2(anchorKey)}`);
    }
    indent = lineIndent(working[anchorIndex] ?? "");
    insertIndex = extendToIncludeMetadata(working, anchorIndex);
    const entry = rstrip(working[insertIndex] ?? "");
    if (!entry.endsWith(",")) working[insertIndex] = `${entry},`;
    atEnd = false;
    tailBeforeBrace = nextNonBlankIsBrace(working, insertIndex);
  }
  const newLines = [];
  for (const [position, entry] of newEntries.entries()) {
    const isLastNew = position === newEntries.length - 1;
    const omitComma = isLastNew && tailBeforeBrace;
    const [key, value] = entry;
    let line = `${indent}"${key}": ${jsonStringEscape(value)}`;
    if (!omitComma) line += ",";
    newLines.push(line);
  }
  if (atEnd) {
    return [...working.slice(0, insertIndex), ...newLines, ...working.slice(insertIndex)];
  }
  return [
    ...working.slice(0, insertIndex + 1),
    ...newLines,
    ...working.slice(insertIndex + 1)
  ];
}
function validateInstructions(body) {
  const record = asRecord(body);
  if (record === void 0) refuse(400, "instruction body must be a JSON object");
  if ("cwd" in record) {
    refuse(
      400,
      "'cwd' is not accepted: the bridge pins the working directory at boot (start a bridge with --cwd <project> to edit that project)"
    );
  }
  const unknownFields = Object.keys(record).filter((field) => !ALLOWED_TOP_FIELDS.has(field)).sort();
  if (unknownFields.length > 0) {
    refuse(
      400,
      `unknown field(s): ${unknownFields.join(", ")} (allowed: ${[...ALLOWED_TOP_FIELDS].sort().join(", ")})`
    );
  }
  const dryRun = "dryRun" in record ? record.dryRun : false;
  if (typeof dryRun !== "boolean") refuse(400, "'dryRun' must be a boolean");
  const groupsValue = record.groups;
  if (!Array.isArray(groupsValue) || groupsValue.length === 0) {
    refuse(400, "'groups' must be a non-empty list");
  }
  const groups = groupsValue;
  for (const [groupIndex, group] of groups.entries()) validateGroup(groupIndex, group);
  const named = /* @__PURE__ */ new Set();
  let hasPureDelete = false;
  for (const group of groups) {
    const groupRecord = asRecord(group);
    if (groupRecord === void 0) continue;
    const fields = newFieldsOrEmpty(groupRecord.newFields);
    if (fields.length === 0) hasPureDelete = true;
    for (const field of fields) {
      const value = asRecord(asRecord(field)?.value);
      if (value === void 0) continue;
      for (const arbName of Object.keys(value)) named.add(arbName);
    }
  }
  if (named.size === 0 && !hasPureDelete) refuse(400, "no ARB files referenced in newFields");
  return { groups, dryRun };
}
function validateGroup(groupIndex, group) {
  const where = `groups[${groupIndex}]`;
  const record = asRecord(group);
  if (record === void 0) refuse(400, `${where} must be an object`);
  const rawFields = record.newFields;
  const fieldsValue = pyFalsy(rawFields) ? [] : rawFields;
  if (!Array.isArray(fieldsValue)) refuse(400, `${where}.newFields must be a list`);
  const fields = fieldsValue;
  const deleteFrom = record.deleteFrom;
  const deleteTo = record.deleteTo;
  if (isNone(deleteFrom) !== isNone(deleteTo)) {
    refuse(400, `${where}: deleteFrom and deleteTo must be provided together`);
  }
  for (const name2 of [deleteFrom, deleteTo]) {
    if (!isNone(name2) && (typeof name2 !== "string" || name2 === "")) {
      refuse(400, `${where}: deleteFrom/deleteTo must be non-empty strings`);
    }
  }
  const insertAfter = record.insertAfter;
  if (!isNone(insertAfter) && (typeof insertAfter !== "string" || insertAfter === "")) {
    refuse(400, `${where}: insertAfter must be a non-empty string`);
  }
  if (fields.length > 0 && isNone(insertAfter)) {
    refuse(
      400,
      `${where}: insertAfter is required when newFields is given (use the key before the insertion point, or __END__)`
    );
  }
  if (fields.length === 0 && isNone(deleteFrom)) {
    refuse(400, `${where}: a group needs newFields or a deleteFrom/deleteTo range`);
  }
  for (const [fieldIndex, field] of fields.entries()) {
    validateField(`${where}.newFields[${fieldIndex}]`, field);
  }
}
function validateField(where, field) {
  const record = asRecord(field);
  if (record === void 0) refuse(400, `${where} must be an object`);
  const key = record.key;
  if (typeof key !== "string" || key === "") refuse(400, `${where}.key must be a non-empty string`);
  if (key.startsWith("@")) {
    refuse(
      400,
      `${where}.key must not start with '@': gen-l10n writes @key metadata itself, and a hand-written string value is not a Map`
    );
  }
  const value = asRecord(record.value);
  if (value === void 0 || Object.keys(value).length === 0) {
    refuse(
      400,
      `${where}.value must be a non-empty map of ARB file name -> translation string`
    );
  }
  for (const [arbName, text] of Object.entries(value)) {
    if (arbName === "") refuse(400, `${where}.value keys must be ARB file names`);
    if (typeof text !== "string") {
      refuse(400, `${where}.value[${pyRepr2(arbName)}] must be a string`);
    }
  }
}
function parseL10nYaml(cwd) {
  const l10nPath = join5(cwd, "l10n.yaml");
  if (!existsSync3(l10nPath)) throw new Error(`l10n.yaml not found at ${l10nPath}`);
  const config = {};
  for (const line of splitLines(readFileSync6(l10nPath, "utf8"))) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator >= 0) {
      config[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return config;
}
function fileGroupsFor(groups, arbName) {
  const adapted = [];
  for (const group of groups) {
    const fields = [];
    const declared = newFieldsOrEmpty(group.newFields);
    for (const field of declared) {
      const text = field.value[arbName];
      if (text === void 0) continue;
      fields.push({ key: field.key, value: text });
    }
    const hasDelete = !isNone(group.deleteFrom) && !isNone(group.deleteTo);
    if (fields.length === 0 && !hasDelete) continue;
    adapted.push({ ...group, newFields: fields });
  }
  return adapted;
}
function applyFileGroups(raw, fileGroups) {
  const eol = detectLineEnding(raw);
  let lines = UTF8_DECODER.decode(raw).split(eol);
  const inserts = [];
  const deletes = [];
  for (const group of fileGroups) {
    const deleteFrom = group.deleteFrom;
    const deleteTo = group.deleteTo;
    if (deleteFrom && deleteTo) {
      const removal = deleteRange(lines, deleteFrom, deleteTo);
      lines = removal.lines;
      deletes.push(...removal.removedKeys);
    }
    const fields = group.newFields;
    if (fields.length > 0) {
      const anchor = group.insertAfter;
      if (anchor === void 0) {
        throw new Error("insertAfter is required when newFields is given");
      }
      const entries = fields.map((field) => [field.key, field.value]);
      lines = insertAfterKey(lines, anchor, entries);
      inserts.push(...fields.map((field) => field.key));
    }
  }
  return { newBytes: new TextEncoder().encode(lines.join(eol)), inserts, deletes };
}
function appArbNames(arbDir) {
  return readdirSync(arbDir).filter((name2) => /^app_.*\.arb$/.test(name2));
}
function planArbEdits(cwd, instruction) {
  const normalized = validateInstructions(instruction);
  const config = parseL10nYaml(cwd);
  const arbDir = join5(cwd, config["arb-dir"] ?? "lib/l10n");
  if (!isDirectory(arbDir)) throw new Error(`ARB directory not found: ${arbDir}`);
  const groups = normalized.groups;
  let named = /* @__PURE__ */ new Set();
  for (const group of groups) {
    const fields = newFieldsOrEmpty(group.newFields);
    if (fields.length === 0) continue;
    for (const field of fields) {
      const value = asRecord(asRecord(field)?.value);
      if (value === void 0) continue;
      for (const arbName of Object.keys(value)) named.add(arbName);
    }
  }
  if (named.size === 0) {
    named = new Set(appArbNames(arbDir));
  }
  const files = [];
  const skipped = [];
  for (const arbName of [...named].sort()) {
    const arbPath = join5(arbDir, arbName);
    if (!existsSync3(arbPath)) {
      skipped.push({ file: arbName, reason: "not found" });
      continue;
    }
    const raw = readFileSync6(arbPath);
    let applied;
    try {
      applied = applyFileGroups(raw, fileGroupsFor(groups, arbName));
    } catch (error) {
      if (error instanceof RefusalError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${arbName}: ${message}`, { cause: error });
    }
    files.push({
      name: arbName,
      path: arbPath,
      newBytes: applied.newBytes,
      inserts: applied.inserts,
      deletes: applied.deletes
    });
  }
  const untranslated = config["untranslated-messages-file"];
  return {
    files,
    skipped,
    untranslatedFile: untranslated ? join5(cwd, untranslated) : null
  };
}
function applyArbEdits(plan) {
  const edited = [];
  for (const entry of plan.files) {
    writeFileSync2(entry.path, entry.newBytes);
    edited.push(entry.name);
  }
  return edited;
}
function readUntranslated(path) {
  if (path === null || !existsSync3(path)) return null;
  const content = readFileSync6(path, "utf8").trim();
  if (content === "" || content === "{}" || content === "[]") return null;
  return { file: basename2(path), lines: splitLines(content).length, content };
}

// src/host/tools.ts
var FailureItemSchema = {
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      file: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
      name: { type: "string", required: true },
      didNotComplete: { type: "boolean", required: true },
      known: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true },
          reason: { required: true, oneOf: [{ type: "string" }, { type: "null" }] }
        },
        description: "Present when the known-failure registry claimed this failure; absent means it is new."
      }
    }
  }
};
var JobOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", required: true, description: "Job id: read it later with job_output, stop it with job_kill." },
    status: {
      type: "string",
      required: true,
      enum: ["queued", "running", "done", "failed", "killed"],
      description: "Job status."
    },
    lane: {
      type: "string",
      required: true,
      enum: ["queue", "long"],
      description: "Which serialized lane it ran on."
    },
    argv: { type: "array", required: true, items: { type: "string" }, description: "The request after normalisation." },
    resolvedArgv: {
      required: true,
      oneOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
      description: "What actually started, or null while the job is still queued."
    },
    aheadOf: {
      type: "number",
      required: true,
      description: "Unfinished jobs ahead of it on its own lane, at submit time."
    },
    exitCode: { type: "number", description: "Process exit code; absent while running." },
    durationSec: { type: "number", description: "Seconds from start to finish, or to now while it runs." },
    summary: {
      type: "string",
      description: 'The one-line digest of a test run: "83 passed, 4 failed (3 known, 1 new)".'
    },
    counts: {
      type: "object",
      additionalProperties: false,
      properties: {
        passed: { type: "number", required: true },
        skipped: { type: "number", required: true },
        failed: { type: "number", required: true }
      },
      description: "Read from the reporter's last progress line: the authoritative totals."
    },
    error: { type: "string", description: "Why the job failed, when it did." },
    tail: { type: "string", description: "The log lines returned, newest last." },
    log: {
      type: "object",
      additionalProperties: false,
      properties: {
        // Nulls are spelled out rather than dropped: an unfiltered read really
        // does report "no pattern was applied", which is not the same fact as
        // "a pattern matched nothing".
        grep: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
        matched: { required: true, oneOf: [{ type: "number" }, { type: "null" }] },
        returned: { required: true, oneOf: [{ type: "number" }, { type: "null" }] },
        scannedLines: { required: true, oneOf: [{ type: "number" }, { type: "null" }] },
        truncated: { type: "boolean", required: true }
      },
      description: 'What the log view did, so "no matches" never reads as "no output".'
    },
    failures: { ...FailureItemSchema, type: "array", description: "The complete failure inventory, in run order." },
    baseline: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", required: true, description: "The registry file this came from." },
        known: { type: "number", required: true },
        new: { type: "number", required: true },
        failed: { required: true, oneOf: [{ type: "number" }, { type: "null" }] },
        tests: { type: "number", required: true, description: "Distinct tests the inventory named." },
        events: { type: "number", required: true, description: "Failure lines those tests produced." },
        unparsed: { type: "number", required: true, description: "The part of `failed` no line named." },
        newFailures: {
          ...FailureItemSchema,
          type: "array",
          required: true,
          description: "The complete, ordered list of failures your change introduced \u2014 read this to act."
        },
        error: { required: true, oneOf: [{ type: "string" }, { type: "null" }] }
      },
      description: "The known/new split: a reason a failure is not yours, or the evidence that it is."
    },
    result: { type: "json", description: "A sub-tool's structured outcome." },
    logPath: {
      type: "string",
      required: true,
      description: "The UTF-8 log file, readable with the ordinary file tools."
    }
  }
};
function toOutput(view) {
  const output = {
    id: view.id,
    status: view.status,
    lane: view.lane,
    argv: view.argv,
    resolvedArgv: view.resolvedArgv,
    aheadOf: view.aheadOf,
    logPath: view.logPath
  };
  if (view.exitCode !== null) output.exitCode = view.exitCode;
  if (view.durationSec !== null) output.durationSec = view.durationSec;
  if (view.summary !== null) output.summary = view.summary;
  if (view.counts !== null) output.counts = view.counts;
  if (view.error !== null) output.error = view.error;
  if (view.tail !== void 0) output.tail = view.tail;
  if (view.log !== void 0) output.log = view.log;
  if (view.failures !== void 0) output.failures = view.failures;
  if (view.baseline !== void 0 && view.baseline !== null) output.baseline = view.baseline;
  if (view.result !== void 0 && view.result !== null) output.result = view.result;
  return output;
}
function renderJob(value) {
  const head = [`${value.status}${value.exitCode === void 0 ? "" : ` exit=${value.exitCode}`}`];
  if (value.durationSec !== void 0) head.push(`${value.durationSec}s`);
  if (value.aheadOf > 0 && value.status === "queued") head.push(`queued behind ${value.aheadOf}`);
  const lines = [`${head.join(" ")}${value.summary === void 0 ? "" : `  ${value.summary}`}`];
  lines.push(`argv: ${value.argv.join(" ")}`);
  if (value.resolvedArgv !== null && value.resolvedArgv.length > 0) {
    lines.push(`ran: ${value.resolvedArgv.join(" ")}`);
  }
  lines.push(`job: ${value.id} (lane ${value.lane}; read it on with job_output ${value.id})`);
  if (value.error !== void 0) lines.push(`error: ${value.error}`);
  const fresh = value.baseline?.newFailures ?? [];
  if (fresh.length > 0) {
    lines.push("new failures:");
    for (const failure of fresh) lines.push(`  ${failure.file ?? ""} > ${failure.name}`);
  }
  if (value.tail !== void 0 && value.tail !== "") {
    if (value.log !== void 0 && value.log.matched !== null) {
      lines.push(`log: ${value.log.matched} matched, ${value.log.returned} returned, ${value.log.scannedLines} scanned`);
    }
    lines.push(value.tail);
  }
  return lines.join("\n");
}
function renderArb(value) {
  const result = value.result;
  if (result === void 0 || result === null || typeof result !== "object") return renderJob(value);
  const lines = [
    `${value.status}${result.dryRun ? " (dry run)" : ""}`,
    `edited: ${result.edited.length === 0 ? "none" : result.edited.join(", ")}`
  ];
  for (const change of result.changes) {
    const plus = change.inserts.length === 0 ? "" : ` +${change.inserts.join(",")}`;
    const minus = change.deletes.length === 0 ? "" : ` -${change.deletes.join(",")}`;
    lines.push(`  ${change.file}:${plus === "" && minus === "" ? " (no change)" : `${plus}${minus}`}`);
  }
  for (const skipped of result.skipped) lines.push(`  skipped ${skipped.file}: ${skipped.reason}`);
  if (result.genL10n !== null) lines.push(`gen-l10n exit=${result.genL10n.exitCode}`);
  if (result.untranslated !== null) {
    lines.push(`untranslated messages in ${result.untranslated.file} (${result.untranslated.lines} lines)`);
  }
  if (value.error !== void 0) lines.push(`error: ${value.error}`);
  lines.push(`job: ${value.id} (read it on with job_output ${value.id})`);
  if (value.tail !== void 0 && value.tail !== "") lines.push(value.tail);
  return lines.join("\n");
}
async function awaitJob(ctx, engine, id, agent, timeoutSec, signal) {
  const bounded = new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(1, timeoutSec) * 1e3);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
  await Promise.race([
    ctx.jobs.wait(id, Math.max(1, timeoutSec) * 1e3, agent.id).then(
      () => void 0,
      () => void 0
    ),
    bounded
  ]);
}
function registerBridgeTools(ctx, engine, config) {
  ctx.tools.register(
    defineTool({
      name: "bridge_run",
      description: [
        "Run a toolchain command that the file sandbox denies, outside that sandbox: `flutter`/`dart` (any subcommand), a guard-railed `git`, a package manager (`pnpm`, `npm`, `npx`), a project's Gradle wrapper (`gradlew`, run through the wrapper jar under `JAVA_HOME`'s java \u2014 never the `.bat` \u2014 with a forced `--no-daemon`, so nothing resident survives the job), a verb-guarded `cargo`, or the project's own `vite`/`vitest`/`svelte-check`/`svelte-kit`/`tsc` from its node_modules.",
        "Prefer it over the shell tools for those commands: the shell runs inside the sandbox, where the Flutter SDK cannot take its own lockfile and where a Node toolchain dies on `spawn EPERM` (the sandbox denies the named pipes libuv needs for child stdio).",
        "`cargo` is the one toolchain whose *dependency resolution* is the reason it is here: inside the sandbox `cargo fetch` dies with `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`, while a build with a warm cache runs there fine \u2014 so the verbs that resolve or download a crate (`fetch`, `add`, `remove`, `update`, `tree`, `metadata`, and any build that needs them) are what this bridge is for. Accepted cargo verbs are `build`, `check`, `test`, `bench`, `doc`, `run`, `clean`, `fix`, the toolchain's own `clippy`/`fmt` (external subcommands, accepted by name), `generate-lockfile` and the dependency verbs above. Refused: `install`/`uninstall` (they write the machine's `%USERPROFILE%\\.cargo\\bin`, where rustup's own shims live), `publish`/`yank`/`owner`/`login`/`logout`, `new`/`init`, `vendor`/`package`, `rustc`/`rustdoc`, any name not on the list (cargo dispatches an unknown verb to `cargo-<name>.exe` on PATH \u2014 general execution behind an allowlisted command, so `cargo nextest` and `cargo-binstall` are out), the flags `--target-dir`, `--config`, `-Z`, `--workspace`/`--all`/`--exclude`, and `cargo +<toolchain>` (the toolchain is machine configuration). `-p`/`--package` picks a workspace member, and `--manifest-path` must be a relative path inside the working directory \u2014 it is also the only way to stop cargo's own upward search for `Cargo.toml`.",
        "A refused command is a deliberate answer, not a bug: `dart run` is not confined by anything here, so the refusals bound *recoverable surprise* (`git reset --hard`, `git clean`, `git restore .`, a force push, `pnpm exec <anything>`, a cwd-retargeting flag), not reachability.",
        "A workspace selector is accepted on either side of the verb (`pnpm --filter <pkg> run test`, `npm -w <pkg> run build`), because it picks a member of the workspace the pinned cwd already belongs to; a selector naming a directory must stay inside that cwd, and the whole-workspace spellings (`--workspaces`, `-w` on pnpm) are refused.",
        "`git` covers reads and named writes: `fetch`, `rebase` and `cherry-pick` (never interactive \u2014 a job has no terminal, so `-i` and `-x` are refused), and a push only to a named remote with a named destination ref (`git push origin feature-branch`); force, delete, mirror and wildcard refspecs are refused.",
        "Test runs come back digested: `summary`, `counts` and the complete `failures` inventory, plus a `baseline` split against the project's `.toolbridge/known-failures.json` \u2014 `baseline.newFailures` names the failures your change introduced, and a failure is yours unless the registry claimed it. `flutter test`/`dart test`, `cargo test` and vitest are read.",
        "A command that runs until killed (`vite dev`, `vitest` in watch mode, a `dev`/`start`/`serve`/`watch` script) is guessed onto its own lane so it cannot starve the builds behind it; `cargo run` is *not* guessed, so pass `long: true` for one that serves; pass `long` to override the guess either way, and `background: true` to submit without waiting.",
        "`wait` (default true) blocks for queue time plus run time, bounded by `timeoutSec`. When that expires the job is still running and unchanged: fetch it with `job_output <id>`, stop it with `job_kill <id>`. The job's output is mirrored into the job runtime's own output ring as the run writes it, so a running job can be read incrementally and a settled one read in full.",
        "Every run is serialized with every other run in the same working directory \u2014 concurrent Flutter invocations corrupt `build/`, and two Vite builds share `dist/`. `aheadOf` says how many unfinished jobs are in front of yours on your own lane."
      ].join(" "),
      parameters: {
        cmd: {
          type: "string",
          required: true,
          description: "The command: flutter, dart, git, pnpm, npm, npx, gradlew, cargo, vite, vitest, svelte-check, svelte-kit or tsc."
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments, passed as an argv list. There is no shell: a quoted string stays one argument."
        },
        message: {
          type: "string",
          description: "A commit message for `git commit`, folded in as `-m <text>`. No file is ever created for it, so a later `git add -A` cannot sweep it into a commit. Refused for every other command, and refused alongside an `-m`/`-F`/`-C` the argv already carries."
        },
        scope: {
          type: "string",
          enum: ["uncommitted"],
          description: "`uncommitted` narrows the command to the working tree's uncommitted `.dart` files, read once here. `dart format` receives them as trailing paths (the formatter itself is narrowed \u2014 CI's changed-files check, run locally); `analyze`/`fix` can only take a directory, so there the scope narrows the returned lines and the exit code still covers the whole project. Nothing uncommitted is a refusal, not a whole-tree run."
        },
        long: {
          type: "boolean",
          description: "Force the long lane (`true`) or the queue (`false`) instead of guessing."
        },
        background: {
          type: "boolean",
          description: "Submit without waiting and return the job id at once. Its output then arrives through `job_output`, a completion notice wakes you when it settles, and `job_kill` stops it."
        },
        timeoutSec: {
          type: "number",
          description: `Seconds to wait inside this call (default ${config.defaultTimeoutSec}). Expiry returns the job as it stands; it is never killed by a timeout.`
        },
        grep: {
          type: "string",
          description: 'A regex selecting which log lines come back. The whole log is scanned and every match counted, so "no matches" is distinguishable from "no output". Cannot be combined with `scope`, which is also a log filter.'
        },
        tail: {
          type: "number",
          description: "How many log lines to return (default 200, capped at 5000, `0` for none)."
        }
      },
      output: {
        schema: JobOutputSchema,
        render: (_args, value) => [{ type: "text", text: renderJob(value) }]
      },
      async execute(args, exec) {
        const agent = exec.agent;
        if (agent === void 0) throw new ToolFailure("bridge_run needs a session: no agent on this execution");
        if (args.scope !== void 0 && args.grep !== void 0) {
          throw new RefusalError(400, "pass either grep or scope, not both");
        }
        const view = await engine.submitCommand(
          {
            cmd: args.cmd,
            args: args.args ?? [],
            message: args.message ?? null,
            scope: args.scope ?? null,
            long: args.long ?? null
          },
          agent
        );
        if (args.background !== true) {
          await awaitJob(ctx, engine, view.id, agent, args.timeoutSec ?? config.defaultTimeoutSec, exec.signal);
        }
        return toOutput(engine.result(view.id, args.grep ?? null, args.tail));
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "bridge_arb_edit",
      description: [
        "Edit Flutter ARB localization files and run `flutter gen-l10n`, as one atomic operation: the ARB edit is file surgery, but the gen-l10n that must follow it cannot run inside the file sandbox \u2014 and doing both here makes the pair one request instead of two escalations.",
        "Every target file is planned in memory first, so a missing anchor fails the job with zero files touched and names the file and key. Run with `dryRun: true` to see exactly what would change without writing anything.",
        "Line endings are preserved per file and values are written as raw UTF-8, so CJK text needs no escaping.",
        "If gen-l10n fails, the edits *were* written: read the log, fix the ARB, and re-post. `result.genL10n.exitCode` says so and `result.untranslated` reports the configured untranslated-messages file when it has content."
      ].join(" "),
      parameters: {
        groups: {
          type: "array",
          required: true,
          description: "One or more edit groups, applied in order.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              insertAfter: {
                type: "string",
                description: "Key to insert after, or `__END__` for the end of the file. Required when `newFields` is non-empty. If the anchor owns an `@key` metadata block, the new entries go after the block so it stays attached."
              },
              deleteFrom: {
                type: "string",
                description: "First key of an inclusive range to delete (needs `deleteTo`)."
              },
              deleteTo: {
                type: "string",
                description: "Last key of that inclusive range; its `@key` block goes with it."
              },
              newFields: {
                type: "array",
                description: "Keys to insert, each with the value to write per ARB file. Omit entirely for a pure delete. Keys starting with `@` are refused: gen-l10n generates that metadata.",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string", required: true, description: "The new message key." },
                    value: {
                      type: "object",
                      additionalProperties: true,
                      description: 'ARB file name \u2192 translated string, e.g. {"app_en.arb": "LAN Sync", "app_zh.arb": "\u5C40\u57DF\u7F51\u540C\u6B65"}.'
                    }
                  }
                }
              }
            }
          }
        },
        dryRun: { type: "boolean", description: "Plan only: nothing is written and gen-l10n does not run." },
        timeoutSec: { type: "number", description: "Seconds to wait inside this call; expiry leaves the job running." },
        grep: { type: "string", description: "A regex selecting which log lines come back." },
        tail: { type: "number", description: "How many log lines to return (default 200)." }
      },
      output: {
        schema: JobOutputSchema,
        render: (_args, value) => [{ type: "text", text: renderArb(value) }]
      },
      async execute(args, exec) {
        const agent = exec.agent;
        if (agent === void 0) throw new ToolFailure("bridge_arb_edit needs a session: no agent on this execution");
        const cwd = workingDirectory(agent);
        const instruction = validateInstructions({ groups: args.groups, dryRun: args.dryRun ?? false });
        const view = engine.submitSubTool({
          owner: agent.id,
          cwd,
          displayArgv: ["tool:arb-edit", `${instruction.groups.length} group(s)`],
          body: async (record, job) => {
            const plan = planArbEdits(cwd, instruction);
            const result = {
              dryRun: instruction.dryRun,
              edited: [],
              skipped: plan.skipped,
              changes: plan.files.map((file) => ({ file: file.name, inserts: file.inserts, deletes: file.deletes })),
              genL10n: null,
              untranslated: null
            };
            if (instruction.dryRun) {
              record.result = result;
              record.exitCode = 0;
              record.status = "done";
              job.append(`dry run: ${plan.files.length} file(s) would be edited
`);
              return;
            }
            result.edited = applyArbEdits(plan);
            record.result = result;
            job.append(`${result.edited.length} ARB file(s) edited
`);
            const resolved = resolveLaunch(["flutter", "gen-l10n"], null, cwd);
            record.resolvedArgv = resolved.argv;
            const run = new ProcessRun(resolved.argv, cwd, { ...process.env, ...resolved.env }, record.logPath);
            record.run = run;
            run.start();
            const settlement = await run.settled;
            record.exitCode = settlement.exitCode ?? 1;
            result.genL10n = { exitCode: record.exitCode };
            result.untranslated = readUntranslated(plan.untranslatedFile);
            record.status = settlement.killed ? "killed" : record.exitCode === 0 ? "done" : "failed";
          }
        });
        await awaitJob(ctx, engine, view.id, agent, args.timeoutSec ?? config.defaultTimeoutSec, exec.signal);
        return toOutput(engine.result(view.id, args.grep ?? null, args.tail));
      }
    })
  );
}

// src/host/index.ts
var name = "toolbridge";
var inject = ["tools", "jobs", "agents", "webServer"];
function apply(ctx, config) {
  const stateDir = resolveStateDir(config);
  mkdirSync4(stateDir, { recursive: true });
  const engine = new BridgeEngine(ctx, new Lanes(), {
    logDir: join6(stateDir, "logs"),
    dartFormatExe: config.dartFormatExe
  });
  const store = new ToggleStore(toggleFile(stateDir), {
    bridge: config.defaults.bridge,
    browser: config.defaults.browser
  });
  const switches = new SessionSwitches(ctx, engine, store, config);
  registerBridgeTools(ctx, engine, config);
  ctx.effect(() => registerApi(ctx, engine, switches, config), "toolbridge api");
  ctx.on("agent/created", async ({ agent }) => {
    await switches.onAgentCreated(agent);
  });
  ctx.on("agent/disposed", async ({ agent }) => {
    await switches.onAgentDisposed(agent);
  });
}
function resolveStateDir(config) {
  if (config.stateDir !== "") return config.stateDir;
  const home = process.env.DSH_HOME ?? join6(homedir(), ".dsh");
  return join6(home, "toolbridge");
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
