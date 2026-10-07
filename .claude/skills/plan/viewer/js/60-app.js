/* app shell: top bar, side navigation, router */
let exportOpen = false;
let curRoute = location.hash || '#overview';
let resetArmed = 0;

/* page theme: white by default, remembered in this browser (kept apart from picks so Reset does not clear it) */
const THEME_KEY = 'plan-theme';
let pageTheme = 'light';
try { pageTheme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) {}
document.documentElement.setAttribute('data-theme', pageTheme);

let flashMsg = '', flashTimer = 0;
function flash(msg) {
  flashMsg = msg; clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashMsg = ''; rerender(); }, 6000);
  rerender();
}

function topBar() {
  const total = decisions.length, done = doneCount(decisions);
  const themeBtn = h('button', { class: 'btn', title: 'Switch the page between white and dark', onclick: () => {
    pageTheme = pageTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', pageTheme);
    try { localStorage.setItem(THEME_KEY, pageTheme); } catch (e) {}
    rerender();
  } }, pageTheme === 'dark' ? 'White theme' : 'Dark theme');
  const reset = h('button', { class: 'btn', onclick: () => {
    if (!resetArmed) { resetArmed = setTimeout(() => { resetArmed = 0; rerender(); }, 3000); rerender(); return; }
    clearTimeout(resetArmed); resetArmed = 0; store = {}; persist(); rerender();
  } }, resetArmed ? 'Click again to reset' : 'Reset picks');
  return h('header', { class: 'top' },
    h('button', { class: 'btn menu-btn', onclick: () => document.querySelector('nav.side').classList.toggle('open') }, 'Menu'),
    h('div', { class: 'brand' }, P.meta.title, h('small', null, 'iteration ' + P.meta.iteration + ' · ' + P.meta.updated)),
    h('div', { class: 'grow' }),
    flashMsg ? h('span', { class: 'chip ok' }, flashMsg) : null,
    h('div', { class: 'meter' }, h('div', { class: 'bar' }, h('i', { style: 'width:' + (total ? Math.round(100 * done / total) : 0) + '%' })), done + ' / ' + total + ' decided'),
    h('button', { class: 'btn', onclick: () => { decisions.forEach(d => { if (!isDone(d)) pick(d).sel = recOpts(d).map(o => o.id); }); persist(); rerender(); } }, 'Use recommended for the rest'),
    h('button', { class: 'btn', title: 'Save your decisions to docs/plan/plan-picks.json', onclick: async () => { flash(await saveJson()); } }, 'Save decisions'),
    h('button', { class: 'btn primary', onclick: () => { exportOpen = !exportOpen; rerender(); } }, 'Copy my picks'),
    themeBtn,
    reset);
}

function sideNav(route) {
  const item = (hash, label, extra) => h('a', { class: 'item' + (route === hash ? ' on' : ''), href: hash }, label, extra || null);
  const cur = route.startsWith('#d/') ? byId[route.slice(3)] : null;
  return h('nav', { class: 'side' },
    item('#overview', 'Overview'),
    item('#path', 'Decision path'),
    h('div', { class: 'sec' }, 'Decisions by phase'),
    phases.map((ph, pi) => {
      const ds = decisions.filter(d => d.phase === ph.id);
      return h('details', { open: cur ? cur.phase === ph.id : pi === 0 },
        h('summary', null, h('span', null, (pi + 1) + '. ' + ph.title), h('span', { class: 'n' }, doneCount(ds) + '/' + ds.length)),
        ds.map(d => h('a', { class: 'item' + (route === '#d/' + d.id ? ' on' : ''), href: '#d/' + d.id }, h('span', { class: 'dot ' + status(d) }), d.title)));
    }),
    h('div', { class: 'sec' }, 'UI design'),
    h('details', { open: route.startsWith('#mock') }, h('summary', null, h('span', null, 'Mockups'), h('span', { class: 'n' }, (P.mockups || []).length)),
      (P.mockups || []).map(m => h('a', { class: 'item' + (route === '#mock/' + m.id ? ' on' : ''), href: '#mock/' + m.id }, (m.src.match(/^# (.*)$/m) || [])[1] || m.id))),
    item('#themes', 'Theme lab'),
    item('#layout', 'Layout lab'),
    h('div', { class: 'sec' }, 'Reference'),
    item('#canvases', 'Canvases'),
    item('#blueprints', 'Blueprints'),
    item('#research', 'Research'),
    item('#made', 'Decided and open'),
    item('#log', 'Log'));
}

function exportPanel() {
  const ta = h('textarea', { class: 'note', rows: 14, readonly: true }, exportText());
  setTimeout(() => { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (e) {} }, 0);
  return h('div', { class: 'card', style: 'margin-bottom:16px' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, 'Your picks (copied if the browser allows). Paste them into the chat.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { flash(await saveJson()); } }, 'Save decisions'),
        h('label', { class: 'btn', style: 'cursor:pointer' }, 'Load decisions', h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: ev => {
          const f = ev.target.files[0]; if (!f) return;
          const r = new FileReader(); r.onload = () => { flash(loadJson(String(r.result))); }; r.readAsText(f);
        } })),
        h('button', { class: 'btn', onclick: () => { exportOpen = false; rerender(); } }, 'Close'))), ta);
}

function render() {
  const route = curRoute;
  let view;
  if (route.startsWith('#d/')) view = viewDecision(route.slice(3));
  else if (route === '#path') view = viewPath();
  else if (route === '#mock' || route.startsWith('#mock/')) view = viewMockups(route.slice(6));
  else if (route === '#themes') view = viewThemes();
  else if (route === '#layout') view = viewLayout();
  else if (route === '#canvases') view = viewCanvases();
  else if (route === '#blueprints') view = viewBlueprints();
  else if (route === '#research') view = viewResearch();
  else if (route === '#made') view = viewMade();
  else if (route === '#log') view = viewLog();
  else view = viewOverview();
  const app = document.getElementById('app');
  const y = window.scrollY;
  app.textContent = '';
  app.append(topBar(), h('div', { class: 'layout' }, sideNav(route), h('main', null, exportOpen ? exportPanel() : null, view)));
  return y;
}

function rerender() {
  const y = render();
  window.scrollTo(0, y);
}

function navTo(hash) {
  curRoute = hash || '#overview';
  try { history.replaceState(null, '', curRoute); } catch (e) {}
  render();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  navTo(a.getAttribute('href'));
});
window.addEventListener('hashchange', () => { curRoute = location.hash || '#overview'; render(); window.scrollTo(0, 0); });
render();
if (served) {
  /* when served by build.py --serve, the file in docs/plan is the source of truth for picks */
  fetch('/api/picks').then(r => r.json()).then(j => {
    const sp = j && j.picks ? j.picks : {};
    Object.keys(sp).forEach(id => {
      const v = sp[id];
      if (byId[id] && !byId[id].decided && v && v.options) store[id] = { sel: v.options, note: v.note || '' };
    });
    persist(); rerender();
  }).catch(() => {});
}
