// Template B: read the code. Reads ?lesson=<id>, renders 3 tabs:
// Read it / Predict / Learn more.
import { isLoadFailure } from "./check.js";
import { h, inline, safeRun, loadFailureNode, runErrorText, revealInPanel, feedbackSlot, choiceGroup, learnPanel, boot } from "./shell.js";

const TAB_LABELS = ["Read it", "Predict", "Learn more"];

function readPanel(l) {
  const total = l.lines.length;
  const seen = new Set([0]);
  let sel = 0;

  const kick = h("span", { class: "kick" });
  const title = h("span", { class: "ex-title" });
  const text = h("span", { class: "ex-text" });
  const card = h("div", { class: "explain", role: "status", "aria-live": "polite" }, kick, title, text);
  const count = h("span", { class: "seen-count" });
  const buttons = l.lines.map((ln, i) =>
    h(
      "button",
      { type: "button", class: "code-line", "aria-pressed": "false", onclick: () => select(i) },
      h("span", { class: "ln", "aria-hidden": "true" }, String(i + 1)),
      h("span", { class: "code-text" }, ln.code)
    )
  );

  function select(i, reveal = true) {
    sel = i;
    seen.add(i);
    buttons.forEach((b, j) => {
      b.setAttribute("aria-pressed", String(j === sel));
      b.classList.toggle("seen", seen.has(j));
    });
    const ln = l.lines[i];
    kick.textContent = `Line ${i + 1}`;
    title.textContent = ln.title;
    text.replaceChildren(...inline(ln.text));
    count.textContent = `You've looked at ${seen.size} of ${total} lines.`;
    if (reveal) revealInPanel(card);
  }

  const panel = h(
    "div",
    { class: "stack", style: "gap:14px" },
    h("p", { class: "lead", style: "font-size:15px" }, h("strong", {}, "Click each line"), " to see what it does."),
    h("div", { class: "read" }, h("div", { class: "code-lines", role: "group", "aria-label": "The code, one button per line" }, buttons), card),
    count
  );
  select(0, false);
  return panel;
}

function predictPanel(l) {
  const p = l.predict;
  const slot = feedbackSlot();
  const outEl = h("pre", { class: "out" });
  const outWrap = h("div", { class: "output-block", hidden: true }, h("span", { class: "small-label" }, "Full output"), outEl);
  let outputRun = null; // the verify run happens once, on the first correct pick
  let token = 0;

  async function showOutput(my) {
    if (!l.verify) return;
    outputRun ||= safeRun(l.verify.setup + "\n" + l.verify.code);
    outEl.replaceChildren("Running…");
    outWrap.hidden = false;
    const r = await outputRun;
    if (my !== token) return; // the student picked something else meanwhile
    outEl.replaceChildren();
    if (isLoadFailure(r)) outEl.append(loadFailureNode());
    else if (r.timedOut || r.error) outEl.append(runErrorText(r));
    else outEl.append(r.stdout.trimEnd() || "(no output)");
    revealInPanel(outWrap);
  }

  const group = choiceGroup(p.options.map((o) => o.label), {
    className: "choices-grid",
    label: "Your prediction",
    mono: true,
    onPick(i) {
      const o = p.options[i];
      const my = ++token;
      group.mark(i, o.ok);
      outWrap.hidden = true;
      slot.show(o.ok, o.ok ? "Correct!" : "Not quite", h("span", { class: "fb-msg" }, inline(o.feedback)));
      if (o.ok) showOutput(my);
    },
  });

  return h(
    "div",
    { class: "stack", style: "gap:14px" },
    h("h2", {}, "Predict the output"),
    h("p", { class: "lead", style: "font-size:15px" }, inline(p.question)),
    group.el,
    slot.el,
    outWrap
  );
}

boot("read-code", () => ({ labels: TAB_LABELS, builders: [readPanel, predictPanel, (l) => learnPanel(l, "Where you'll see this")] }));
