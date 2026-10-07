/* views: mockups, theme lab, layout lab */
const uiS = { theme: null, width: 'full', lab: null, labMock: 'overview' };
const CUSTOM_KEY = 'plan-themes:' + (P.meta.title || '');
const customThemes = () => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { return []; } };
const saveCustom = a => { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(a)); } catch (e) {} };
const allThemes = () => (P.themes || []).concat(customThemes());
const curTheme = () => { const ts = allThemes(); return ts.find(t => t.id === uiS.theme) || ts[0] || { id: 'x', label: 'x', tokens: {} }; };
const deep = o => JSON.parse(JSON.stringify(o));
const mockById = id => (P.mockups || []).find(m => m.id === id) || (P.mockups || [])[0];

function themeSelect(onchange) {
  const ts = allThemes();
  const sel = h('select', { class: 'btn', onchange: e => onchange(e.target.value) }, ts.map(t => h('option', { value: t.id, selected: t.id === curTheme().id }, t.label)));
  return sel;
}

function mockStage(m, theme, width) {
  const inner = h('div', { class: 'mkroot' });
  inner.append(renderMock(parseMock(m.src)));
  const frame = h('div', { class: 'mk-frame' }, inner);
  applyTheme(frame, theme);
  const w = { full: '100%', tablet: '720px', phone: '380px' }[width] || '100%';
  return h('div', { class: 'mk-stage', style: 'max-width:' + w }, frame);
}

function viewMockups(id) {
  const list = P.mockups || [];
  if (!list.length) return h('div', null, h('h1', { class: 'page' }, 'Mockups'), h('p', { class: 'empty' }, 'No mockups yet.'));
  const m = mockById(id);
  const parsed = parseMock(m.src);
  const seg = (key, label) => h('button', { class: uiS.width === key ? 'on' : '', onclick: () => { uiS.width = key; rerender(); } }, label);
  return h('div', null,
    h('div', { class: 'crumb' }, 'UI mockups'),
    h('h1', { class: 'page' }, parsed.title || m.id),
    h('p', { class: 'lead' }, 'Wireframes, not final design. They show structure and where each part comes from, and they follow the selected theme. We refine them before implementation.'),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, list.map(x => h('a', { class: 'chip link' + (x.id === m.id ? ' accent' : ''), href: '#mock/' + x.id }, parseMock(x.src).title || x.id))),
    h('div', { class: 'row', style: 'margin:12px 0' },
      h('span', { class: 'muted' }, 'Theme'), themeSelect(v => { uiS.theme = v; rerender(); }),
      h('span', { class: 'muted', style: 'margin-left:12px' }, 'Width'),
      h('div', { class: 'seg' }, seg('full', 'Desktop'), seg('tablet', 'Tablet'), seg('phone', 'Phone')),
      h('a', { class: 'btn', href: '#themes', style: 'text-decoration:none;margin-left:auto' }, 'Edit themes')),
    mockStage(m, curTheme(), uiS.width),
    parsed.from.length ? h('div', { class: 'row', style: 'margin-top:14px' }, h('span', { class: 'muted' }, 'Ideas borrowed from'), parsed.from.map(f => h('span', { class: 'chip accent' }, f))) : null,
    parsed.notes.length ? h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', null, 'Notes'), h('ul', { class: 'plain' }, parsed.notes.map(t => h('li', { html: inline(t) })))) : null);
}

function viewThemes() {
  if (!uiS.lab) uiS.lab = deep(curTheme());
  const t = uiS.lab;
  const preview = h('div', { id: 'lab-preview' });
  const toml = h('textarea', { class: 'note', rows: 16, readonly: true });
  const refresh = () => {
    preview.textContent = '';
    const m = mockById(uiS.labMock);
    if (m) preview.append(mockStage(m, t, 'full'));
    toml.value = themeToml(t);
  };
  const colorRow = ([key, label]) => {
    const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(t.tokens[key]) ? t.tokens[key] : '#888888', oninput: e => { t.tokens[key] = e.target.value; refresh(); } });
    return h('label', { class: 'lab-c' }, inp, h('span', null, label));
  };
  const sel = (opts, cur, on) => h('select', { class: 'btn', onchange: e => on(e.target.value) }, opts.map(o => h('option', { value: o[1], selected: o[1] === cur }, o[0])));
  const range = (min, max, val, on) => h('input', { type: 'range', min, max, value: val, oninput: e => on(+e.target.value) });
  const baseSel = h('select', { class: 'btn', onchange: e => { const b = allThemes().find(x => x.id === e.target.value); if (b) { uiS.lab = deep(b); uiS.theme = b.id; rerender(); } } },
    allThemes().map(x => h('option', { value: x.id, selected: x.id === (uiS.theme || allThemes()[0].id) }, x.label)));
  const nameIn = h('input', { class: 'btn', value: t.label || '', placeholder: 'Theme name', oninput: e => { t.label = e.target.value; t.id = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-theme'; toml.value = themeToml(t); } });
  const mockSel = h('select', { class: 'btn', onchange: e => { uiS.labMock = e.target.value; refresh(); } }, (P.mockups || []).map(m => h('option', { value: m.id, selected: m.id === uiS.labMock }, parseMock(m.src).title || m.id)));
  const ctl = h('div', { class: 'card' },
    h('h3', null, 'Theme editor'),
    h('p', { class: 'muted' }, 'A theme is a small set of tokens: colours, two fonts, corner radius and density. Edit any of them and the preview updates. Copy the result as a theme file.'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Start from'), baseSel),
    h('div', { class: 'sp' }), h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Name'), nameIn),
    h('div', { class: 'sp' }), h('div', { class: 'lab-colors' }, THEME_KEYS.map(colorRow)),
    h('div', { class: 'sp' }),
    h('div', { class: 'lab-f' }, h('span', null, 'Interface font'), sel(FONTS, t.tokens.sans, v => { t.tokens.sans = v; refresh(); })),
    h('div', { class: 'lab-f' }, h('span', null, 'Code font'), sel(MONOS, t.tokens.mono, v => { t.tokens.mono = v; refresh(); })),
    h('div', { class: 'lab-f' }, h('span', null, 'Corner radius'), range(0, 20, t.tokens.radius != null ? t.tokens.radius : 10, v => { t.tokens.radius = v; refresh(); })),
    h('div', { class: 'lab-f' }, h('span', null, 'Font size'), range(12, 18, t.fontSize || (DENSITY[t.density || 'comfortable'] || [0, 14])[1], v => { t.fontSize = v; refresh(); })),
    h('div', { class: 'lab-f' }, h('span', null, 'Density'), sel([['Compact', 'compact'], ['Comfortable', 'comfortable'], ['Spacious', 'spacious']], t.density || 'comfortable', v => { t.density = v; t.fontSize = null; refresh(); })),
    h('div', { class: 'sp' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => { const c = customThemes().filter(x => x.id !== t.id); c.push(Object.assign(deep(t), { label: t.label || 'My theme' })); saveCustom(c); uiS.theme = t.id; rerender(); } }, 'Save in this browser'),
      h('button', { class: 'btn', onclick: () => { toml.select(); try { navigator.clipboard.writeText(toml.value); } catch (e) {} } }, 'Copy theme.toml'),
      h('button', { class: 'btn', onclick: () => { uiS.lab = null; rerender(); } }, 'Reset')),
    h('div', { class: 'sp' }), toml);
  refresh();
  return h('div', null,
    h('div', { class: 'crumb' }, 'UI'),
    h('h1', { class: 'page' }, 'Theme lab'),
    h('p', { class: 'lead' }, 'Themes are data, not code: a theme pack of tokens that the console turns into CSS variables. Fonts, colours, radius and density are all configurable, and you can keep your own.'),
    h('div', { class: 'lab-grid' }, ctl, h('div', null, h('div', { class: 'row', style: 'margin-bottom:10px' }, h('span', { class: 'muted' }, 'Preview screen'), mockSel), preview)));
}

/* ---- layout lab: resizable, collapsible, swappable panes */
const LAB_KEY = 'plan-layout:' + (P.meta.title || '');
const LAB_BODY = {
  Navigation: 'nav "Overview*" "Inbox 3" "Tickets" "Todos" "Work" "Agents" "Knowledge" "Settings"',
  Board: 'kanban\n  lane "Spec" wip=3\n    c "T-014 Artifact format" "[~M] sa"\n    c "T-015 Console name"\n  lane "Plan"\n    c "T-012 Plugin contract" "[!blocked]"\n  lane "Build" wip=3\n    c "T-009 CLI grammar"',
  Details: 'col\n  h "T-014 Artifact format"\n  row\n    chip "Spec" kind=accent\n    chip "M"\n  muted "Owner: sa"\n  list "!Open question Q-3" "+Decision D-001" "Plan not started"',
  Activity: 'list "10:42  hl ticket move T-014 spec" "10:40  agent analyst started" "10:31  decision D-001 added"',
};
function viewLayout() {
  const def = () => ({ sw: 190, rw: 230, bh: 120, hide: {}, slots: { side: 'Navigation', main: 'Board', right: 'Details', bottom: 'Activity' } });
  let S;
  try { S = JSON.parse(localStorage.getItem(LAB_KEY) || 'null') || def(); } catch (e) { S = def(); }
  const save = () => { try { localStorage.setItem(LAB_KEY, JSON.stringify(S)); } catch (e) {} };
  const lab = h('div', { class: 'lab' });
  const frame = h('div', { class: 'mk-frame' }, h('div', { class: 'mkroot' }, lab));
  applyTheme(frame, curTheme());
  const hs = { v1: h('div', { class: 'lab-h v', tabindex: 0, title: 'Drag, or use arrow keys. Double-click to reset.' }), v2: h('div', { class: 'lab-h v', tabindex: 0 }), hb: h('div', { class: 'lab-h hz', tabindex: 0 }) };
  const panes = {};
  ['side', 'main', 'right', 'bottom'].forEach(slot => {
    const hd = h('div', { class: 'lab-ph', draggable: true, title: 'Drag this title onto another pane to swap them' });
    const p = h('div', { class: 'lab-p ' + slot }, hd, h('div', { class: 'lab-pb' }));
    hd.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', slot); });
    p.addEventListener('dragover', e => e.preventDefault());
    p.addEventListener('drop', e => { e.preventDefault(); const a = e.dataTransfer.getData('text/plain'); if (a && a !== slot) { const t = S.slots[a]; S.slots[a] = S.slots[slot]; S.slots[slot] = t; fill(); save(); } });
    panes[slot] = p;
    lab.append(p);
  });
  Object.values(hs).forEach(x => lab.append(x));
  const fill = () => {
    ['side', 'main', 'right', 'bottom'].forEach(slot => {
      const name = S.slots[slot], p = panes[slot];
      p.firstChild.textContent = '';
      p.firstChild.append(h('span', null, '⠿ ' + name), h('button', { class: 'lab-x', title: 'Collapse', onclick: () => { S.hide[slot] = !S.hide[slot]; layout(); save(); } }, '–'));
      const body = p.lastChild; body.textContent = '';
      body.append(mkNode(parseMock(LAB_BODY[name]).root));
    });
    layout();
  };
  const layout = () => {
    const sw = S.hide.side ? 0 : S.sw, rw = S.hide.right ? 0 : S.rw, bh = S.hide.bottom ? 0 : S.bh;
    lab.style.gridTemplateColumns = sw + 'px 1fr ' + rw + 'px';
    lab.style.gridTemplateRows = '1fr ' + bh + 'px';
    ['side', 'right', 'bottom'].forEach(s => { panes[s].classList.toggle('collapsed', !!S.hide[s]); });
    hs.v1.style.left = sw + 'px'; hs.v2.style.right = rw + 'px';
    hs.hb.style.left = sw + 'px'; hs.hb.style.right = rw + 'px'; hs.hb.style.bottom = bh + 'px';
    hs.v1.style.display = S.hide.side ? 'none' : ''; hs.v2.style.display = S.hide.right ? 'none' : ''; hs.hb.style.display = S.hide.bottom ? 'none' : '';
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const drag = (el, fn, reset, key, step) => {
    el.addEventListener('pointerdown', e => {
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      const r = lab.getBoundingClientRect();
      const mv = ev => { fn(ev, r); layout(); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); save(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => { reset(); layout(); save(); });
    el.addEventListener('keydown', e => { const d = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step }[e.key]; if (d) { e.preventDefault(); key(d); layout(); save(); } });
  };
  drag(hs.v1, (ev, r) => { S.sw = clamp(ev.clientX - r.left, 110, 380); }, () => { S.sw = 190; }, d => { S.sw = clamp(S.sw + d, 110, 380); }, 16);
  drag(hs.v2, (ev, r) => { S.rw = clamp(r.right - ev.clientX, 110, 380); }, () => { S.rw = 230; }, d => { S.rw = clamp(S.rw - d, 110, 380); }, 16);
  drag(hs.hb, (ev, r) => { S.bh = clamp(r.bottom - ev.clientY, 60, 260); }, () => { S.bh = 120; }, d => { S.bh = clamp(S.bh - d, 60, 260); }, 16);
  fill();
  const preset = (label, fn) => h('button', { class: 'btn', onclick: () => { fn(); fill(); save(); } }, label);
  return h('div', null,
    h('div', { class: 'crumb' }, 'UI'),
    h('h1', { class: 'page' }, 'Layout lab'),
    h('p', { class: 'lead' }, 'The console shell: a resizable sidebar, main area, optional right panel and bottom drawer. Drag the dividers, collapse panes, drag a pane title onto another to swap them. Below 900 px the side panels become a drawer, as in control-center. Your layout is remembered in this browser.'),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, preset('Focus', () => { S.hide = { side: true, right: true, bottom: true }; }), preset('Review', () => { S.hide = {}; S.rw = 300; S.bh = 140; }), preset('Board', () => { S.hide = { right: true, bottom: true }; }), preset('Reset', () => { Object.assign(S, def()); }),
      h('span', { class: 'muted' }, 'Theme'), themeSelect(v => { uiS.theme = v; rerender(); })),
    h('div', { class: 'mk-stage', style: 'max-width:100%' }, frame),
    h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, 'What this shows'),
      h('ul', { class: 'plain' },
        h('li', { html: inline('**Resize**: dividers by mouse, touch or arrow keys; double-click resets (control-center splitter, deepseek-harness dock).') }),
        h('li', { html: inline('**Collapse**: any side pane hides to give the main area room.') }),
        h('li', { html: inline('**Swap**: drag a pane title onto another pane. A full dock (split any pane, tabs, undo) is the bigger option in F81.') }),
        h('li', { html: inline('**Remember**: sizes and positions are saved per user, not in the shared repo (F83).') }))));
}
