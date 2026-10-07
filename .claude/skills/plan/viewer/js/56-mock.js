/* Wireframe mockups from a tiny indented text format. Themeable through --m-* variables. */
function mkTok(line) {
  const out = [];
  const re = /(\w+)=("[^"]*"|\S+)|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ k: m[1], v: m[2].replace(/^"|"$/g, '') });
    else if (m[3] != null) out.push({ s: m[3] });
    else out.push({ w: m[4] });
  }
  return out;
}

function parseMock(src) {
  const m = { title: '', notes: [], from: [], root: { type: 'root', args: [], attrs: {}, kids: [] } };
  const stack = [{ node: m.root, ind: -1 }];
  String(src || '').replace(/\r/g, '').split('\n').forEach(raw => {
    if (!raw.trim()) return;
    if (raw.startsWith('# ')) { m.title = raw.slice(2).trim(); return; }
    if (raw.startsWith('> ')) { m.notes.push(raw.slice(2).trim()); return; }
    if (raw.startsWith('@from ')) { m.from = raw.slice(6).split(',').map(s => s.trim()); return; }
    const ind = raw.match(/^ */)[0].length;
    const t = mkTok(raw.trim());
    const node = { type: t[0].w || t[0].s, args: [], attrs: {}, kids: [] };
    t.slice(1).forEach(x => { if (x.k) node.attrs[x.k] = x.v; else node.args.push(x.s != null ? x.s : x.w); });
    while (stack.length > 1 && stack[stack.length - 1].ind >= ind) stack.pop();
    stack[stack.length - 1].node.kids.push(node);
    stack.push({ node, ind });
  });
  return m;
}

const mkInline = s => esc(s)
  .replace(/\[([!+~]?)([^\]]+)\]/g, (x, k, t) => '<span class="mk-chip ' + ({ '!': 'warn', '+': 'ok', '~': 'accent' }[k] || '') + '">' + t + '</span>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

function mkEl(cls, n, kids, tag) {
  const e = h(tag || 'div', { class: cls });
  const a = n.attrs || {};
  const st = [];
  if (a.w) st.push('flex:0 0 ' + a.w + 'px');
  if (a.grow) st.push('flex:' + a.grow + ' 1 0');
  if (a.h) st.push('min-height:' + a.h + 'px');
  if (a.gap) st.push('gap:' + a.gap + 'px');
  if (st.length) e.setAttribute('style', st.join(';'));
  if (a.n) e.append(h('span', { class: 'mk-n' }, a.n));
  (kids || []).forEach(k => { if (k != null && k !== false) e.append(k); });
  return e;
}

const mkKids = n => n.kids.map(mkNode);
const mkAct = s => { const on = /\*$/.test(s); return [s.replace(/\*$/, ''), on]; };

const MKB = {
  root: n => mkEl('mk-root-inner', n, mkKids(n)),
  app: n => mkEl('mk-app', n, mkKids(n)),
  phone: n => mkEl('mk-phone', n, mkKids(n)),
  top: n => mkEl('mk-top', n, mkKids(n)),
  body: n => mkEl('mk-body', n, mkKids(n)),
  side: n => mkEl('mk-side', n, mkKids(n)),
  main: n => mkEl('mk-main', n, mkKids(n)),
  right: n => mkEl('mk-right', n, mkKids(n)),
  bottom: n => mkEl('mk-bottom', n, mkKids(n)),
  row: n => mkEl('mk-row', n, mkKids(n)),
  col: n => mkEl('mk-col', n, mkKids(n)),
  card: n => mkEl('mk-card', n, [n.args[0] ? h('div', { class: 'mk-card-h', html: mkInline(n.args[0]) }) : null].concat(mkKids(n))),
  stat: n => mkEl('mk-stat', n, [h('div', { class: 'mk-muted' }, n.args[0]), h('div', { class: 'mk-big' }, n.args[1]), n.attrs.hint ? h('div', { class: 'mk-muted' }, n.attrs.hint) : null]),
  list: n => mkEl('mk-list', n, n.args.map(s => { const k = s[0]; const t = '!+-'.includes(k) ? s.slice(1) : s; return h('div', { class: 'mk-li' }, h('i', { class: 'mk-dot ' + ({ '!': 'warn', '+': 'ok', '-': 'mute' }[k] || '') }), h('span', { html: mkInline(t) })); })),
  table: n => mkEl('mk-table', n, [h('div', { class: 'mk-tr mk-th' }, n.args.map(a => h('div', { class: 'mk-td' }, a)))].concat(n.kids.map(r => h('div', { class: 'mk-tr' }, r.args.map(a => h('div', { class: 'mk-td', html: mkInline(a) })))))),
  tabs: n => mkEl('mk-tabs', n, n.args.map(a => { const [t, on] = mkAct(a); return h('span', { class: 'mk-tab' + (on ? ' on' : '') }, t); })),
  nav: n => mkEl(n.attrs.bottom ? 'mk-navb' : 'mk-nav', n, n.args.map(a => { const [t, on] = mkAct(a); return h('div', { class: 'mk-ni' + (on ? ' on' : ''), html: mkInline(t) }); })),
  chip: n => mkEl('mk-chip ' + (n.attrs.kind || ''), n, [n.args[0]], 'span'),
  btn: n => mkEl('mk-btn ' + (n.attrs.kind || ''), n, [n.args[0]], 'span'),
  btns: n => mkEl('mk-btns', n, n.args.map((a, i) => h('span', { class: 'mk-btn' + (i === 0 ? ' primary' : '') }, a))),
  input: n => mkEl('mk-input', n, [n.args[0] || '']),
  search: n => mkEl('mk-input mk-search', n, [n.args[0] || 'Search']),
  text: n => mkEl('mk-text', n, [], 'p'),
  h: n => mkEl('mk-h', n, [n.args[0]]),
  muted: n => mkEl('mk-muted', n, [n.args[0]]),
  sp: n => mkEl('mk-sp', n, []),
  brand: n => mkEl('mk-brand', n, [n.args[0]]),
  avatar: n => mkEl('mk-avatar', n, [n.args[0]]),
  crumb: n => mkEl('mk-crumb', n, [n.args.join('  ›  ')]),
  bars: n => { const rows = n.args.map(a => { const m = a.match(/^(.*?)\s+(\d+)$/); return [m ? m[1] : a, m ? +m[2] : 0]; }); const mx = Math.max(1, ...rows.map(r => r[1])); return mkEl('mk-bars', n, rows.map(r => h('div', { class: 'mk-bar' }, h('span', null, r[0]), h('i', { style: 'width:' + Math.round(100 * r[1] / mx) + '%' }), h('b', null, r[1])))); },
  spark: n => { const e = mkEl('mk-spark', n, []); e.innerHTML = '<svg viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="1.6" points="0,18 12,14 24,16 36,8 48,12 60,6 72,10 84,4 100,7"/></svg>'; return e; },
  kanban: n => mkEl('mk-kanban', n, mkKids(n)),
  lane: n => mkEl('mk-lane', n, [h('div', { class: 'mk-lane-h' }, n.args[0], h('span', { class: 'mk-muted' }, ' ' + n.kids.length + (n.attrs.wip ? '/' + n.attrs.wip : '')))].concat(mkKids(n))),
  c: n => mkEl('mk-kc', n, [h('div', { html: mkInline(n.args[0] || '') }), n.args[1] ? h('div', { class: 'mk-muted', html: mkInline(n.args[1]) }) : null]),
  stepper: n => mkEl('mk-stepper', n, n.args.map((a, i) => { const [t, on] = mkAct(a); return h('div', { class: 'mk-step' + (on ? ' on' : '') }, h('i', null, i + 1), t); })),
  form: n => mkEl('mk-form', n, mkKids(n)),
  field: n => mkEl('mk-field', n, [h('label', null, n.args[0]), h('div', { class: 'mk-input' }, n.args[1] || '')]),
  toggle: n => mkEl('mk-toggle', n, [h('span', null, n.args[0]), h('i', { class: n.attrs.on ? 'on' : '' })]),
  chat: n => mkEl('mk-chat', n, mkKids(n)),
  msg: n => mkEl('mk-msg ' + (n.args[0] || ''), n, [h('span', { html: mkInline(n.args[1] || '') })].concat(mkKids(n))),
  ask: n => mkEl('mk-ask', n, [h('div', { html: mkInline(n.args[0]) }), h('div', { class: 'mk-btns' }, n.args.slice(1).map((a, i) => h('span', { class: 'mk-btn' + (i === 0 ? ' primary' : '') }, a)))]),
  tree: n => mkEl('mk-tree', n, mkKids(n)),
  node: n => mkEl('mk-node', n, [h('div', { class: 'mk-nl' + (n.attrs.on ? ' on' : '') }, (n.kids.length ? '▾ ' : '· ') + n.args[0])].concat(n.kids.length ? [h('div', { class: 'mk-nk' }, mkKids(n))] : [])),
  diff: n => mkEl('mk-diff', n, [h('b', null, n.args[0]), h('span', { class: 'mk-muted' }, ' ' + (n.args[1] || ''))]),
  graph: n => mkEl('mk-graph', n, n.args.map((a, i) => [h('span', { class: 'mk-gn' }, a), i < n.args.length - 1 ? h('span', { class: 'mk-ga' }, '→') : null]).flat()),
  split: n => mkEl('mk-split', n, []),
  note: n => mkEl('mk-note', n, [n.args[0]]),
};

function mkNode(n) {
  const f = MKB[n.type];
  return f ? f(n) : h('div', { class: 'mk-unknown' }, 'unknown: ' + n.type);
}

function renderMock(m) {
  return mkNode(m.root);
}

/* ---- themes: tokens to CSS variables on the mockup container */
const THEME_KEYS = [
  ['bg', 'Background'], ['sunk', 'Sunken'], ['surface', 'Surface'], ['line', 'Lines'],
  ['ink', 'Text'], ['ink2', 'Text 2'], ['ink3', 'Text 3'],
  ['accent', 'Accent'], ['accentInk', 'On accent'], ['accentSoft', 'Accent soft'],
  ['ok', 'OK'], ['warn', 'Warn'], ['danger', 'Danger'],
];
const FONTS = [
  ['System UI', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
  ['Segoe UI', '"Segoe UI Variable Text", "Segoe UI", sans-serif'],
  ['Georgia (serif)', 'Georgia, "Times New Roman", serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Trebuchet', '"Trebuchet MS", sans-serif'],
  ['Consolas (mono)', '"Cascadia Mono", Consolas, ui-monospace, monospace'],
];
const MONOS = [
  ['Cascadia / Consolas', '"Cascadia Mono", Consolas, ui-monospace, monospace'],
  ['Courier', '"Courier New", monospace'],
  ['System mono', 'ui-monospace, Menlo, monospace'],
];
const DENSITY = { compact: [8, 12.5], comfortable: [12, 14], spacious: [18, 15.5] };

function applyTheme(el, t) {
  const k = t.tokens;
  const d = DENSITY[t.density || 'comfortable'] || DENSITY.comfortable;
  const v = {
    '--m-bg': k.bg, '--m-sunk': k.sunk, '--m-surface': k.surface, '--m-line': k.line,
    '--m-ink': k.ink, '--m-ink2': k.ink2, '--m-ink3': k.ink3,
    '--m-accent': k.accent, '--m-accent-ink': k.accentInk, '--m-accent-soft': k.accentSoft,
    '--m-ok': k.ok, '--m-warn': k.warn, '--m-danger': k.danger,
    '--m-r': (k.radius != null ? k.radius : 10) + 'px', '--m-sans': k.sans, '--m-mono': k.mono,
    '--m-gap': d[0] + 'px', '--m-fs': (t.fontSize || d[1]) + 'px',
  };
  for (const n in v) el.style.setProperty(n, v[n]);
}

function themeToml(t) {
  const k = t.tokens;
  const q = s => '"' + String(s).replace(/"/g, '\\"') + '"';
  return ['id = ' + q(t.id || 'my-theme'), 'label = ' + q(t.label || 'My theme'), 'kind = "pack"', 'fills = ["theme"]', '',
    '[tokens]', 'bg = ' + q(k.bg), 'bg-sunk = ' + q(k.sunk), 'surface = ' + q(k.surface), 'line = ' + q(k.line),
    'ink = ' + q(k.ink), 'ink-2 = ' + q(k.ink2), 'ink-3 = ' + q(k.ink3),
    'accent = ' + q(k.accent), 'accent-ink = ' + q(k.accentInk), 'accent-soft = ' + q(k.accentSoft),
    'ok = ' + q(k.ok), 'warn = ' + q(k.warn), 'danger = ' + q(k.danger), '',
    '[shape]', 'radius = ' + (k.radius != null ? k.radius : 10), 'density = ' + q(t.density || 'comfortable'), 'font-size = ' + (t.fontSize || (DENSITY[t.density || 'comfortable'] || DENSITY.comfortable)[1]), '',
    '[fonts]', 'sans = ' + q(k.sans), 'mono = ' + q(k.mono)].join('\n');
}
