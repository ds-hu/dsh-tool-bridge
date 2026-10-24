window.__ModuleLoader__.load({
	id: "@ds-hu/dsh-plugin-toolbridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/BridgePanel.tsx
var import_react = require("react");

// src/client/api.ts
var PREFIX = "/toolbridge/api";
async function request(path, init) {
  try {
    const response = await fetch(`${PREFIX}${path}`, {
      headers: { "content-type": "application/json" },
      ...init
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed.error?.message !== void 0) message = parsed.error.message;
      } catch {
      }
      return { ok: false, message };
    }
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
function fetchState(sessionId, signal) {
  return request(`/state?sessionId=${encodeURIComponent(sessionId)}`, { signal });
}
function fetchJob(id, tail) {
  return request(`/job?id=${encodeURIComponent(id)}&tail=${String(tail)}`);
}
function postToggle(sessionId, key, value) {
  return request("/toggle", {
    method: "POST",
    body: JSON.stringify({ sessionId, key, value })
  });
}

// src/client/theme.ts
var MONO = "var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace)";
var HAIRLINE = "0.5px solid var(--dsw-alias-border-l2)";
var card = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  padding: "10px 12px",
  background: "var(--dsw-alias-bg-layer-1)",
  border: HAIRLINE,
  borderRadius: "var(--dsw-radius-md)"
};
var chip = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  minWidth: 0,
  color: "var(--dsw-alias-label-primary)"
};
var panelFrame = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  padding: "10px 12px",
  fontFamily: MONO,
  fontSize: "12px",
  lineHeight: "18px",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto"
};
var mono = {
  fontFamily: MONO,
  fontSize: "12px",
  lineHeight: "18px"
};
var sectionTitle = {
  color: "var(--dsw-alias-label-tertiary)",
  fontFamily: MONO,
  fontSize: "11px",
  lineHeight: "16px",
  letterSpacing: "0.04em",
  textTransform: "uppercase"
};
var muted = { color: "var(--dsw-alias-label-tertiary)" };
var danger = { color: "var(--dsw-alias-state-error-primary)" };
var pill = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "1px 6px",
  background: "var(--dsw-alias-bg-layer-2)",
  borderRadius: "var(--dsw-radius-sm)",
  color: "var(--dsw-alias-label-secondary)",
  fontFamily: MONO,
  fontSize: "11px",
  lineHeight: "16px",
  whiteSpace: "nowrap"
};
var dot = (color) => ({
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: color,
  flex: "none"
});
var jobRow = (selected) => ({
  display: "flex",
  alignItems: "baseline",
  gap: "8px",
  width: "100%",
  padding: "5px 6px",
  border: "none",
  borderRadius: "var(--dsw-radius-sm)",
  background: selected ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left"
});
var logBody = {
  background: "var(--dsw-alias-bg-base)",
  maxHeight: "320px",
  overflow: "auto",
  padding: "8px 10px",
  fontFamily: MONO,
  fontSize: "11px",
  lineHeight: "18px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all"
};

// src/client/BridgePanel.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var panel = panelFrame;
var pillRow = { display: "flex", flexWrap: "wrap", gap: "4px" };
var flushCard = { ...card, padding: 0, gap: 0, overflow: "hidden" };
var dotColumn = { paddingTop: "7px" };
var jobText = { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: 1 };
var logBanner = {
  display: "flex",
  alignItems: "baseline",
  gap: "8px",
  padding: "6px 10px",
  borderBottom: HAIRLINE,
  color: "var(--dsw-alias-label-tertiary)",
  fontFamily: mono.fontFamily,
  fontSize: "11px"
};
var DOT_COLOUR = {
  queued: "var(--dsw-alias-label-tertiary)",
  running: "var(--dsw-alias-label-secondary)",
  done: "var(--dsw-alias-label-tertiary)",
  failed: "var(--dsw-alias-state-error-primary)",
  killed: "var(--dsw-alias-state-error-primary)"
};
function jobLine(job) {
  const parts = [job.status];
  if (job.lane === "long") parts.push("long lane");
  if (job.exitCode !== null) parts.push(`exit ${job.exitCode}`);
  if (job.durationSec !== null) parts.push(`${job.durationSec}s`);
  if (job.status === "queued" && job.aheadOf > 0) parts.push(`behind ${job.aheadOf}`);
  return parts.join(" \xB7 ");
}
function browserWord(view) {
  if (view.browserMounted) return "connected";
  return view.toggles.browser ? "starting" : "off";
}
function formatterLine(view) {
  return view.config.dartFormatExe === null ? "formatter: PATH dart (no CI pin)" : `formatter pin: ${view.config.dartFormatExe}`;
}
function BridgePanel({ sessionId }) {
  const [view, setView] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(null);
  const [selected, setSelected] = (0, import_react.useState)(null);
  const [tail, setTail] = (0, import_react.useState)("");
  const refresh = (0, import_react.useCallback)(async () => {
    const result = await fetchState(sessionId);
    if (result.ok) {
      setView(result.value);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [sessionId]);
  (0, import_react.useEffect)(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4e3);
    return () => clearInterval(timer);
  }, [refresh]);
  (0, import_react.useEffect)(() => {
    if (selected === null) {
      setTail("");
      return;
    }
    let live = true;
    const read = async () => {
      const result = await fetchJob(selected, 200);
      if (!live) return;
      if (result.ok) setTail(result.value.tail ?? "");
      else setTail(`(${result.message})`);
    };
    void read();
    const timer = setInterval(() => void read(), 4e3);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected]);
  if (view === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: panel, children: error === null ? "Reading tool-bridge state\u2026" : `Tool bridge: ${error}` });
  }
  const jobs = view.jobs;
  const selectedJob = jobs.find((job) => job.id === selected) ?? null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { wordBreak: "break-all" }, children: view.cwd ?? "no working directory yet" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: pillRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: pill, children: [
          "toolchain ",
          view.toggles.bridge ? "on" : "off"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: pill, children: [
          "browser ",
          browserWord(view)
        ] })
      ] }),
      view.browserError === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: danger, role: "alert", children: [
        "browser failed: ",
        view.browserError
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: muted, children: formatterLine(view) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: muted, children: [
        "browser: ",
        view.config.playwright.browser,
        " \xB7 caps ",
        view.config.playwright.caps
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionTitle, children: "Lanes" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...pillRow, marginTop: "4px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: pill, children: [
          "queue ",
          view.lanes.queue
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: pill, children: [
          "long ",
          view.lanes.long
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: sectionTitle, children: [
        "Jobs (",
        jobs.length,
        ")"
      ] }),
      jobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...muted, marginTop: "4px" }, children: "Nothing has run in this conversation yet." }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...flushCard, marginTop: "4px" }, children: [...jobs].reverse().map((job, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          style: {
            ...jobRow(job.id === selected),
            ...index === 0 ? {} : { borderTop: HAIRLINE }
          },
          onClick: () => setSelected(job.id === selected ? null : job.id),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: dotColumn, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: dot(DOT_COLOUR[job.status] ?? "var(--dsw-alias-label-secondary)"), "aria-hidden": true }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: jobText, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { wordBreak: "break-all" }, children: job.argv.join(" ") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: jobLine(job) }),
              job.summary === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: muted, children: job.summary }),
              job.error === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: danger, children: job.error })
            ] })
          ]
        },
        job.id
      )) })
    ] }),
    selectedJob === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: sectionTitle, children: "Log" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...flushCard, marginTop: "4px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: logBanner, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: selectedJob.argv.join(" ") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { marginLeft: "auto", flex: "none" }, children: jobLine(selectedJob) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: logBody, children: tail === "" ? "(no output yet)" : tail })
      ] })
    ] })
  ] });
}

// src/client/Switches.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/poll.ts
var StatePoller = class {
  constructor(options) {
    this.options = options;
  }
  stopped = false;
  timer;
  inFlight;
  active = false;
  /**
   * The mount read, then the cadence that {@link setActive} decides.
   *
   * The first read happens for every row, active or not: a conversation switched
   * to must draw its switches before anything else has had a chance to ask, and
   * one read at mount is what makes that first frame honest.
   */
  start() {
    this.fire();
  }
  /**
   * Follow the framework's activity fact.
   *
   * Entering activity reads immediately — the row may have been parked for
   * hours — and leaving it cancels the pending tick. A read already in flight
   * settles quietly; it is one request, and the next scheduled read is what the
   * switch was for.
   * @param active - whether this row's conversation is the main one now.
   */
  setActive(active) {
    if (this.stopped || active === this.active) return;
    this.active = active;
    if (active) this.fire();
    else this.cancel();
  }
  /** Read once now — the row uses it after a switch flip, and it never stacks. */
  refreshNow() {
    this.fire();
  }
  /**
   * Stop for good: drop the pending tick and abort a read in flight.
   *
   * After this call the poller schedules nothing and its read's completion does
   * nothing, so an unmounted row cannot write state or hold a socket.
   */
  stop() {
    this.stopped = true;
    this.cancel();
    const controller = this.inFlight;
    this.inFlight = void 0;
    controller?.abort();
  }
  cancel() {
    if (this.timer !== void 0) clearTimeout(this.timer);
    this.timer = void 0;
  }
  fire() {
    if (this.stopped || this.inFlight !== void 0) return;
    this.cancel();
    const controller = new AbortController();
    this.inFlight = controller;
    void this.options.read(controller.signal).catch(() => {
    }).finally(() => {
      if (this.inFlight !== controller) return;
      this.inFlight = void 0;
      if (this.stopped || !this.active) return;
      this.timer = setTimeout(() => this.fire(), this.options.activeMs);
    });
  }
};

// src/client/Switches.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var POLL_MS = 4e3;
var useAlwaysActive = () => true;
var CLEARANCE = "max(var(--dsh-composer-side-clearance, 16px), calc((100% - var(--dsh-composer-card-max-width, 920px)) / 2))";
var rowStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  columnGap: "14px",
  rowGap: "4px",
  minHeight: "24px",
  marginLeft: CLEARANCE,
  marginRight: CLEARANCE
};
var labelStyle = {
  color: "var(--dsw-alias-label-secondary)",
  fontSize: "12px",
  lineHeight: "16px",
  marginRight: "6px"
};
var halfStyle = { display: "inline-flex", alignItems: "center" };
var switchStyle = {
  display: "inline-flex",
  transform: "scale(0.85)",
  transformOrigin: "left center",
  marginRight: "-5px"
};
var spacerStyle = { marginLeft: "auto" };
var noteStyle = { fontSize: "12px", ...muted };
var failureStyle = { fontSize: "12px", ...danger };
function Half({
  name,
  description,
  checked,
  disabled,
  onChange
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: halfStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: labelStyle, children: name }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: switchStyle, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Switch, { checked, disabled, label: name, title: description, onChange }) })
  ] });
}
function Switches({
  sessionId,
  openPanel: openPanel2,
  useSessionRetainInfo
}) {
  const [view, setView] = (0, import_react2.useState)(null);
  const [failure, setFailure] = (0, import_react2.useState)(null);
  const [pending, setPending] = (0, import_react2.useState)(null);
  const retain = useSessionRetainInfo ?? useAlwaysActive;
  const active = retain(
    sessionId,
    (info) => (info?.retainedBy.mainView ?? 0) > 0
  );
  const mounted = (0, import_react2.useRef)(true);
  const poller = (0, import_react2.useRef)(null);
  const live = (0, import_react2.useRef)(active);
  (0, import_react2.useEffect)(() => {
    live.current = active;
    poller.current?.setActive(active);
  }, [active]);
  (0, import_react2.useEffect)(() => {
    if (sessionId === "") return void 0;
    mounted.current = true;
    const instance = new StatePoller({
      activeMs: POLL_MS,
      read: async (signal) => {
        const result = await fetchState(sessionId, signal);
        if (!mounted.current || signal.aborted) return;
        if (result.ok) {
          setView(result.value);
          setFailure(null);
        } else {
          setFailure(result.message);
        }
      }
    });
    poller.current = instance;
    instance.setActive(live.current);
    instance.start();
    return () => {
      mounted.current = false;
      poller.current = null;
      instance.stop();
    };
  }, [sessionId]);
  const flip = (0, import_react2.useCallback)(
    async (key, value) => {
      if (sessionId === "") return;
      setPending(key);
      const result = await postToggle(sessionId, key, value);
      setPending(null);
      if (result.ok) {
        setView((current) => current === null ? current : { ...current, toggles: result.value.toggles });
        setFailure(null);
        poller.current?.refreshNow();
      } else {
        setFailure(result.message);
      }
    },
    [sessionId]
  );
  if (sessionId === "") return null;
  const toggles = view?.toggles ?? null;
  const ready = toggles !== null && pending === null;
  const starting = view !== null && view.toggles.browser && !view.browserMounted && view.browserError === null;
  const browserFailure = view?.browserError ?? failure;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: rowStyle, "data-toolbridge-row": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Half,
      {
        name: "Toolchain",
        description: "bridge_run and bridge_arb_edit in this conversation: Flutter, Dart, a guard-railed git, pnpm/npm, and the project's own vite/vitest/tsc.",
        checked: toggles?.bridge ?? false,
        disabled: !ready,
        onChange: (next) => void flip("bridge", next)
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      Half,
      {
        name: "Browser",
        description: "Playwright MCP in this conversation, mounted for it alone: the server exists only while this is on.",
        checked: toggles?.browser ?? false,
        disabled: !ready,
        onChange: (next) => void flip("browser", next)
      }
    ),
    browserFailure !== null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: failureStyle, role: "alert", children: [
      "browser failed: ",
      browserFailure
    ] }) : starting ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: noteStyle, children: "browser starting\u2026" }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: spacerStyle }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives.Button,
      {
        variant: "ghost",
        size: "sm",
        icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCodeOutlineRegular, {}),
        "aria-label": "Open the tool-bridge panel",
        title: "Open the tool-bridge panel: lanes, jobs, digests and logs for this conversation.",
        onClick: () => openPanel2()
      }
    )
  ] });
}

// src/client/TabTitle.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
function TabTitle({ useTabInfo }) {
  const { tab } = useTabInfo();
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: chip, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCodeOutlineRegular, {}),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: tab.title })
  ] });
}

// src/client/openPanel.ts
var PANEL_KIND = "bridge";
function openPanel(right) {
  try {
    right.openTab(PANEL_KIND);
  } catch (error) {
    console.warn("toolbridge: could not open the panel tab:", error);
  }
}

// src/client/services.ts
var CLIENT_SERVICES = ["slots", "sidebarRightTabs", "sidebarRight"];

// src/client/index.ts
var TAB_ID = "@ds-hu/dsh-plugin-toolbridge";
var inject = [...CLIENT_SERVICES];
function apply(ctx) {
  ctx.effect(
    () => ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: PANEL_KIND,
      // A page type: it is opened by kind, not by a resource address, so it
      // claims no patterns and takes no `canOpen` veto.
      title: () => "Tool bridge",
      // A list, because a type may offer more than one way in; this one has a
      // single entry box, which is also what makes it discoverable without
      // reading this file (the guide page lists contributed entries by order).
      guide: [
        {
          id: "toolbridge-panel",
          order: 20,
          title: () => "Tool bridge",
          description: () => "Lane depth, jobs and logs for the Flutter/Dart and Node toolchains this conversation runs outside the file sandbox.",
          // Without one the guide draws its cube placeholder.
          icon: import_dsh_client_ui_primitives3.IconCodeOutlineRegular
        }
      ]
    }),
    "toolbridge tab type"
  );
  ctx.effect(
    () => ctx.slots.inject(
      "sidebar.right.pane.tab",
      () => ctx.slots.register(
        {
          name: "sidebar.right.pane.tab",
          key: TAB_ID,
          // The seat is session-scoped, so the framework resolves the
          // conversation of the pane the tab is drawn in and hands it to this
          // factory — the one source for "which panel is this". A page opened
          // from the sidebar's own guide carries no navigation parameters, so a
          // body that reads its conversation off the tab has none (ADR-0012).
          inject: (sessionId) => ({ sessionId })
        },
        BridgePanel
      )
    ),
    "toolbridge tab body"
  );
  ctx.effect(
    () => ctx.slots.inject(
      "sidebar.right.pane.tab.title",
      () => ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, TabTitle)
    ),
    "toolbridge tab chip"
  );
  ctx.effect(
    () => ctx.slots.inject(
      "conversation.input.dock",
      () => ctx.slots.register(
        {
          name: "conversation.input.dock",
          id: "toolbridge",
          // 30 keeps the row directly above the composer card: the dock renders
          // its entries in ascending order, after the diff pill (-100), the todo
          // panel (0) and the queue dock (20).
          order: 30,
          // The dock's owner props carry the input zone, not the conversation;
          // asking for the session id here is how a dock entry learns which
          // conversation it belongs to (the shell's own job list passes its
          // service calls like this). The panel opener needs none of it: it
          // opens beside the conversation the sidebar is showing, and that
          // panel's own seat tells it which one that is.
          inject: (sessionId) => ({
            sessionId,
            openPanel: () => openPanel(ctx.sidebarRight)
          })
        },
        Switches
      )
    ),
    "toolbridge switches"
  );
}

		return module.exports;
	},
});
