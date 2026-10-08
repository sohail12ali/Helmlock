/* views: canvases, blueprints, research, decided and open, log */
function viewCanvases() {
  const box = h('div', null,
    h('div', { class: 'crumb' }, 'Canvases'),
    h('h1', { class: 'page' }, 'Flows and diagrams'),
    h('p', { class: 'lead' }, 'Drawn from small node and edge data with automatic layout. Curves under the boxes are loops or write-backs.'));
  if (!P.flows.length) box.append(h('p', { class: 'empty' }, 'No flows drawn yet.'));
  P.flows.forEach((fl, i) => {
    box.append(h('h3', null, fl.title || 'Flow'));
    if (fl.note) box.append(h('p', { class: 'muted' }, fl.note));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', fl.title || 'Flow');
    box.append(h('div', { class: 'canvas' }, svg));
    draw(svg, fl, i);
  });
  return box;
}

function fragList(items, crumb, title, lead) {
  const box = h('div', null, h('div', { class: 'crumb' }, crumb), h('h1', { class: 'page' }, title), lead ? h('p', { class: 'lead' }, lead) : null);
  if (!items.length) box.append(h('p', { class: 'empty' }, 'Nothing here yet.'));
  items.forEach((it, i) => box.append(h('details', { class: 'frag', open: i === 0 }, h('summary', null, it.title),
    h('div', { class: 'prose', html: it.kind === 'md' ? md(it.body) : it.body }))));
  return box;
}
const viewBlueprints = () => fragList(P.blueprints, 'Blueprints', 'Blueprints (drafts to refine)', 'Concrete drafts: folder layouts, record shapes, agent and skill tables. Marked assumed where inferred.');
const viewResearch = () => fragList(P.research, 'Research', 'What the reference repos taught us', 'Take and skip lists from reading the four repos, plus formats, scaffolding and ticket pages.');

function viewMade() {
  return h('div', null,
    h('div', { class: 'crumb' }, 'Decided and open'),
    h('h1', { class: 'page' }, 'What is settled, what is not'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card' }, h('h3', null, 'Settled (from your messages)'),
        h('ul', { class: 'plain' },
          decisions.filter(d => d.decided).map(d => h('li', null, h('span', { class: 'chip ok' }, d.id), ' ', h('b', null, d.title), ': ',
            chosenOpts(d).map(o => o.label).join('; '), d.decided.note ? h('div', { class: 'muted' }, d.decided.note) : null,
            h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Decided' + (d.decided.date ? ' ' + d.decided.date : '')))),
          P.made.map(m => h('li', null, h('b', null, m.title), ' ', h('span', { html: inline(m.text || '') }),
            m.source ? h('div', { class: 'muted', style: 'font-size:.8rem' }, m.source) : null)))),
      h('div', { class: 'card' }, h('h3', null, 'Open questions'),
        h('ul', { class: 'plain' }, P.questions.map(qItem)))));
}

function viewLog() {
  return h('div', null,
    h('div', { class: 'crumb' }, 'Log'),
    h('h1', { class: 'page' }, 'Conversation log'),
    h('div', { class: 'card' }, h('ul', { class: 'plain' }, P.log.map(e => h('li', null,
      h('span', { class: 'chip' }, e.date), ' ', h('b', null, 'You: '), e.you, h('div', { class: 'muted' }, '→ ' + e.change))))));
}
