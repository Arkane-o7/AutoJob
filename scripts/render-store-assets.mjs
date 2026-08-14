import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "store-assets/2026-08");
const capture = (name) => resolve(root, "output/playwright", name);

const wordmark = `data:image/png;base64,${(await readFile(resolve(root, "assets/brand/scout-wordmark.png"))).toString("base64")}`;
await mkdir(output, { recursive: true });

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function imageData(path) {
  return `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
}

const sharedCSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body { color: #151610; background: #f4f1e7; font-family: "Avenir Next", Avenir, Arial, sans-serif; }
  .shot { position: relative; width: 1280px; height: 800px; overflow: hidden; background: var(--ground); }
  .shot::before { content: ""; position: absolute; inset: 0; opacity: .34; background-image: linear-gradient(rgba(21,22,16,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(21,22,16,.10) 1px, transparent 1px); background-size: 28px 28px; mask-image: linear-gradient(90deg, #000 0 34%, transparent 66%); }
  .topline { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; height: 78px; padding: 18px 34px; border-bottom: 2px solid #151610; background: rgba(244,241,231,.92); }
  .topline img { width: 142px; height: 46px; object-fit: contain; object-position: left center; }
  .topmeta { display: flex; align-items: center; gap: 12px; font: 800 11px/1 "Courier New", monospace; letter-spacing: .12em; text-transform: uppercase; }
  .topmeta strong { display: grid; place-items: center; min-width: 48px; height: 30px; border: 2px solid #151610; background: var(--accent); }
  .body { position: relative; z-index: 1; display: grid; grid-template-columns: 370px 1fr; gap: 30px; height: 658px; padding: 34px 34px 24px; }
  .copy { align-self: center; padding: 0 8px 18px 2px; }
  .eyebrow { margin: 0 0 20px; font: 800 11px/1 "Courier New", monospace; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: 0; max-width: 360px; font: 400 54px/.93 Georgia, serif; letter-spacing: -.045em; }
  h1 em { color: var(--emphasis); font-weight: 400; }
  .lede { max-width: 320px; margin: 24px 0 0; font-size: 17px; line-height: 1.45; }
  .guardrail { display: inline-flex; align-items: center; gap: 8px; margin-top: 24px; padding: 10px 13px; border: 2px solid #151610; background: rgba(244,241,231,.88); font: 800 10px/1 "Courier New", monospace; letter-spacing: .08em; text-transform: uppercase; box-shadow: 5px 5px 0 #151610; }
  .guardrail i { width: 11px; height: 11px; border-radius: 50%; background: var(--accent); border: 1px solid #151610; }
  .visual { align-self: center; min-width: 0; }
  .browser { position: relative; height: 566px; border: 3px solid #151610; border-radius: 16px 16px 8px 8px; overflow: hidden; background: #fff; box-shadow: 13px 13px 0 #151610; }
  .chrome { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border-bottom: 2px solid #151610; background: #f4f1e7; }
  .chrome i { width: 9px; height: 9px; border: 1px solid #151610; border-radius: 50%; background: #ff6b4a; }
  .chrome i:nth-child(2) { background: #ffd15c; }
  .chrome i:nth-child(3) { background: #b7ff3c; }
  .chrome span { margin-left: 8px; color: #53554c; font: 700 9px/1 "Courier New", monospace; letter-spacing: .08em; text-transform: uppercase; }
  .screen { height: calc(100% - 36px); overflow: hidden; background: #f4f1e7; }
  .screen img { display: block; width: 100%; height: 100%; object-fit: var(--fit); object-position: var(--position); }
  .rail { position: absolute; z-index: 3; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(5, 1fr); height: 64px; border-top: 2px solid #151610; background: #151610; }
  .rail span { display: flex; align-items: center; justify-content: center; gap: 9px; color: #f4f1e7; border-right: 1px solid #55574e; font: 800 10px/1 "Courier New", monospace; letter-spacing: .08em; text-transform: uppercase; }
  .rail span:last-child { border-right: 0; }
  .rail span::before { content: attr(data-step); display: grid; place-items: center; width: 22px; height: 22px; border: 1px solid currentColor; border-radius: 50%; }
  .rail span.active { color: #151610; background: var(--accent); }
`;

const slides = [
  {
    file: "scout-01-autofill-1280x800.png", source: "autofill-review.png", step: 1,
    ground: "#b7ff3c", accent: "#b7ff3c", emphasis: "#4d541a", position: "center bottom", fit: "contain",
    eyebrow: "Job application autofill", title: "Fill the form. <em>Review every answer.</em>",
    lede: "Scout fills only after you choose it, then leaves submission completely to you.", guardrail: "Never clicks Apply or Submit"
  },
  {
    file: "scout-02-profile-1280x800.png", source: "profile-overview.png", step: 2,
    ground: "#ddd6ff", accent: "#b7ff3c", emphasis: "#5c4da1", position: "center top", fit: "cover",
    eyebrow: "One reusable profile", title: "Tell Scout once. <em>Use it everywhere.</em>",
    lede: "Keep your resume, work history, links, and reviewed answers ready for the next application.", guardrail: "Your facts stay editable"
  },
  {
    file: "scout-03-pipeline-1280x800.png", source: "pipeline-workspace.png", step: 3,
    ground: "#f4f1e7", accent: "#b7ff3c", emphasis: "#59604e", position: "center top", fit: "cover",
    eyebrow: "Job application tracker", title: "Every role. <em>One clear pipeline.</em>",
    lede: "Save opportunities, compare priorities, and move each application from first look to offer.", guardrail: "Board and list views"
  },
  {
    file: "scout-04-actions-1280x800.png", source: "today-workspace.png", step: 4,
    ground: "#ffd8cf", accent: "#b7ff3c", emphasis: "#b34731", position: "center top", fit: "cover",
    eyebrow: "Follow-through", title: "Know what needs <em>attention today.</em>",
    lede: "Deadlines, interview prep, and follow-ups become one focused action desk.", guardrail: "Complete, snooze, reschedule"
  },
  {
    file: "scout-05-network-1280x800.png", source: "people-workspace-rich.png", step: 5,
    ground: "#cfeeff", accent: "#b7ff3c", emphasis: "#326a85", position: "center top", fit: "cover",
    eyebrow: "People and companies", title: "Keep the whole story <em>connected.</em>",
    lede: "Link recruiters, referrals, interviews, and next actions to the opportunities that matter.", guardrail: "No inbox or message reading"
  }
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  for (const slide of slides) {
    const source = await imageData(capture(slide.source));
    const rail = ["Fill", "Profile", "Track", "Act", "Connect"].map((label, index) => `<span class="${index + 1 === slide.step ? "active" : ""}" data-step="${index + 1}">${label}</span>`).join("");
    await page.setContent(`<!doctype html><html><head><style>${sharedCSS}</style></head><body><main class="shot" style="--ground:${slide.ground};--accent:${slide.accent};--emphasis:${slide.emphasis};--position:${slide.position};--fit:${slide.fit}"><header class="topline"><img src="${wordmark}" alt="Scout"><div class="topmeta"><span>Chrome extension</span><strong>${String(slide.step).padStart(2, "0")}/05</strong></div></header><section class="body"><div class="copy"><p class="eyebrow">${escapeHTML(slide.eyebrow)}</p><h1>${slide.title}</h1><p class="lede">${escapeHTML(slide.lede)}</p><div class="guardrail"><i></i>${escapeHTML(slide.guardrail)}</div></div><div class="visual"><div class="browser"><div class="chrome"><i></i><i></i><i></i><span>Scout · private job-search workspace</span></div><div class="screen"><img src="${source}" alt=""></div></div></div></section><nav class="rail">${rail}</nav></main></body></html>`, { waitUntil: "load" });
    await page.screenshot({ path: resolve(output, slide.file) });
  }

  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<!doctype html><html><head><style>${sharedCSS}
    .promo-small { width:440px; height:280px; overflow:hidden; padding:20px 22px; color:#151610; background:#b7ff3c; border:0; position:relative; }
    .promo-small::after { content:""; position:absolute; right:-34px; bottom:-46px; width:230px; height:230px; border:3px solid #151610; border-radius:50%; background:#f4f1e7; box-shadow:inset 0 0 0 26px #ddd6ff; }
    .promo-small img { width:118px; height:38px; object-fit:contain; object-position:left center; }
    .promo-small h1 { position:relative; z-index:2; width:310px; margin:34px 0 0; font:400 41px/.92 Georgia,serif; letter-spacing:-.045em; }
    .promo-small .verbs { position:absolute; z-index:2; left:22px; bottom:20px; display:flex; gap:7px; font:800 9px/1 "Courier New",monospace; letter-spacing:.08em; text-transform:uppercase; }
    .promo-small .verbs span { padding:7px 8px; border:2px solid #151610; background:#f4f1e7; }
    .promo-small .cards { position:absolute; z-index:3; right:24px; bottom:26px; display:flex; gap:7px; transform:rotate(-4deg); }
    .promo-small .card { width:48px; height:76px; padding:7px 5px; border:2px solid #151610; background:#f4f1e7; box-shadow:4px 4px 0 #151610; }
    .promo-small .card b { display:block; font:800 6px "Courier New",monospace; }
    .promo-small .card i { display:block; width:22px; height:5px; margin-top:9px; background:#151610; box-shadow:0 10px 0 #d8d5cb; }
  </style></head><body><main class="promo-small"><img src="${wordmark}" alt="Scout"><h1>Apply. Track.<br>Follow through.</h1><div class="verbs"><span>Autofill</span><span>Job tracker</span></div><div class="cards"><div class="card"><b>SAVED</b><i></i></div><div class="card"><b>APPLIED</b><i></i></div><div class="card"><b>INTERVIEW</b><i></i></div></div></main></body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: resolve(output, "scout-small-promo-440x280.png") });

  await page.setViewportSize({ width: 1400, height: 560 });
  await page.setContent(`<!doctype html><html><head><style>${sharedCSS}
    .promo-wide { position:relative; width:1400px; height:560px; overflow:hidden; color:#151610; background:#f4f1e7; }
    .promo-wide::before { content:""; position:absolute; inset:0; opacity:.42; background-image:linear-gradient(rgba(21,22,16,.13) 1px,transparent 1px),linear-gradient(90deg,rgba(21,22,16,.13) 1px,transparent 1px); background-size:32px 32px; }
    .promo-wide .copy { position:absolute; z-index:2; left:60px; top:54px; width:600px; padding:0; }
    .promo-wide img { width:185px; height:58px; object-fit:contain; object-position:left center; }
    .promo-wide h1 { max-width:650px; margin:72px 0 0; font:400 74px/.9 Georgia,serif; letter-spacing:-.05em; }
    .promo-wide h1 em { color:#586042; }
    .promo-wide p { width:520px; margin:25px 0 0; font-size:19px; line-height:1.4; }
    .promo-wide .stage { position:absolute; z-index:1; right:-30px; top:0; width:720px; height:560px; background:#b7ff3c; border-left:3px solid #151610; clip-path:polygon(18% 0,100% 0,100% 100%,0 100%,0 26%); }
    .promo-wide .cards { position:absolute; z-index:3; right:60px; top:118px; display:flex; gap:18px; align-items:flex-start; }
    .promo-wide .card { width:178px; height:270px; padding:20px; border:3px solid #151610; border-radius:14px; background:#f4f1e7; box-shadow:10px 10px 0 #151610; }
    .promo-wide .card:nth-child(2) { margin-top:52px; }
    .promo-wide .card:nth-child(3) { margin-top:104px; }
    .promo-wide .card small { font:800 11px "Courier New",monospace; letter-spacing:.1em; }
    .promo-wide .card h2 { margin:42px 0 0; font:400 27px/1 Georgia,serif; }
    .promo-wide .card i { display:block; width:74%; height:8px; margin-top:18px; background:#151610; box-shadow:0 20px 0 #d7d3c8,0 40px 0 #d7d3c8; }
    .promo-wide .card b { display:block; margin-top:76px; font:800 10px "Courier New",monospace; }
  </style></head><body><main class="promo-wide"><section class="copy"><img src="${wordmark}" alt="Scout"><h1>Your job search. <em>Finally in one place.</em></h1><p>Review-first autofill, application tracking, and the next actions that keep every opportunity moving.</p></section><div class="stage"></div><div class="cards"><article class="card"><small>SAVED</small><h2>Product Designer</h2><i></i><b>80% MATCH</b></article><article class="card"><small>APPLIED</small><h2>Senior PM</h2><i></i><b>FOLLOW UP</b></article><article class="card"><small>INTERVIEW</small><h2>UX Researcher</h2><i></i><b>PREP TODAY</b></article></div></main></body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: resolve(output, "scout-marquee-promo-1400x560.png") });
} finally {
  await browser.close();
}

console.log(`Rendered ${slides.length + 2} Chrome Web Store assets in ${output}`);
