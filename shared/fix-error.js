// Template C: fix the error. Reads ?lesson=<id>, renders 4 tabs:
// Read the error / Find the line / Fix it / Learn more.
import { classifyTrace, codeLineCount, failingLine, FAIL_KINDS } from "./trace.js";
import { h, inline, feedbackSlot, choiceGroup, learnPanel, boot } from "./shell.js";

const TAB_LABELS = ["Read the error", "Find the line", "Fix it", "Learn more"];
const LAST_ERROR_NUMBER = 8;

// The traceback as Colab shows it. `highlight` is "last" (tab 1) or "fail" (tabs 2-3):
// the ----> line, or for SyntaxError/IndentationError the File line, source line and ^ caret.
function traceBlock(l, highlight) {
  return h(
    "div",
    { class: "stack", style: "gap:6px" },
    h("span", { class: "small-label" }, "You ran this cell and got"),
    h(
      "div",
      { class: "trace", role: "group", "aria-label": "The error message from the cell", tabindex: "0" },
      h(
        "div",
        { class: "trace-inner" },
        classifyTrace(l.traceback).map((t) => {
          const hl = highlight === "fail" ? FAIL_KINDS.includes(t.kind) : t.kind === highlight;
          return h("span", { class: `tl ${t.kind}${hl ? " hl" : ""}` }, t.text);
        })
      )
    )
  );
}

function readPanel(l) {
  return h(
    "div",
    { class: "stack", style: "gap:14px" },
    traceBlock(l, "last"),
    l.notes.length
      ? h(
          "div",
          { class: "stack", style: "gap:10px" },
          h("h2", { style: "font-size:22px" }, "Start at the bottom"),
          h("div", { class: "note-cards" }, l.notes.map((n) => h("div", { class: "note-card" }, h("span", { class: "nc-label" }, n.label), h("span", { class: "nc-text" }, inline(n.text)))))
        )
      : null
  );
}

function linePanel(l) {
  const slot = feedbackSlot();
  const n = codeLineCount(l.code);
  const caret = failingLine(l.traceback)?.shape === "caret";
  const group = choiceGroup(
    Array.from({ length: n }, (_, i) => `Line ${i + 1}`),
    {
      className: "choices-row",
      label: "Which line failed?",
      onPick(i) {
        const ok = i + 1 === l.arrow_line;
        group.mark(i, ok);
        slot.show(
          ok,
          ok ? "Correct!" : "Not quite",
          h("span", { class: "fb-msg" }, ok ? (caret ? "Right. The File line names the line number, and the ^ points at the spot." : "Right. The arrow ----> always points at the line that failed.") : (caret ? `Line ${i + 1} isn't the one that failed. Look at the top line, File "…", line N: it names the line, and the ^ points at the spot.` : `Line ${i + 1} isn't the one that failed. Look for the arrow ----> in the traceback: it always points at the line that failed.`))
        );
      },
    }
  );
  return h("div", { class: "stack", style: "gap:14px" }, traceBlock(l, "fail"), h("div", { class: "stack", style: "gap:10px" }, h("h2", { style: "font-size:22px" }, "Which line failed?"), group.el, slot.el));
}

function fixPanel(l) {
  const slot = feedbackSlot();
  const group = choiceGroup(
    l.fixes.map((f) => f.label),
    {
      className: "choices-col",
      label: "Possible fixes",
      mono: true,
      onPick(i) {
        const f = l.fixes[i];
        group.mark(i, f.ok);
        slot.show(f.ok, f.title, h("span", { class: "fb-msg" }, inline(f.feedback)));
      },
    }
  );
  return h("div", { class: "stack", style: "gap:14px" }, traceBlock(l, "fail"), h("div", { class: "stack", style: "gap:10px" }, h("h2", { style: "font-size:22px" }, `Pick the best fix for line ${l.arrow_line}`), group.el, slot.el));
}

boot("fix-error", (l) => ({
  kicker: `${l.kicker} · ${l.number} of ${LAST_ERROR_NUMBER}`,
  labels: TAB_LABELS,
  builders: [readPanel, linePanel, fixPanel, (l) => learnPanel(l, l.number < LAST_ERROR_NUMBER ? "Next error" : "Where you'll use this")],
}));
