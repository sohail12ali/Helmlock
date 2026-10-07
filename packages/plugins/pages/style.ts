// Inline stylesheet for generated pages (one self-contained file, no external requests).
// Light and dark follow the system; the toggle stamps data-theme on <html>. Print drops colour and chrome.
export const PAGE_CSS = `
:root{--bg:#fbfaf8;--fg:#1d1d1f;--muted:#5f6368;--line:#e3e1dc;--card:#fff;--accent:#2f5d8a;--ok:#2e7d4f;--warn:#a86b00;--bad:#b3261e;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#16181b;--fg:#e8e6e3;--muted:#a3a7ad;--line:#2c3036;--card:#1e2125;--accent:#8db8e3;--ok:#6cc58f;--warn:#e3b45c;--bad:#f08a80;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#16181b;--fg:#e8e6e3;--muted:#a3a7ad;--line:#2c3036;--card:#1e2125;--accent:#8db8e3;--ok:#6cc58f;--warn:#e3b45c;--bad:#f08a80;color-scheme:dark}
*{box-sizing:border-box}
html{scroll-padding-top:56px}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
main{max-width:1000px;margin:0 auto;padding:20px 16px 64px}
a{color:var(--accent)}
h1{font-size:1.5rem;margin:0;line-height:1.3}
h1 .id{color:var(--muted);font-weight:500;margin-right:.4em}
h2{font-size:1.1rem;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h2 .n{color:var(--muted);font-weight:400;font-size:.9rem}
header .goal{color:var(--muted);margin:4px 0 0}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.85rem;color:var(--muted);margin-bottom:10px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.chip{border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:.82rem;background:var(--card);white-space:nowrap}
.chip.accent{color:var(--accent);border-color:var(--accent)}
.chip.ok{color:var(--ok);border-color:var(--ok)}
.chip.warn{color:var(--warn);border-color:var(--warn)}
.chip.bad{color:var(--bad);border-color:var(--bad)}
.muted,.na{color:var(--muted)}
.na{font-style:italic}
nav.toc{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:2px 14px;margin:16px -16px 0;padding:8px 16px;background:var(--bg);border-bottom:1px solid var(--line);font-size:.85rem}
nav.toc a{text-decoration:none;white-space:nowrap}
section{margin-top:26px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:var(--card);font-size:.9rem}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:color-mix(in srgb,var(--accent) 8%,var(--card));font-weight:600}
tr.hot td:first-child{border-left:3px solid var(--bad)}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{padding:6px 0;border-bottom:1px solid var(--line)}
ul.plain li:last-child{border-bottom:0}
.q-blocking{color:var(--bad);font-weight:600;margin-right:.4em}
.progress{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin:6px 0 12px;max-width:420px}
.progress>span{display:block;height:100%;background:var(--ok)}
.md{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 16px}
.md h1{font-size:1.25rem;margin:14px 0 8px}
.md h2{font-size:1.08rem;border:0;margin:16px 0 6px;padding:0}
.md h3{font-size:1rem;margin:14px 0 6px}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto}
.md pre{background:var(--bg)}
code{font-family:ui-monospace,Consolas,monospace;font-size:.88em}
.thread .who{font-weight:600}
.thread .when{color:var(--muted);font-size:.82rem;margin-left:.5em}
.thread p{margin:2px 0 0;white-space:pre-wrap}
details summary{cursor:pointer;color:var(--muted);margin-top:8px}
.stage{margin-top:22px}
footer{margin-top:40px;color:var(--muted);font-size:.82rem}
button.theme{font:inherit;font-size:.8rem;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer}
@media (max-width:480px){body{font-size:14px}h1{font-size:1.25rem}th,td{padding:5px 6px}}
@media print{
 :root,:root[data-theme="dark"]{--bg:#fff;--fg:#000;--muted:#444;--line:#bbb;--card:#fff;--accent:#000;color-scheme:light}
 nav.toc,button.theme{display:none}
 main{max-width:none;padding:0}
 section,tr,pre{break-inside:avoid}
 a{text-decoration:none}
}
`;

/** Tiny optional theme toggle; the page reads fine without it. */
export const THEME_SCRIPT = `(function(){var r=document.documentElement,k="hl-theme";try{var s=localStorage.getItem(k);if(s)r.dataset.theme=s}catch(e){}
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button.theme");if(!b)return;
var d=r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var n=d==="dark"?"light":"dark";r.dataset.theme=n;try{localStorage.setItem(k,n)}catch(e){}});})();`;
