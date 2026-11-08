// Template A: concept lesson page. Reads ?lesson=<id>, renders 5 tabs:
// What is it? / Example / Demo / Try it / Learn more.
// All lesson text goes in via textContent (never innerHTML); `inline()` turns
// `code` and **bold** in lesson text into real elements.
import { load } from "./lesson-loader.js";
import { run, evalChecks } from "./runner.js";
import { judge, revealAllowed, isLoadFailure, TIMEOUT_HINT } from "./check.js";

const TAB_LABELS = ["What is it?", "Example", "Demo", "Try it", "Learn more"];

const SVG_TAGS = new Set(["svg", "polygon"]);

function h(tag, attrs = {}, ...kids) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// "Use `x` and **bold**" -> text + <code> + <strong> nodes.
function inline(text) {
  return String(text)
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.startsWith("`")) return h("code", {}, part.slice(1, -1));
      if (part.startsWith("**")) return h("strong", {}, part.slice(2, -2));
      return part;
    });
}

// Review Focus 4: Python could not load (blocked CDN, slow network).
function loadFailureNode() {
  return h(
    "span",
    {},
    "Python couldn't load here. Open this lesson in a new tab: ",
    h("a", { href: location.href, target: "_blank", rel: "noopener" }, "Open lesson in a new tab")
  );
}

// The runner should never reject, but if it does (e.g. a browser quirk) the
// student still gets the "couldn't load" message instead of a stuck button.
const startFailed = (e) => ({
  ok: false,
  stdout: "",
  error: { type: "LoadError", message: String((e && e.message) || e), line: null },
  timedOut: false,
});
async function safeRun(code) {
  try {
    return await run(code);
  } catch (e) {
    return startFailed(e);
  }
}
async function safeEval(code, exprs) {
  try {
    return await evalChecks(code, exprs);
  } catch (e) {
    return { run: startFailed(e), values: [] };
  }
}

function runErrorText(r) {
  if (r.timedOut) return TIMEOUT_HINT;
  if (r.error) return `${r.error.type}${r.error.message ? ": " + r.error.message : ""}`;
  return "";
}

// ---------- panels ----------

function whatPanel(l) {
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, l.what.heading),
    l.what.paragraphs.map((text) => h("p", { class: "lead" }, inline(text))),
    l.what.points.length
      ? h(
          "div",
          { class: "cards" },
          l.what.points.map((c) => h("div", { class: "mini-card" }, h("b", {}, c.title), h("span", {}, inline(c.text))))
        )
      : null,
    h("pre", {}, l.what.code)
  );
}

function examplePanel(l) {
  const ex = l.example;
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, ex.heading),
    h("pre", {}, ex.code),
    ex.visual
      ? h(
          "div",
          { class: "boxes" },
          ex.visual.items.map((v, i) =>
            h(
              "div",
              { class: "box" + (i === ex.visual.highlight ? " hl" : "") },
              h("span", { class: "box-idx" }, `${ex.visual.label}[${i}]`),
              h("div", { class: "box-val" }, v)
            )
          )
        )
      : null,
    h("p", { class: "caption" }, inline(ex.caption))
  );
}

function demoPanel(l) {
  let current = 0;
  const codeEl = h("pre", { id: "demo-code", style: "min-height:120px" });
  const noteEl = h("span", { class: "note" });
  const outWrap = h("div", { hidden: true, style: "display:flex;flex-direction:column;gap:6px" });
  const outEl = h("pre", { class: "out" });
  const status = h("div", { role: "status", "aria-live": "polite" }, outWrap);
  outWrap.append(h("span", { class: "small-label" }, "Output"), outEl);
  const runBtn = h(
    "button",
    { type: "button", class: "btn btn-primary" },
    h(
      "svg",
      { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      h("polygon", { points: "6 4 20 12 6 20 6 4" })
    ),
    "Run"
  );
  const picks = l.demos.map((d, i) =>
    h("button", { type: "button", class: "demo-pick", "aria-pressed": "false", onclick: () => select(i) }, d.label)
  );

  function select(i) {
    current = i;
    picks.forEach((b, j) => b.setAttribute("aria-pressed", String(j === i)));
    codeEl.textContent = l.demos[i].code;
    noteEl.textContent = l.demos[i].note;
    outWrap.hidden = true;
  }

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    const label = runBtn.lastChild;
    label.textContent = "Running…";
    const r = await safeRun(l.demos[current].code);
    label.textContent = "Run";
    runBtn.disabled = false;
    outEl.replaceChildren();
    if (isLoadFailure(r)) outEl.append(loadFailureNode());
    else if (r.timedOut || r.error) outEl.append(runErrorText(r));
    else outEl.append(r.stdout.trimEnd() || "(no output)");
    outWrap.hidden = false;
  });

  select(0);
  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("h2", {}, "Watch it run"),
    h(
      "div",
      { class: "demo" },
      h("div", { class: "demo-list", role: "group", "aria-label": "Demos" }, picks),
      h("div", { class: "demo-main" }, codeEl, h("div", { class: "row" }, runBtn, noteEl), status)
    )
  );
}

function tryPanel(l) {
  const t = l.try;
  let attempts = 0;
  let wrong = 0;
  let solved = false;
  let revealed = false;
  let busy = false;

  const attemptsEl = h("span", { class: "small-label", style: "text-transform:none;letter-spacing:0;font-weight:400;font-size:12px" }, "Attempts: 0");
  const box = h("textarea", { id: "code-box", spellcheck: "false", autocomplete: "off", autocapitalize: "off", rows: "6" });
  box.value = t.starter;
  const checkBtn = h("button", { type: "button", class: "btn btn-primary" }, "Run & check");
  const resetBtn = h("button", { type: "button", class: "btn btn-ghost" }, "Start over");
  const revealBtn = h("button", { type: "button", class: "btn btn-link", hidden: true }, "Show answer");
  const feedback = h("div", { role: "status", "aria-live": "polite", id: "feedback" });
  const answer = h("div", { hidden: true, id: "answer" }, h("span", { class: "small-label" }, "One way to do it"), h("pre", { class: "answer" }, t.solution));

  function syncReveal() {
    revealBtn.hidden = !(revealAllowed(wrong) && !solved && !revealed);
  }
  function showFeedback(ok, title, ...body) {
    feedback.replaceChildren(h("div", { class: "feedback " + (ok ? "ok" : "no") }, h("span", { class: "fb-title" }, title), ...body));
  }

  async function onCheck() {
    if (busy) return;
    busy = true;
    checkBtn.disabled = true;
    checkBtn.textContent = "Running…";
    const exprs = t.checks.map((c) => c.expr);
    const { run: r, values } = await safeEval(box.value, exprs);
    busy = false;
    checkBtn.disabled = false;
    checkBtn.textContent = "Run & check";

    if (isLoadFailure(r)) {
      // Not the student's fault: does not count as an attempt.
      showFeedback(false, "Python isn't ready", h("span", { class: "fb-msg" }, loadFailureNode()));
      return;
    }
    const verdict = judge(t, r, values);
    attempts += 1;
    attemptsEl.textContent = `Attempts: ${attempts}`;
    if (verdict.ok) {
      solved = true;
      showFeedback(true, "Correct!", h("span", { class: "fb-msg" }, "That matches what we expected. Here is what printed:"), h("pre", {}, r.stdout.trimEnd()));
    } else {
      wrong += 1;
      showFeedback(false, "Not quite yet", h("span", { class: "fb-msg" }, verdict.hint));
    }
    syncReveal();
  }

  checkBtn.addEventListener("click", onCheck);
  box.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onCheck();
    }
  });
  resetBtn.addEventListener("click", () => {
    box.value = t.starter;
    attempts = wrong = 0;
    solved = revealed = false;
    attemptsEl.textContent = "Attempts: 0";
    feedback.replaceChildren();
    answer.hidden = true;
    syncReveal();
    box.focus();
  });
  revealBtn.addEventListener("click", () => {
    revealed = true;
    answer.hidden = false;
    syncReveal();
  });

  return h(
    "div",
    { class: "stack", style: "gap:12px" },
    h("div", { class: "try-head" }, h("h2", {}, "Try it yourself"), attemptsEl),
    h("p", { class: "lead", style: "font-size:15px" }, inline(t.prompt)),
    h("label", { for: "code-box", class: "small-label" }, "Your code"),
    box,
    h("div", { class: "row", style: "gap:10px" }, checkBtn, resetBtn, revealBtn),
    feedback,
    answer
  );
}

function learnPanel(l) {
  const { video: vid, links, used_later: where } = l.learn;
  const id = vid.youtube_id;
  const video = id
    ? h("iframe", {
        class: "video-frame",
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
        title: vid.title || `Video: ${l.title}`,
        loading: "lazy",
        allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
        allowfullscreen: true,
        referrerpolicy: "strict-origin-when-cross-origin",
      })
    : h(
        "div",
        { class: "video-soon", role: "img", "aria-label": "Video coming soon" },
        h(
          "div",
          { class: "play" },
          h("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "none", stroke: "#fff", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, h("polygon", { points: "7 4 20 12 7 20 7 4" }))
        ),
        h("span", {}, "Video coming soon")
      );
  const shown = links.filter((x) => x.url);
  return h(
    "div",
    { class: "stack", style: "gap:16px" },
    h("h2", {}, "Learn more"),
    h(
      "div",
      { class: "learn" },
      h("div", { class: "video" }, video),
      h(
        "div",
        { class: "learn-side" },
        shown.length ? h("span", { class: "small-label" }, "Read or watch") : null,
        shown.map((x) => h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.label)),
        h("span", { class: "small-label", style: shown.length ? "margin-top:10px" : "" }, "Where you'll use this"),
        h("span", { class: "where" }, where)
      )
    )
  );
}

// ---------- page ----------

function mount(l) {
  document.title = `${l.title} · Python for SDFs`;
  document.getElementById("eyebrow").textContent = l.kicker;
  document.getElementById("title").textContent = l.title;

  const builders = [whatPanel, examplePanel, demoPanel, tryPanel, learnPanel];
  const panelsEl = document.getElementById("panels");
  const tabsEl = document.getElementById("tabs");
  const back = document.getElementById("back");
  const next = document.getElementById("next");
  const stepCount = document.getElementById("step-count");
  let step = 0;

  const panels = builders.map((build, i) =>
    h("section", { role: "tabpanel", id: `panel-${i}`, "aria-labelledby": `tab-${i}`, hidden: true }, build(l))
  );
  panelsEl.replaceChildren(...panels);

  const tabs = TAB_LABELS.map((label, i) =>
    h(
      "button",
      { type: "button", role: "tab", class: "tab", id: `tab-${i}`, "aria-controls": `panel-${i}`, onclick: () => go(i) },
      h("span", { class: "tab-dot", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "tab-label" }, label)
    )
  );
  tabsEl.replaceChildren(...tabs);
  tabsEl.addEventListener("keydown", (e) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 };
    if (e.key in keys) {
      e.preventDefault();
      go((step + keys[e.key] + tabs.length) % tabs.length, true);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      go(e.key === "Home" ? 0 : tabs.length - 1, true);
    }
  });

  function go(i, focusTab = false) {
    step = Math.max(0, Math.min(tabs.length - 1, i));
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(j === step));
      t.tabIndex = j === step ? 0 : -1;
      t.classList.toggle("done", j < step);
    });
    panels.forEach((p, j) => (p.hidden = j !== step));
    stepCount.replaceChildren(`Step ${step + 1} of ${tabs.length}`, h("span", { class: "only-narrow" }, ` · ${TAB_LABELS[step]}`));
    const hadFocus = document.activeElement;
    back.disabled = step === 0;
    next.disabled = step === tabs.length - 1;
    // A button that just disabled itself would drop keyboard focus: hand it to the active tab.
    if (focusTab || ((hadFocus === back || hadFocus === next) && hadFocus.disabled)) tabs[step].focus();
  }
  back.addEventListener("click", () => go(step - 1));
  next.addEventListener("click", () => go(step + 1));
  go(0);
}

function showProblem(err) {
  document.getElementById("title").textContent = "Lesson unavailable";
  document.getElementById("tabs").hidden = true;
  document.querySelector(".nav").hidden = true;
  document.getElementById("panels").replaceChildren(h("div", { class: "error-box", role: "alert" }, h("b", {}, "This lesson can't be shown. "), err.message));
}

load({ expectTemplate: "concept" }).then(mount, showProblem);
