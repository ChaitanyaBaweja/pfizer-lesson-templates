// Template A: concept lesson page. Reads ?lesson=<id>, renders 5 tabs:
// What is it? / Example / Demo / Try it / Learn more.
// All lesson text goes in via textContent (never innerHTML); `inline()` turns
// `code` and **bold** in lesson text into real elements.
import { evalChecks } from "./runner.js";
import { judge, revealAllowed, isLoadFailure } from "./check.js";
import { h, inline, loadFailureNode, startFailed, safeRun, runErrorText, revealInPanel, focusRevealed, feedbackSlot, learnPanel, boot } from "./shell.js";

const TAB_LABELS = ["What is it?", "Example", "Demo", "Try it", "Learn more"];

async function safeEval(code, exprs) {
  try {
    return await evalChecks(code, exprs);
  } catch (e) {
    return { run: startFailed(e), values: [] };
  }
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
    revealInPanel(outWrap);
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
  const slot = feedbackSlot();
  const feedback = slot.el;
  feedback.id = "feedback";
  const answer = h("div", { hidden: true, id: "answer", class: "answer-box" }, h("span", { class: "small-label" }, "One way to do it"), h("pre", { class: "answer" }, t.solution));

  function syncReveal() {
    revealBtn.hidden = !(revealAllowed(wrong) && !solved && !revealed);
  }
  // Keeps the new message visible inside the scrolling panel (never scrolls the page).
  const showFeedback = slot.show;

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
    if (verdict.ok) solved = true;
    else wrong += 1;
    // Update the button row first: a newly shown "Show answer" button can wrap
    // onto a new line and push the feedback down.
    syncReveal();
    if (verdict.ok) {
      showFeedback(true, "Correct!", h("span", { class: "fb-msg" }, "That matches what we expected. Here is what printed:"), h("pre", {}, r.stdout.trimEnd()));
    } else {
      showFeedback(false, "Not quite yet", h("span", { class: "fb-msg" }, verdict.hint));
    }
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
    slot.clear();
    answer.hidden = true;
    syncReveal();
    box.focus();
  });
  revealBtn.addEventListener("click", () => {
    revealed = true;
    answer.hidden = false;
    syncReveal();
    // "Show answer" just hid itself: keep keyboard focus by moving it to the answer.
    focusRevealed(answer);
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

boot("concept", () => ({ labels: TAB_LABELS, builders: [whatPanel, examplePanel, demoPanel, tryPanel, (l) => learnPanel(l)] }));
