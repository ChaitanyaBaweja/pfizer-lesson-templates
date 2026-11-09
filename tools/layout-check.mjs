// Headless-Chrome layout check for Templates A, B and C, run inside iframes
// of the sizes Notion embeds actually use. Needs Chrome and internet (Pyodide CDN).
//   node tools/layout-check.mjs            (starts its own static server on :8766)
//   CHROME="path/to/chrome.exe" node tools/layout-check.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "package.json"));
const WebSocket = require("ws");

const PORT = 8766;
const DEBUG = 9335;
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SIZES = [
  [940, 620],
  [700, 620],
  [700, 420],
  [360, 740],
  [700, 320], // default Notion embed height
  [560, 620], // narrowest width where all tab labels must stay visible
];
const TALL = [940, 1000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [join(root, "tools/serve.mjs")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const chrome = spawn(
  CHROME,
  ["--headless=new", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmpdir(), "layout-check-" + Date.now())}`, "--no-first-run", "about:blank"],
  { stdio: "ignore" }
);
function cleanup() {
  server.kill();
  chrome.kill();
}

let targets;
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json();
    if (targets.find((t) => t.type === "page")) break;
  } catch {
    /* not up yet */
  }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let nextId = 0;
const pending = new Map();
ws.on("message", (m) => {
  const d = JSON.parse(m);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed");
  return r.result.result.value;
};

// All checks run inside the iframe's document, through `F` (the iframe window).
const IN_FRAME = `
const F = document.getElementById("f").contentWindow;
const D = F.document;
const $ = (s) => D.querySelector(s);
const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= -0.5 && r.left >= -0.5 && r.bottom <= F.innerHeight + 0.5 && r.right <= F.innerWidth + 0.5; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

const failures = [];
const report = [];

// Opens `page` (e.g. "concept.html?lesson=lists") in an iframe of w x h and returns
// helpers that record pass/fail rows. Every check runs inside the iframe's document.
async function openLesson(w, h, page) {
  const rows = [];
  const tag = `${page.split("?")[0]} ${w}x${h}`;
  const fail = (msg) => {
    rows.push("  FAIL " + msg);
    failures.push(`${tag}: ${msg}`);
  };
  const pass = (msg) => rows.push("  ok   " + msg);

  await send("Page.navigate", { url: `http://localhost:${PORT}/nothing-here` });
  await sleep(500);
  await ev(`document.body.innerHTML = '<iframe id="f" src="/${page}" style="border:0;width:${w}px;height:${h}px"></iframe>'; document.body.style.margin = 0;`);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await ev(`(() => { try { return !!document.getElementById("f").contentDocument.querySelector("[role=tab]"); } catch { return false; } })()`)) break;
  }

  // Run a check expression in the frame; returns JSON.
  const q = (body) => ev(`(async () => { ${IN_FRAME} ${body} })()`);

  const docNoScroll = async (label) => {
    const r = await q(`const e = D.documentElement, b = D.body;
      return { eh: e.scrollHeight - e.clientHeight, bh: b.scrollHeight - b.clientHeight, ew: e.scrollWidth - e.clientWidth, st: e.scrollTop + b.scrollTop };`);
    if (r.eh > 1 || r.bh > 1 || r.ew > 1 || r.st > 0) fail(`${label}: document scrolls ${JSON.stringify(r)}`);
  };
  const hostScroll = async (label) => {
    const y = await ev(`window.scrollY + window.scrollX`);
    if (y !== 0) fail(`${label}: the parent page was scrolled (${y})`);
  };
  const chromeVisible = async (label) => {
    await hostScroll(label);
    const r = await q(`return { back: inView($("#back")), next: inView($("#next")), tabs: [...D.querySelectorAll("[role=tab]")].every(inView), title: inView($("#title")) };`);
    if (!r.back || !r.next) fail(`${label}: Back/Next not fully in the viewport`);
    if (!r.tabs) fail(`${label}: tab row not fully in the viewport`);
    if (!r.title) fail(`${label}: title not in the viewport`);
  };
  // Is the element fully inside the scrolling panel (or taller than it, with its top shown)?
  // Returns null when the element is missing or not shown.
  const inPanel = (sel) =>
    q(`const el = $(${JSON.stringify(sel)}); if (!el || !vis(el)) return null; const p = $("#panels").getBoundingClientRect(); const r = el.getBoundingClientRect();
      return r.top >= p.top - 1 && (r.bottom <= p.bottom + 1 || r.height > p.height);`);
  const both = async (label) => {
    await docNoScroll(label);
    await chromeVisible(label);
  };
  // Visits every tab: nothing scrolls the document, header/tabs/Back/Next stay in view.
  const eachTab = async (names, onTab = async () => {}) => {
    for (let i = 0; i < names.length; i++) {
      await q(`$("#tab-${i}").click(); await wait(80);`);
      const label = `tab ${i + 1} (${names[i]})`;
      await both(label);
      await onTab(i, label);
    }
  };
  // Tab labels: visible at >= 560 wide, numbers-only below ~520; touch targets >= 44px.
  const tabLabels = async (count) => {
    const lab = await q(`return [...D.querySelectorAll(".tab")].map((t) => { const l = t.querySelector(".tab-label"); const r = l.getBoundingClientRect(); return { w: r.width, clipped: l.scrollWidth > l.clientWidth + 1 || r.right > t.getBoundingClientRect().right + 0.5, h: t.getBoundingClientRect().height, tw: t.getBoundingClientRect().width }; });`);
    if (lab.length !== count) fail(`expected ${count} tabs, found ${lab.length}`);
    if (w >= 560) {
      lab.forEach((l, i) => {
        if (l.w < 20 || l.clipped) fail(`tab label ${i + 1} not fully visible (${JSON.stringify(l)})`);
      });
      pass(`all ${count} tab labels visible`);
    } else {
      pass("numbers-only tabs (narrow layout)");
    }
    lab.forEach((l, i) => {
      if (l.h < 44 || l.tw < 44) fail(`tab ${i + 1} touch target ${l.tw}x${l.h}`);
    });
  };
  const buttonSizes = async () => {
    const small = await q(`return [...D.querySelectorAll("button")].filter((b) => vis(b)).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => b.textContent.trim() + " " + b.getBoundingClientRect().width + "x" + b.getBoundingClientRect().height);`);
    if (small.length) fail("buttons under 44px: " + small.join(", "));
    else pass("all visible buttons >= 44px");
  };
  const screenshot = async (name) => {
    if (!process.env.SHOT_DIR) return;
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    (await import("node:fs")).writeFileSync(join(process.env.SHOT_DIR, `${name}-${w}x${h}.png`), Buffer.from(shot.result.data, "base64"));
  };
  const finish = () => {
    const fails = rows.filter((r) => r.startsWith("  FAIL")).length;
    report.push(`${tag}: ${fails === 0 ? "PASS" : "FAIL (" + fails + ")"}\n${rows.join("\n")}`);
  };
  return { q, fail, pass, both, inPanel, eachTab, tabLabels, buttonSizes, screenshot, finish };
}

// ---------- Template A ----------
async function checkConcept(w, h) {
  const t = await openLesson(w, h, "concept.html?lesson=lists");
  const { q, fail, pass, both, inPanel } = t;

  await t.eachTab(["What is it?", "Example", "Demo", "Try it", "Learn more"], async (i) => {
    if (i === 0 && w === 940 && h === 620) {
      const r = await q(`const p = $("#panels"); return p.scrollHeight - p.clientHeight;`);
      if (r > 1) fail(`What is it? needs panel scrolling at 940x620 (${r}px extra)`);
      else pass("What is it? fits in the panel without scrolling");
    }
  });
  await t.tabLabels(5);

  // Demo: run, output scrolls into view inside the panel.
  await q(`$("#tab-2").click(); await wait(80); $("#panel-2 .btn-primary").click();
    for (let i = 0; i < 80 && (D.querySelector("#panel-2 [role=status] div[hidden]") || $("#panel-2 .btn-primary").disabled); i++) await wait(250);`);
  const shown = await inPanel("#panel-2 .out");
  if (shown === null) fail("demo output not shown (did Python load? needs internet)");
  else if (!shown) fail("demo output not scrolled into view in the panel");
  await both("demo after Run");

  // Try it: wrong check, second wrong check, Show answer.
  await q(`$("#tab-3").click(); await wait(80);`);
  const tryStep = async (code) => {
    await q(`$("#code-box").value = ${JSON.stringify(code)}; $("#panel-3 .btn-primary").click(); await wait(100);
      for (let i = 0; i < 80 && $("#panel-3 .btn-primary").disabled; i++) await wait(250);`);
    return { fb: await q(`return !!$("#feedback .feedback");`), inPanel: await inPanel("#feedback .feedback") };
  };
  const wrongCode = 'doc_types = ["Cover Letter", "Certificate of Quality"]\nprint(doc_types)';
  for (let n = 1; n <= 2; n++) {
    const r = await tryStep(wrongCode);
    if (!r.fb) fail(`Try it wrong check #${n}: no feedback shown`);
    else if (!r.inPanel) fail(`Try it wrong check #${n}: feedback not scrolled into view`);
    await both(`Try it after wrong check #${n}`);
  }
  const rev = await q(`const b = $("#panel-3 .btn-link"); if (b.hidden) return { shown: false }; b.click(); await wait(150);
    return { shown: !$("#answer").hidden, focused: D.activeElement === $("#answer") };`);
  if (!rev.shown) fail("Show answer did not appear after 2 wrong tries");
  else {
    if (!(await inPanel("#answer"))) fail("answer not scrolled into view in the panel");
    if (!rev.focused) fail("keyboard focus was lost after Show answer hid itself (should be on the answer)");
    else pass("focus moves to the answer after Show answer");
  }
  await t.screenshot("try");
  await both("Try it after Show answer");
  // Correct answer
  const ok = await tryStep('doc_types = ["Cover Letter", "Certificate of Quality"]\ndoc_types.append("Material Description")\nprint(doc_types)');
  if (!ok.fb) fail("correct answer: no feedback");
  await both("Try it after correct answer");

  await t.buttonSizes();
  t.finish();
}

// ---------- Template B ----------
async function checkReadCode(w, h) {
  const t = await openLesson(w, h, "read-code.html?lesson=read-imports-with");
  const { q, fail, pass, both, inPanel } = t;

  await t.eachTab(["Read it", "Predict", "Learn more"]);
  await t.tabLabels(3);

  // Read it: click the last line; its explanation is shown in the panel, the count goes up.
  await q(`$("#tab-0").click(); await wait(80); const b = D.querySelectorAll("#panel-0 .code-line"); b[b.length - 1].click(); await wait(80);`);
  const seen = await q(`return $("#panel-0 .seen-count").textContent;`);
  if (!/looked at 2 of 5 lines/.test(seen)) fail(`seen counter wrong: "${seen}"`);
  else pass("seen counter counts clicked lines");
  if (!(await inPanel("#panel-0 .explain"))) fail("line explanation not visible in the panel after a click");
  await both("Read it after clicking a line");
  await t.screenshot("read-click");

  // Predict: a wrong then the right answer.
  await q(`$("#tab-1").click(); await wait(80); D.querySelectorAll("#panel-1 .choice")[0].click(); await wait(100);`);
  if (!(await inPanel("#panel-1 .feedback.no"))) fail("Predict wrong answer: feedback not visible in the panel");
  await both("Predict after a wrong answer");
  await t.screenshot("predict-wrong");
  await q(`D.querySelectorAll("#panel-1 .choice")[1].click(); await wait(100);`);
  if (!(await inPanel("#panel-1 .feedback.ok"))) fail("Predict right answer: feedback not visible in the panel");
  const out = await q(`return !!D.querySelector("#panel-1 .output-block:not([hidden])");`);
  if (out) fail("an output block is shown although the lesson has verify: null");
  await both("Predict after the right answer");
  await t.screenshot("predict-right");

  await t.buttonSizes();
  t.finish();
}

// ---------- Template C ----------
async function checkFixError(w, h) {
  const t = await openLesson(w, h, "fix-error.html?lesson=err-key");
  const { q, fail, pass, both, inPanel } = t;

  const hl = (i) => q(`return [...D.querySelectorAll("#panel-${i} .tl.hl")].map((e) => e.className);`);
  await t.eachTab(["Read the error", "Find the line", "Fix it", "Learn more"], async (i, label) => {
    if (i === 0) {
      const r = await hl(0);
      if (r.length !== 1 || !/last/.test(r[0])) fail(`${label}: should highlight only the last line (${JSON.stringify(r)})`);
    }
    if (i === 1 || i === 2) {
      const r = await hl(i);
      if (r.length !== 1 || !/arrow/.test(r[0])) fail(`${label}: should highlight only the arrow line (${JSON.stringify(r)})`);
    }
  });
  await t.tabLabels(4);
  const kicker = await q(`return $("#eyebrow").textContent;`);
  if (!/Fix the error · 5 of 8/.test(kicker)) fail(`kicker is "${kicker}"`);
  else pass("kicker shows the error number");

  // Find the line: wrong (line 1) then right (line 2).
  await q(`$("#tab-1").click(); await wait(80); D.querySelectorAll("#panel-1 .choice")[0].click(); await wait(100);`);
  if (!(await inPanel("#panel-1 .feedback.no"))) fail("Find the line wrong answer: feedback not visible in the panel");
  await both("Find the line after a wrong answer");
  await q(`D.querySelectorAll("#panel-1 .choice")[1].click(); await wait(100);`);
  if (!(await inPanel("#panel-1 .feedback.ok"))) fail("Find the line right answer: feedback not visible in the panel");
  await both("Find the line after the right answer");

  // Fix it: a wrong then the right fix.
  await q(`$("#tab-2").click(); await wait(80); D.querySelectorAll("#panel-2 .choice")[1].click(); await wait(100);`);
  if (!(await inPanel("#panel-2 .feedback.no"))) fail("Fix it wrong answer: feedback not visible in the panel");
  await both("Fix it after a wrong answer");
  await t.screenshot("fix-wrong");
  await q(`D.querySelectorAll("#panel-2 .choice")[0].click(); await wait(100);`);
  if (!(await inPanel("#panel-2 .feedback.ok"))) fail("Fix it right answer: feedback not visible in the panel");
  await both("Fix it after the right answer");
  await t.screenshot("fix-right");

  await t.buttonSizes();
  t.finish();
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  // Big host window, so the host page never scrolls to fit the iframe.
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [w, h] of SIZES) {
    await checkConcept(w, h);
    await checkReadCode(w, h);
    await checkFixError(w, h);
  }
  // A tall iframe (a Notion embed stretched to ~1000px): nothing should break or float.
  await checkConcept(...TALL);
  await checkReadCode(...TALL);
  await checkFixError(...TALL);
} catch (e) {
  failures.push("script error: " + e.message);
  report.push("script error: " + e.stack);
}
console.log(report.join("\n\n"));
console.log(failures.length ? `\nRESULT: ${failures.length} failure(s)` : "\nRESULT: all sizes pass");
ws.close();
cleanup();
process.exit(failures.length ? 1 : 0);
