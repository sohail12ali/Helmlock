/* Auto-layout flow diagrams: draw(svg, {nodes, edges}, uid) */
function draw(svg, FLOW, uid) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, attrs, parent) => {
    const e = document.createElementNS(NS, n);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const { nodes, edges } = FLOW;
  if (!nodes.length) {
    svg.setAttribute('viewBox', '0 0 600 90');
    svg.setAttribute('width', 600);
    svg.setAttribute('height', 90);
    el('text', { x: 300, y: 45, 'font-style': 'italic' }, svg).textContent = 'No flow drawn yet.';
    return;
  }
  const W = 160, H = 52, GX = 90, GY = 28, PAD = 24;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const out = {};
  edges.forEach(e => (out[e.from] = out[e.from] || []).push(e));

  // Depth via DFS, skipping back edges so cycles don't loop.
  const depth = {}, state = {}, back = new Set();
  const visit = id => {
    state[id] = 1;
    (out[id] || []).forEach(e => {
      if (state[e.to] === 1) back.add(e);
      else if (!state[e.to]) visit(e.to);
    });
    state[id] = 2;
  };
  const hasIn = new Set(edges.map(e => e.to));
  nodes.forEach(n => (depth[n.id] = 0));
  nodes.filter(n => !hasIn.has(n.id)).concat(nodes).forEach(n => { if (!state[n.id]) visit(n.id); });
  // Relax forward edges until depths settle (longest path).
  for (let i = 0; i < nodes.length; i++) {
    edges.forEach(e => { if (!back.has(e) && byId[e.from] && byId[e.to]) depth[e.to] = Math.max(depth[e.to], depth[e.from] + 1); });
  }

  const layers = [];
  nodes.forEach(n => (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n));
  const maxRows = Math.max(...layers.filter(Boolean).map(l => l.length));
  const totalH = maxRows * (H + GY) - GY;
  const pos = {};
  layers.forEach((l, d) => {
    if (!l) return;
    const colH = l.length * (H + GY) - GY;
    l.forEach((n, i) => { pos[n.id] = { x: PAD + d * (W + GX), y: PAD + (totalH - colH) / 2 + i * (H + GY) }; });
  });
  const width = PAD * 2 + layers.length * (W + GX) - GX;
  const height = totalH + PAD * 2 + 30;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arr' + uid, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0 0L10 5L0 10z' }, mk);

  edges.forEach(e => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    let d, lx, ly;
    if (back.has(e)) {
      const y = PAD + totalH + 22;
      d = `M${a.x + W / 2} ${a.y + H} C${a.x + W / 2} ${y + 20} ${b.x + W / 2} ${y + 20} ${b.x + W / 2} ${b.y + H}`;
      lx = (a.x + b.x + W) / 2; ly = y + 12;
    } else {
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
      d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
      lx = mx; ly = (y1 + y2) / 2 - 8;
    }
    el('path', { d, class: 'edge', 'marker-end': 'url(#arr' + uid + ')' }, svg);
    if (e.label) el('text', { x: lx, y: ly, class: 'elabel' }, svg).textContent = e.label;
  });

  nodes.forEach(n => {
    const p = pos[n.id];
    const g = el('g', { class: 'node ' + (n.type || '') }, svg);
    const pill = n.type === 'start' || n.type === 'end';
    el('rect', { x: p.x, y: p.y, width: W, height: H, rx: pill ? H / 2 : 8 }, g);
    const words = String(n.label).split(' '), lines = [''];
    words.forEach(w => { const l = lines[lines.length - 1]; if ((l + ' ' + w).trim().length > 22) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); });
    lines.forEach((t, i) => {
      el('text', { x: p.x + W / 2, y: p.y + H / 2 + (i - (lines.length - 1) / 2) * 16 }, g).textContent = t;
    });
  });
}
