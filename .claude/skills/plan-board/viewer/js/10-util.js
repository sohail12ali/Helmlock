/* helpers: escape, element builder, tiny markdown */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else e.append(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return e;
}

function inline(s) {
  return String(s).split('`').map((p, i) => i % 2
    ? '<code>' + esc(p) + '</code>'
    : esc(p)
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')).join('');
}

function md(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const isList = l => /^\s*([-*]|\d+\.)\s+/.test(l);
  const isTable = (l, n) => /^\s*\|/.test(l) && n != null && /^\s*\|?\s*:?-{2,}/.test(n);
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const b = [];
      i++;
      while (i < L.length && !L[i].startsWith('```')) b.push(L[i++]);
      i++;
      out.push('<pre>' + esc(b.join('\n')) + '</pre>');
      continue;
    }
    let m = l.match(/^(#{1,4})\s+(.*)/);
    if (m) { const n = Math.min(m[1].length + 1, 5); out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); i++; continue; }
    if (isTable(l, L[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]));
      out.push('<div class="scroll"><table><thead><tr>' + head.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (isList(l)) {
      const ord = /^\s*\d+\./.test(l);
      const items = [];
      while (i < L.length && (isList(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (isList(L[i])) items.push(L[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else items[items.length - 1] += ' ' + L[i].trim();
        i++;
      }
      out.push((ord ? '<ol>' : '<ul>') + items.map(t => '<li>' + inline(t) + '</li>').join('') + (ord ? '</ol>' : '</ul>'));
      continue;
    }
    if (l.startsWith('>')) {
      const b = [];
      while (i < L.length && L[i].startsWith('>')) b.push(L[i++].replace(/^>\s?/, ''));
      out.push('<blockquote>' + inline(b.join(' ')) + '</blockquote>');
      continue;
    }
    if (/^---+$/.test(l.trim())) { out.push('<hr>'); i++; continue; }
    const p = [];
    while (i < L.length && L[i].trim() && !L[i].startsWith('```') && !/^#{1,4}\s/.test(L[i]) && !isList(L[i]) && !L[i].startsWith('>') && !isTable(L[i], L[i + 1])) p.push(L[i++]);
    out.push('<p>' + inline(p.join(' ')) + '</p>');
  }
  return out.join('\n');
}
