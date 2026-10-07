/* views: overview, decision path, one decision */
const go = id => navTo('#d/' + id);
const link = d => h('a', { class: 'chip link' + (isDone(d) ? ' ok' : ''), href: '#d/' + d.id, title: d.title }, (isDone(d) ? '✓ ' : '') + d.id + ' ' + d.title);
const impactChip = d => { const [t, c] = IMPACT[d.impact || 1]; return h('span', { class: 'chip ' + c }, t); };
const typeChip = d => h('span', { class: 'chip' }, d.multi ? 'Pick any' : 'Choose one');
const effortLetters = opts => opts.map(o => o.cost).filter(Boolean).join(' + ') || '-';

function qItem(q) {
  return h('li', null,
    h('div', { html: inline(q.text) }),
    q.rec ? h('div', { class: 'qrec' }, h('b', null, 'My recommendation: '), h('span', { html: inline(q.rec) })) : h('div', { class: 'qrec none' }, 'No recommendation yet'),
    q.why ? h('div', { class: 'muted', style: 'font-size:.82rem;margin-top:3px' }, q.why) : null,
    (q.cards || []).length ? h('div', { class: 'row', style: 'margin-top:5px' }, h('span', { class: 'muted' }, 'Related'), q.cards.map(id => (byId[id] ? link(byId[id]) : null))) : null);
}

function viewOverview() {
  const total = decisions.length, done = doneCount(decisions);
  const nx = nextUp(6);
  const tally = effortTally(false), withRec = effortTally(true);
  const fmt = t => 'S×' + t.S + '  M×' + t.M + '  L×' + t.L;
  return h('div', null,
    h('div', { class: 'crumb' }, 'Overview'),
    h('h1', { class: 'page' }, P.meta.title),
    h('div', { class: 'prose', html: md(P.idea) }),
    h('div', { class: 'sp' }),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' },
        h('h3', null, 'Decide next'),
        h('p', { class: 'muted' }, 'Ready now (everything they depend on is decided), highest impact first.'),
        nx.length ? h('ol', { class: 'next' }, nx.map(d => h('li', null,
          h('div', { class: 't' }, h('a', { href: '#d/' + d.id }, h('b', null, d.title)),
            h('span', { class: 'muted' }, d.why || d.ask)),
          h('div', { class: 'row' }, impactChip(d), (unlocks[d.id] || []).length ? h('span', { class: 'chip' }, 'unlocks ' + unlocks[d.id].length) : null)))) : h('p', { class: 'empty' }, done === total ? 'Everything is decided.' : 'Nothing is ready: decide the blocking items in the path first.')),
      h('div', { class: 'card' },
        h('h3', null, 'Progress by phase'),
        h('p', { class: 'muted' }, done + ' of ' + total + ' decided.'),
        phases.map(ph => {
          const ds = decisions.filter(d => d.phase === ph.id), n = doneCount(ds);
          return h('div', { class: 'phase-row', onclick: () => navTo('#path') },
            h('div', null, h('b', null, ph.title), h('div', { class: 'muted', style: 'font-size:.8rem' }, ph.blurb || '')),
            h('div', { class: 'bar' }, h('i', { style: 'width:' + (ds.length ? Math.round(100 * n / ds.length) : 0) + '%' })),
            h('div', { class: 'muted' }, n + '/' + ds.length));
        }),
        h('div', { class: 'sp' }),
        h('p', { class: 'muted' }, 'Build size of your picks so far: ' + fmt(tally) + '.'),
        h('p', { class: 'muted' }, 'If you also take every recommendation: ' + fmt(withRec) + '. (S small, M medium, L large; a rough size, not a schedule.)'))),
    h('div', { class: 'sp' }),
    mustCards().length ? h('div', { class: 'card' },
      h('h3', null, 'Must use (' + mustCards().length + ')'),
      h('p', { class: 'muted' }, 'Options that a decided rule or the chosen stack requires. They are not just recommended; skipping one breaks something already settled.'),
      h('ul', { class: 'mustlist' }, mustCards().map(d => h('li', null, h('a', { href: '#d/' + d.id }, h('b', null, d.title)), h('span', { class: 'muted' }, '  ' + mustOpts(d).map(o => o.short || o.label).join('; ') + (typeof mustOpts(d)[0].must === 'string' ? ': ' + mustOpts(d)[0].must : '')))))) : null,
    h('div', { class: 'sp' }),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', null, 'Why this exists'), h('div', { class: 'prose', html: md(P.why) })),
      h('div', { class: 'card' }, h('h3', null, 'Open questions for you'),
        h('ul', { class: 'plain' }, P.questions.filter(q => q.status !== 'closed').map(qItem)))));
}

function viewPath() {
  const f = viewPath.f || (viewPath.f = { pending: false, found: false });
  const rows = [];
  phases.forEach((ph, pi) => {
    let ds = decisions.filter(d => d.phase === ph.id);
    if (f.pending) ds = ds.filter(d => !isDone(d));
    if (f.found) ds = ds.filter(d => (d.impact || 1) === 3);
    if (!ds.length) return;
    rows.push(h('tr', { class: 'phase' }, h('td', { colspan: 7 }, (pi + 1) + '. ' + ph.title, h('span', { class: 'muted', style: 'font-weight:400' }, '  ' + (ph.blurb || '')))));
    ds.forEach(d => {
      const ch = chosenOpts(d), rec = recOpts(d);
      rows.push(h('tr', { class: 'dec', onclick: () => go(d.id) },
        h('td', null, h('span', { class: 'dot ' + status(d), style: 'display:inline-block;margin-right:8px' }), h('b', null, d.title), mustOpts(d).length ? h('span', { class: 'chip must', style: 'margin-left:8px' }, 'Must use') : null, h('div', { class: 'muted', style: 'font-size:.8rem' }, d.id)),
        h('td', null, d.multi ? 'Any' : 'One'),
        h('td', null, impactChip(d)),
        h('td', null, (d.needs || []).map(n => h('span', { class: 'chip' + (isDone(byId[n]) ? ' ok' : '') }, n))),
        h('td', null, d.multi ? (rec.length + ' of ' + d.options.length + ' items recommended') : (rec.map(o => o.label).join('; ') || '-')),
        h('td', { class: 'pick' }, ch.length ? (d.decided ? '✓ ' : '') + (d.multi ? ch.length + ' of ' + d.options.length + ' picked' : ch.map(o => o.label).join('; ')) : h('span', { class: 'muted' }, 'not decided')),
        h('td', null, d.multi ? '-' : effortLetters(ch.length ? ch : rec))));
    });
  });
  const flt = (key, label) => h('button', { class: 'btn' + (f[key] ? ' on' : ''), onclick: () => { f[key] = !f[key]; rerender(); } }, label);
  return h('div', null,
    h('div', { class: 'crumb' }, 'Decision path'),
    h('h1', { class: 'page' }, 'Decisions in the order to make them'),
    h('p', { class: 'lead' }, 'Phases run top to bottom. Inside a phase, items are in dependency order. Foundation items shape everything after them, so settle those first. Click a row to see the options and their trade-offs.'),
    h('div', { class: 'filters' }, flt('pending', 'Only undecided'), flt('found', 'Only foundation')),
    h('div', { class: 'card scroll', style: 'padding:0' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Decision', 'Type', 'Impact', 'Needs', 'Recommended', 'Your pick', 'Effort'].map(t => h('th', null, t)))),
      h('tbody', null, rows))));
}

function optionCard(d, o) {
  const on = pick(d).sel.includes(o.id);
  const rich = (o.pros && o.pros.length) || (o.cons && o.cons.length);
  const toggle = () => {
    const s = pick(d);
    if (s.locked) return;
    if (d.multi) s.sel = on ? s.sel.filter(x => x !== o.id) : s.sel.concat(o.id);
    else s.sel = on ? [] : [o.id];
    persist(); rerender();
  };
  return h('button', { type: 'button', class: 'opt ' + (d.multi ? 'multi' : 'single') + (on ? ' on' : ''), 'aria-pressed': on, onclick: toggle },
    h('div', { class: 'ot' }, h('b', null, o.label), h('span', { class: 'tick' }, on ? '✓' : '')),
    h('div', { class: 'row' },
      o.must ? h('span', { class: 'chip must', title: typeof o.must === 'string' ? o.must : 'Required by a decided rule' }, 'Must use') : null,
      o.rec ? h('span', { class: 'chip ok' }, 'Recommended') : null,
      o.cost ? h('span', { class: 'chip' }, 'Effort ' + o.cost) : null,
      o.lock ? h('span', { class: 'chip' + (o.lock === 'high' ? ' warn' : '') }, LOCK[o.lock]) : null),
    o.desc ? h('div', { class: 'desc' }, o.desc) : null,
    o.facts ? h('div', { class: 'facts' }, Object.keys(o.facts).map(k => h('div', { class: 'fact' }, h('span', { class: 'fk' }, k), h('span', null, o.facts[k])))) : null,
    rich && o.pros && o.pros.length ? h('div', null, h('h5', null, 'You get'), h('ul', null, o.pros.map(t => h('li', { class: 'pro' }, t)))) : null,
    rich && o.cons && o.cons.length ? h('div', null, h('h5', null, 'You give up'), h('ul', null, o.cons.map(t => h('li', { class: 'con' }, t)))) : null,
    o.pick_if ? h('div', { class: 'pick-if' }, h('b', null, 'Choose this if '), o.pick_if) : null);
}

const factKeys = d => { const ks = []; d.options.forEach(o => Object.keys(o.facts || {}).forEach(k => { if (!ks.includes(k)) ks.push(k); })); return ks; };

/* weigh it yourself: importance sliders re-rank the options by their 1 to 5 scores */
function weighPanel(d) {
  const crit = d.criteria || [];
  const scored = d.options.filter(o => o.scores);
  if (!crit.length || !scored.length) return null;
  const W = store['w:' + d.id] || (store['w:' + d.id] = {});
  const w = c => (W[c.id] == null ? 3 : W[c.id]);
  const res = h('div', { class: 'wres' });
  const calc = () => {
    res.textContent = '';
    const tot = crit.reduce((a, c) => a + w(c), 0) || 1;
    const rank = scored.map(o => ({ o, v: crit.reduce((a, c) => a + w(c) * ((o.scores && o.scores[c.id]) || 0), 0) / (tot * 5) })).sort((a, b) => b.v - a.v);
    rank.forEach((x, i) => res.append(h('div', { class: 'wr' + (i === 0 ? ' top' : '') }, h('span', null, (i === 0 ? '★ ' : '') + (x.o.short || x.o.label)), h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(x.v * 100) + '%' })), h('b', null, Math.round(x.v * 100) + '%'))));
  };
  const rows = crit.map(c => {
    const val = h('span', { class: 'wv' }, String(w(c)));
    return h('label', { class: 'wc', title: c.hint || '' },
      h('span', null, c.label, c.hint ? h('small', null, c.hint) : null),
      h('input', { type: 'range', min: 0, max: 5, value: w(c), oninput: e => { W[c.id] = +e.target.value; val.textContent = e.target.value; persist(); calc(); } }), val);
  });
  calc();
  return h('div', { class: 'card', style: 'margin:12px 0' },
    h('h3', null, 'Weigh it yourself'),
    h('p', { class: 'muted' }, 'Set how much each thing matters to you (0 = ignore, 5 = critical). The ratings behind each option are honest 1 to 5 scores from the measurements and facts above; check them in the Compare view and tell me if you disagree. Nothing here changes the plan.'),
    h('div', { class: 'wgrid' }, h('div', { class: 'wrows' }, rows, h('button', { class: 'btn', onclick: () => { store['w:' + d.id] = {}; persist(); rerender(); } }, 'Reset weights')), res));
}

function compareTable(d) {
  const s = pick(d);
  const col = (o, fn) => h('td', { class: s.sel.includes(o.id) ? 'on' : '' }, fn(o));
  const list = a => a && a.length ? h('ul', null, a.map(t => h('li', null, t))) : '-';
  const row = (name, fn) => h('tr', null, h('td', null, name), d.options.map(o => col(o, fn)));
  return h('div', { class: 'card scroll', style: 'padding:0' }, h('table', { class: 'tbl cmp' },
    h('thead', null, h('tr', null, h('th', null, ''), d.options.map(o => h('th', null, o.label, o.must ? h('div', null, h('span', { class: 'chip must' }, 'Must use')) : null, o.rec ? h('div', null, h('span', { class: 'chip ok' }, 'Recommended')) : null)))),
    h('tbody', null,
      row('What it is', o => o.desc || '-'),
      row('Effort', o => o.cost || '-'),
      row('Lock-in', o => LOCK[o.lock] || '-'),
      row('You get', o => list(o.pros)),
      row('You give up', o => list(o.cons)),
      row('Choose it if', o => o.pick_if || '-'),
      factKeys(d).map(k => row(k, o => (o.facts && o.facts[k]) || '-')),
      (d.criteria || []).map(c => row('Score: ' + c.label, o => (o.scores && o.scores[c.id] != null) ? o.scores[c.id] + ' / 5' : '-')),
      h('tr', null, h('td', null, ''), d.options.map(o => h('td', { class: s.sel.includes(o.id) ? 'on' : '' },
        h('button', { class: 'btn' + (s.sel.includes(o.id) ? ' primary' : ''), onclick: () => {
          if (s.locked) return;
          if (d.multi) s.sel = s.sel.includes(o.id) ? s.sel.filter(x => x !== o.id) : s.sel.concat(o.id); else s.sel = s.sel.includes(o.id) ? [] : [o.id];
          persist(); rerender();
        } }, s.sel.includes(o.id) ? 'Selected' : 'Select')))))));
}

function viewDecision(id) {
  const d = byId[id];
  if (!d) return h('p', { class: 'empty' }, 'Unknown decision ' + id);
  const s = pick(d);
  const ph = phases.find(p => p.id === d.phase) || { title: '' };
  const idx = decisions.indexOf(d);
  const rich = d.options.some(o => (o.pros && o.pros.length) || (o.cons && o.cons.length));
  const mode = viewDecision.mode || 'cards';
  const rec = recOpts(d);
  const ups = (unlocks[d.id] || []).map(x => byId[x]);
  return h('div', null,
    h('div', { class: 'crumb' }, (phases.indexOf(ph) + 1) + '. ' + ph.title + '  ›  ' + d.id),
    h('div', { class: 'dhead' },
      h('h1', { class: 'page' }, d.title),
      h('div', { class: 'row' }, impactChip(d), typeChip(d), h('span', { class: 'chip ' + (isDone(d) ? 'ok' : '') }, isDone(d) ? (d.decided ? 'Decided (saved)' : 'Picked') : 'Not decided'))),
    h('p', null, d.ask),
    d.why ? h('div', { class: 'why' }, h('b', null, 'Why it matters. '), d.why) : null,
    (d.needs || []).length ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Depends on'), d.needs.map(n => link(byId[n]))) : null,
    ups.length ? h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'muted' }, 'Unlocks'), ups.map(link)) : null,
    d.learn ? h('p', { class: 'muted' }, 'Learned from: ' + d.learn) : null,
    (d.mockups || []).length ? h('div', { class: 'row', style: 'margin:6px 0' }, h('span', { class: 'muted' }, 'See mockup'), d.mockups.map(id => { if (id === 'themes' || id === 'layout') return h('a', { class: 'chip link accent', href: '#' + id }, id === 'themes' ? 'Theme lab' : 'Layout lab'); const m = (P.mockups || []).find(x => x.id === id); return m ? h('a', { class: 'chip link accent', href: '#mock/' + id }, (m.src.match(/^# (.*)$/m) || [])[1] || id) : null; })) : null,
    s.locked ? h('div', { class: 'why', style: 'background:var(--ok-soft)' }, h('b', null, 'Decided' + (s.date ? ' on ' + s.date : '') + '. '), 'Saved in the plan files. To reopen it, tell Claude.') : null,
    mustOpts(d).length ? h('div', { class: 'must-box' }, h('b', null, 'Must use: '), mustOpts(d).map(o => o.label).join('; '), mustOpts(d).map(o => typeof o.must === 'string' ? h('div', null, o.must) : null)) : null,
    rec.length ? h('div', { class: 'rec-box' }, h('b', null, 'Recommended: '), rec.map(o => o.label).join('; '), d.rec_reason ? h('div', null, d.rec_reason) : null) : null,
    h('div', { class: 'row', style: 'justify-content:space-between' },
      rich ? h('div', { class: 'seg' },
        h('button', { class: mode === 'cards' ? 'on' : '', onclick: () => { viewDecision.mode = 'cards'; rerender(); } }, 'Cards'),
        h('button', { class: mode === 'table' ? 'on' : '', onclick: () => { viewDecision.mode = 'table'; rerender(); } }, 'Compare side by side')) : h('span'),
      s.locked ? h('span') : h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { s.sel = rec.map(o => o.id); persist(); rerender(); } }, 'Use recommended'),
        h('button', { class: 'btn', onclick: () => { s.sel = []; persist(); rerender(); } }, 'Clear'))),
    weighPanel(d),
    mode === 'table' && rich ? h('div', { style: 'margin-top:12px' }, compareTable(d)) : h('div', { class: 'opts' }, d.options.map(o => optionCard(d, o))),
    h('textarea', { class: 'note', rows: 2, placeholder: 'Your note, or your own option...', oninput: e => { if (s.locked) return; s.note = e.target.value; persist(); }, readonly: s.locked }, s.note || ''),
    h('div', { class: 'pager' },
      idx > 0 ? h('a', { class: 'btn', href: '#d/' + decisions[idx - 1].id, style: 'text-decoration:none' }, '← ' + decisions[idx - 1].title) : h('span'),
      idx < decisions.length - 1 ? h('a', { class: 'btn primary', href: '#d/' + decisions[idx + 1].id, style: 'text-decoration:none' }, decisions[idx + 1].title + ' →') : h('span')));
}
