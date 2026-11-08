// Headless-Chrome layout check for Template A (concept.html), run inside iframes
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

async function checkSize(w, h) {
  const rows = [];
  const fail = (msg) => {
    rows.push("  FAIL " + msg);
    failures.push(`${w}x${h}: ${msg}`);
  };
  const pass = (msg) => rows.push("  ok   " + msg);

  await send("Page.navigate", { url: `http://localhost:${PORT}/nothing-here` });
  await sleep(500);
  await ev(`document.body.innerHTML = '<iframe id="f" src="/concept.html?lesson=lists" style="border:0;width:${w}px;height:${h}px"></iframe>'; document.body.style.margin = 0;`);
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

  // Tabs, one by one.
  const names = ["What is it?", "Example", "Demo", "Try it", "Learn more"];
  for (let i = 0; i < 5; i++) {
    await q(`$("#tab-${i}").click(); await wait(80);`);
    const label = `tab ${i + 1} (${names[i]})`;
    await docNoScroll(label);
    await chromeVisible(label);
    if (i === 0 && w === 940 && h === 620) {
      const r = await q(`const p = $("#panels"); return p.scrollHeight - p.clientHeight;`);
      if (r > 1) fail(`What is it? needs panel scrolling at 940x620 (${r}px extra)`);
      else pass("What is it? fits in the panel without scrolling");
    }
  }

  // Tab labels: visible at >= 560 wide, numbers-only below ~520.
  const lab = await q(`return [...D.querySelectorAll(".tab")].map((t) => { const l = t.querySelector(".tab-label"); const r = l.getBoundingClientRect(); return { w: r.width, clipped: l.scrollWidth > l.clientWidth + 1 || r.right > t.getBoundingClientRect().right + 0.5, h: t.getBoundingClientRect().height, tw: t.getBoundingClientRect().width }; });`);
  if (w >= 560) {
    lab.forEach((l, i) => {
      if (l.w < 20 || l.clipped) fail(`tab label ${i + 1} not fully visible (${JSON.stringify(l)})`);
    });
    pass("all 5 tab labels visible");
  } else {
    pass("numbers-only tabs (narrow layout)");
  }
  lab.forEach((l, i) => {
    if (l.h < 44 || l.tw < 44) fail(`tab ${i + 1} touch target ${l.tw}x${l.h}`);
  });

  // Demo: run, output scrolls into view inside the panel.
  await q(`$("#tab-2").click(); await wait(80); $("#panel-2 .btn-primary").click();
    for (let i = 0; i < 80 && (D.querySelector("#panel-2 [role=status] div[hidden]") || $("#panel-2 .btn-primary").disabled); i++) await wait(250);`);
  const d = await q(`const o = $("#panel-2 .out"); const p = $("#panels").getBoundingClientRect(); const r = o.getBoundingClientRect();
    return { shown: vis(o), inPanel: r.top >= p.top - 1 && (r.bottom <= p.bottom + 1 || r.height > p.height) };`);
  if (!d.shown) fail("demo output not shown (did Python load? needs internet)");
  else if (!d.inPanel) fail("demo output not scrolled into view in the panel");
  await docNoScroll("demo after Run");
  await chromeVisible("demo after Run");

  // Try it: wrong check, second wrong check, Show answer.
  await q(`$("#tab-3").click(); await wait(80);`);
  const tryStep = async (code) =>
    q(`$("#code-box").value = ${JSON.stringify(code)}; $("#panel-3 .btn-primary").click(); await wait(100);
      for (let i = 0; i < 80 && $("#panel-3 .btn-primary").disabled; i++) await wait(250);
      const f = $("#feedback .feedback"); const p = $("#panels").getBoundingClientRect(); const r = f ? f.getBoundingClientRect() : null;
      return { fb: !!f, inPanel: r ? (r.top >= p.top - 1 && (r.bottom <= p.bottom + 1 || r.height > p.height)) : false };`);
  const wrongCode = 'doc_types = ["Cover Letter", "Certificate of Quality"]\nprint(doc_types)';
  for (let n = 1; n <= 2; n++) {
    const r = await tryStep(wrongCode);
    if (!r.fb) fail(`Try it wrong check #${n}: no feedback shown`);
    else if (!r.inPanel) fail(`Try it wrong check #${n}: feedback not scrolled into view`);
    await docNoScroll(`Try it after wrong check #${n}`);
    await chromeVisible(`Try it after wrong check #${n}`);
  }
  const rev = await q(`const b = $("#panel-3 .btn-link"); if (b.hidden) return { shown: false }; b.click(); await wait(150);
    const a = $("#answer"); const p = $("#panels").getBoundingClientRect(); const r = a.getBoundingClientRect();
    return { shown: !a.hidden, inPanel: r.top >= p.top - 1 && (r.bottom <= p.bottom + 1 || r.height > p.height) };`);
  if (!rev.shown) fail("Show answer did not appear after 2 wrong tries");
  else if (!rev.inPanel) fail("answer not scrolled into view in the panel");
  if (process.env.SHOT_DIR) {
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
    (await import("node:fs")).writeFileSync(join(process.env.SHOT_DIR, `try-${w}x${h}.png`), Buffer.from(shot.result.data, "base64"));
  }
  await docNoScroll("Try it after Show answer");
  await chromeVisible("Try it after Show answer");
  // Correct answer
  const ok = await tryStep('doc_types = ["Cover Letter", "Certificate of Quality"]\ndoc_types.append("Material Description")\nprint(doc_types)');
  if (!ok.fb) fail("correct answer: no feedback");
  await docNoScroll("Try it after correct answer");
  await chromeVisible("Try it after correct answer");

  // Every visible button is >= 44px in both directions.
  const small = await q(`return [...D.querySelectorAll("button")].filter((b) => vis(b)).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => b.textContent.trim() + " " + b.getBoundingClientRect().width + "x" + b.getBoundingClientRect().height);`);
  if (small.length) fail("buttons under 44px: " + small.join(", "));
  else pass("all visible buttons >= 44px");

  const fails = rows.filter((r) => r.startsWith("  FAIL")).length;
  report.push(`${w}x${h}: ${fails === 0 ? "PASS" : "FAIL (" + fails + ")"}\n${rows.join("\n")}`);
}

try {
  await send("Runtime.enable");
  await send("Page.enable");
  // Big host window, so the host page never scrolls to fit the iframe.
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const [w, h] of SIZES) await checkSize(w, h);
} catch (e) {
  failures.push("script error: " + e.message);
  report.push("script error: " + e.stack);
}
console.log(report.join("\n\n"));
console.log(failures.length ? `\nRESULT: ${failures.length} failure(s)` : "\nRESULT: all sizes pass");
ws.close();
cleanup();
process.exit(failures.length ? 1 : 0);
