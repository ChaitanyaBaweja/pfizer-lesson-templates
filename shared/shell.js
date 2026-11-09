// The shell every lesson template shares: DOM helpers, the fit-to-box page
// (header, tabs, scrolling step panel, Back/Next), the Learn more tab, the
// "Python couldn't load" handling and the "lesson unavailable" page.
// concept.js, read-code.js and fix-error.js only supply their own panels.
//
// All lesson text goes in via textContent (never innerHTML); `inline()` turns
// `code` and **bold** in lesson text into real elements.
import { load } from "./lesson-loader.js";
import { run } from "./runner.js";
import { TIMEOUT_HINT } from "./check.js";

const SVG_TAGS = new Set(["svg", "polygon"]);

export function h(tag, attrs = {}, ...kids) {
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
export function inline(text) {
  return String(text)
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.startsWith("`")) return h("code", {}, part.slice(1, -1));
      if (part.startsWith("**")) return h("strong", {}, part.slice(2, -2));
      return part;
    });
}

// ---------- running Python (Review Focus 4: Python could not load) ----------

export function loadFailureNode() {
  return h(
    "span",
    {},
    "Python couldn't load here. Open this lesson in a new tab: ",
    h("a", { href: location.href, target: "_blank", rel: "noopener" }, "Open lesson in a new tab")
  );
}

// The runner should never reject, but if it does (e.g. a browser quirk) the
// student still gets the "couldn't load" message instead of a stuck button.
export const startFailed = (e) => ({
  ok: false,
  stdout: "",
  error: { type: "LoadError", message: String((e && e.message) || e), line: null },
  timedOut: false,
});
export async function safeRun(code) {
  try {
    return await run(code);
  } catch (e) {
    return startFailed(e);
  }
}

export function runErrorText(r) {
  if (r.timedOut) return TIMEOUT_HINT;
  if (r.error) return `${r.error.type}${r.error.message ? ": " + r.error.message : ""}`;
  return "";
}

// ---------- scrolling and focus inside the panel ----------

// Scroll the step panel (only) so `el` is visible. Deliberately not
// el.scrollIntoView(): Chrome also scrolls ancestor frames, which would move the
// Notion page around the embed.
export function revealInPanel(el) {
  const panel = document.getElementById("panels");
  const p = panel.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.height > p.height || r.top < p.top) panel.scrollTop += r.top - p.top - 8;
  else if (r.bottom > p.bottom) panel.scrollTop += r.bottom - p.bottom + 8;
}

// Newly revealed content (e.g. the answer after its own button hid itself):
// move keyboard focus onto it so focus isn't lost, then scroll it into view.
export function focusRevealed(el) {
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  revealInPanel(el);
}

// ---------- shared panel pieces ----------

// Green/orange message box used for every right/wrong answer.
export function feedbackBox(ok, title, ...body) {
  return h("div", { class: "feedback " + (ok ? "ok" : "no") }, h("span", { class: "fb-title" }, title), ...body);
}

// A live region that holds one feedback message; `show()` swaps it in and keeps it visible.
export function feedbackSlot() {
  const slot = h("div", { role: "status", "aria-live": "polite" });
  return {
    el: slot,
    show(ok, title, ...body) {
      slot.replaceChildren(feedbackBox(ok, title, ...body));
      revealInPanel(slot);
    },
    clear: () => slot.replaceChildren(),
  };
}

// A group of pick-one buttons. `mark(i, ok)` shows the picked one as right/wrong.
export function choiceGroup(labels, { className, label, onPick, mono = false }) {
  const buttons = labels.map((text, i) =>
    h("button", { type: "button", class: "choice" + (mono ? " mono" : ""), "aria-pressed": "false", onclick: () => onPick(i) }, text)
  );
  return {
    el: h("div", { class: className, role: "group", "aria-label": label }, buttons),
    mark(i, ok) {
      buttons.forEach((b, j) => {
        b.setAttribute("aria-pressed", String(j === i));
        b.classList.toggle("ok", j === i && ok);
        b.classList.toggle("no", j === i && !ok);
      });
    },
  };
}

// The Learn more tab. `whereLabel` is the small heading above `learn.used_later`.
export function learnPanel(l, whereLabel = "Where you'll use this") {
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
        h("span", { class: "small-label", style: shown.length ? "margin-top:10px" : "" }, whereLabel),
        h("span", { class: "where" }, where)
      )
    )
  );
}

// ---------- page ----------

// Fills the header, builds one panel per tab and wires tabs + Back/Next.
// opts: { labels: [tab names], builders: [l => node], kicker?: string }
export function mountShell(l, { labels, builders, kicker }) {
  document.title = `${l.title} · Python for SDFs`;
  document.getElementById("eyebrow").textContent = kicker || l.kicker;
  document.getElementById("title").textContent = l.title;

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

  tabsEl.style.setProperty("--tab-count", String(labels.length));
  const tabs = labels.map((label, i) =>
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
    stepCount.replaceChildren(`Step ${step + 1} of ${tabs.length}`, h("span", { class: "only-narrow" }, ` · ${labels[step]}`));
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

export function showProblem(err) {
  document.getElementById("title").textContent = "Lesson unavailable";
  document.getElementById("tabs").hidden = true;
  document.querySelector(".nav").hidden = true;
  document.getElementById("panels").replaceChildren(h("div", { class: "error-box", role: "alert" }, h("b", {}, "This lesson can't be shown. "), err.message));
}

// Entry point for every template page: `setup(lesson)` returns the mountShell options.
export function boot(template, setup) {
  load({ expectTemplate: template }).then((l) => mountShell(l, setup(l)), showProblem);
}
