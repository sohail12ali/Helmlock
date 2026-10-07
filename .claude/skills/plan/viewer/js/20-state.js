/* data, picks (saved in this browser), ordering */
const P = PLAN;
const KEY = 'plan-picks:' + (P.meta.title || '');
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
(P.saved_picks ? Object.keys(P.saved_picks) : []).forEach(id => {
  const v = P.saved_picks[id];
  if (!store[id] && v && ((v.options && v.options.length) || v.note)) store[id] = { sel: v.options || [], note: v.note || '' };
});
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
const pick = d => d.decided
  ? { sel: d.decided.options || [], note: d.decided.note || '', locked: true, date: d.decided.date || '' }
  : (store[d.id] || (store[d.id] = { sel: [], note: '' }));

const phases = P.meta.phases || [];
const phaseIdx = d => Math.max(0, phases.findIndex(p => p.id === d.phase));
const decisions = P.choices.map((d, i) => Object.assign({ _i: i }, d))
  .sort((a, b) => phaseIdx(a) - phaseIdx(b) || a._i - b._i);
const byId = {};
decisions.forEach(d => { byId[d.id] = d; });
const unlocks = {};
decisions.forEach(d => (d.needs || []).forEach(n => { (unlocks[n] = unlocks[n] || []).push(d.id); }));

const isDone = d => pick(d).sel.length > 0;
const isReady = d => (d.needs || []).every(n => byId[n] && isDone(byId[n]));
const status = d => (isDone(d) ? 'done' : isReady(d) ? 'ready' : 'wait');
const recOpts = d => d.options.filter(o => o.rec);
const mustOpts = d => d.options.filter(o => o.must);
const mustCards = () => decisions.filter(d => mustOpts(d).length);
const chosenOpts = d => pick(d).sel.map(id => d.options.find(o => o.id === id)).filter(Boolean);
const IMPACT = { 3: ['Foundation', 'accent'], 2: ['Important', ''], 1: ['Detail', ''] };
const LOCK = { low: 'Easy to change later', med: 'Some rework to change', high: 'Hard to undo' };
const doneCount = list => list.filter(isDone).length;

function nextUp(n) {
  return decisions.filter(d => !isDone(d) && isReady(d))
    .sort((a, b) => (b.impact || 1) - (a.impact || 1) || (unlocks[b.id] || []).length - (unlocks[a.id] || []).length || a._i - b._i)
    .slice(0, n);
}

function effortTally(useRec) {
  const t = { S: 0, M: 0, L: 0 };
  decisions.forEach(d => {
    const opts = isDone(d) ? chosenOpts(d) : (useRec ? recOpts(d) : []);
    opts.forEach(o => { if (t[o.cost] != null) t[o.cost]++; });
  });
  return t;
}

function exportJson() {
  const picks = {};
  decisions.forEach(d => {
    if (d.decided) return;
    const s = pick(d);
    if (s.sel.length || s.note) picks[d.id] = { options: s.sel, note: s.note || '' };
  });
  return JSON.stringify({ plan: P.meta.title, iteration: P.meta.iteration, saved: new Date().toISOString(), picks }, null, 1) + String.fromCharCode(10);
}

/* the chosen file is remembered (IndexedDB) so later saves overwrite it without asking */
const idb = (mode, fn) => new Promise((res, rej) => {
  const rq = indexedDB.open('plan-files', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('h');
  rq.onerror = () => rej(rq.error);
  rq.onsuccess = () => { const st = rq.result.transaction('h', mode).objectStore('h'); const r = fn(st); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
});

const served = /^https?:$/.test(location.protocol);

async function saveJson() {
  const text = exportJson(), name = 'plan-picks.json';
  if (served) {
    try {
      const r = await fetch('/api/picks', { method: 'POST', headers: { 'X-Plan': '1', 'Content-Type': 'application/json' }, body: text });
      const j = await r.json();
      if (r.ok) return 'Saved ' + j.count + ' decisions to docs/plan/' + name + ' (' + new Date().toLocaleTimeString() + ')';
      return 'Save failed: ' + (j.error || r.status);
    } catch (e) { return 'Save failed: is the plan server still running?'; }
  }
  try {
    if (window.showSaveFilePicker) {
      let fh = null;
      try { fh = await idb('readonly', st => st.get('picks')); } catch (e) {}
      if (fh) {
        let ok = (await fh.queryPermission({ mode: 'readwrite' })) === 'granted';
        if (!ok) ok = (await fh.requestPermission({ mode: 'readwrite' })) === 'granted';
        if (!ok) fh = null;
      }
      if (!fh) {
        fh = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Plan picks', accept: { 'application/json': ['.json'] } }] });
        try { await idb('readwrite', st => st.put(fh, 'picks')); } catch (e) {}
      }
      const w = await fh.createWritable(); await w.write(text); await w.close();
      return 'Saved to ' + fh.name + ' (' + new Date().toLocaleTimeString() + ')';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'Save cancelled'; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return 'Downloaded ' + name + ' (check your Downloads folder)';
}

function loadJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return 'Not a valid JSON file'; }
  const picks = obj && obj.picks ? obj.picks : obj;
  let n = 0, bad = [];
  Object.keys(picks || {}).forEach(id => {
    const d = byId[id], v = picks[id];
    if (!d || !v || d.decided) { if (!d) bad.push(id); return; }
    const sel = (v.options || v.sel || []).filter(x => d.options.some(o => o.id === x));
    pick(d).sel = d.multi ? sel : sel.slice(0, 1);
    pick(d).note = v.note || '';
    n++;
  });
  persist();
  return 'Loaded ' + n + ' picks' + (bad.length ? '; unknown ids ignored: ' + bad.join(', ') : '');
}

function exportText() {
  return phases.map(ph => '## ' + ph.title + '\n' + decisions.filter(d => d.phase === ph.id).map(d => {
    const s = pick(d);
    const ch = chosenOpts(d);
    return '- ' + d.id + ' "' + d.title + '" => [' + ch.map(o => o.id).join(', ') + ']' +
      (ch.length ? ' :: ' + ch.map(o => o.label).join('; ') : '') + (s.note ? ' :: note: ' + s.note.replace(/[\r\n]+/g, ' ') : '');
  }).join('\n')).join('\n\n');
}
