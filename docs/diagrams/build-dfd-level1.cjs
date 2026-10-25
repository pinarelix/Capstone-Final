/**
 * Builds docs/diagrams/dfd-level-1-reviewed.svg
 *
 * Gane–Sarson Level 1 DFD for the Barangay 179 Crime Intelligence and Patrol
 * Decision Support System. Coordinates are generated here so the shared ports,
 * routing lanes and labels stay consistent when the layout is tweaked.
 *
 * Run:  node docs/diagrams/build-dfd-level1.cjs
 */
const fs = require('fs');
const path = require('path');

// ─── palette (matches docs/DFD.md) ────────────────────────────────────────────
const C = {
  processFill: '#E8F1FB', processStroke: '#2B6CB0',
  storeFill: '#EAF5EA', storeStroke: '#2F7D32',
  entityFill: '#FCF4E4', entityStroke: '#B7791F',
  flow: '#4A5568', flowText: '#2D3748',
  grid: '#EDF1F5', ink: '#1A202C', muted: '#5A6577',
  noteFill: '#FAFAF5', noteStroke: '#C9B458',
};

const W = 2700, H = 2160;

// ─── geometry ────────────────────────────────────────────────────────────────
const P = {
  x: 980, w: 380, h: 136,
  y: { '1.0': 190, '2.0': 400, '3.0': 615, '4.0': 830, '5.0': 1045, '6.0': 1260, '7.0': 1475, '8.0': 1690 },
};
const S = {
  x: 100, w: 250,
  y: { T7: 195, T1: 405, T2: 620, T3: 855, T4: 1460, T5: 1590, T6: 1730, T8: 1845 },
  h: { T7: 84, T1: 84, T2: 130, T3: 110, T4: 84, T5: 110, T6: 84, T8: 84 },
};
const E = {
  x: 2260, w: 240, h: 170,
  y: { E1: 520, E2: 800, E3: 1110, E4: 1460 },
};

const out = [];
const push = (s) => out.push(s);

// ─── primitives ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textBlock(lines, x, y, opts = {}) {
  if (!Array.isArray(lines)) lines = [lines];
  const { size = 15, weight = 500, fill = C.ink, anchor = 'middle', lh = size * 1.25 } = opts;
  const start = y - ((lines.length - 1) * lh) / 2;
  return lines.map((ln, i) =>
    `<text x="${x}" y="${(start + i * lh).toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(ln)}</text>`
  ).join('\n');
}

function processBox(id, name) {
  const x = P.x, y = P.y[id], w = P.w, h = P.h, r = 18;
  push(`<g class="process">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${C.processFill}" stroke="${C.processStroke}" stroke-width="1.8"/>
    <line x1="${x}" y1="${y + 36}" x2="${x + w}" y2="${y + 36}" stroke="${C.processStroke}" stroke-width="1.2" opacity=".55"/>
    ${textBlock([id], x + w / 2, y + 25, { size: 15, weight: 700, fill: C.processStroke })}
    ${textBlock(name, x + w / 2, y + 36 + (h - 36) / 2, { size: 18, weight: 700, fill: '#12283F' })}
  </g>`);
}

function storeBox(id, name) {
  const x = S.x, y = S.y[id], w = S.w, h = S.h[id];
  push(`<g class="store">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${C.storeFill}" stroke="${C.storeStroke}" stroke-width="1.6"/>
    <line x1="${x + 62}" y1="${y}" x2="${x + 62}" y2="${y + h}" stroke="${C.storeStroke}" stroke-width="1.2" opacity=".65"/>
    ${textBlock([id], x + 31, y + h / 2, { size: 15, weight: 700, fill: '#17321A' })}
    ${textBlock(name, x + 62 + (w - 62) / 2, y + h / 2, { size: 15, weight: 600, fill: '#17321A' })}
  </g>`);
}

function entityBox(id, name, sub) {
  const x = E.x, y = E.y[id], w = E.w, h = E.h;
  push(`<g class="entity">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${C.entityFill}" stroke="${C.entityStroke}" stroke-width="1.8"/>
    <text x="${x + 12}" y="${y + 22}" font-size="12" font-weight="700" fill="#8A5A12">${id}</text>
    ${textBlock([name], x + w / 2, y + h / 2 - 8, { size: 17, weight: 700, fill: '#3A2A0A' })}
    ${textBlock(sub, x + w / 2, y + h / 2 + 18, { size: 11.5, weight: 500, fill: '#7A5A22' })}
  </g>`);
}

/** Orthogonal rounded polyline with optional arrowhead. */
function flow(points, opts = {}) {
  const { arrow = true, color = C.flow, width = 1.7, label, labelSide = 'above' } = opts;
  const r = 9;
  const d = [];
  d.push(`M ${points[0][0]} ${points[0][1]}`);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - x0, dy = y1 - y0;
    if (i < points.length - 1) {
      const sx = Math.sign(dx), sy = Math.sign(dy);
      const rr = Math.min(r, Math.abs(dx), Math.abs(dy));
      d.push(`L ${x1 - sx * rr} ${y1 - sy * rr}`);
      d.push(`Q ${x1} ${y1} ${x1 + Math.sign(points[i + 1][0] - x1) * Math.min(r, Math.abs(points[i + 1][0] - x1))} ${y1 + Math.sign(points[i + 1][1] - y1) * Math.min(r, Math.abs(points[i + 1][1] - y1))}`);
    } else {
      d.push(`L ${x1} ${y1}`);
    }
  }
  push(`<path d="${d.join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" ${arrow ? 'marker-end="url(#arrow)"' : ''}/>`);
  if (label) {
    const { text, x, y, anchor = 'middle', rotate = false } = label;
    const lines = Array.isArray(text) ? text : [text];
    const t = rotate
      ? `<g transform="translate(${x} ${y}) rotate(-90)">${textBlock(lines, 0, 0, { size: 12.5, weight: 600, fill: C.flowText })}</g>`
      : textBlock(lines, x, y, { size: 12.5, weight: 600, fill: C.flowText, anchor, lh: 15 });
    push(`<g class="flow-label">${t}</g>`);
  }
}

const lab = (text, x, y, anchor = 'middle') => ({ text, x, y, anchor });

// ─── document shell ─────────────────────────────────────────────────────────
const defs = `
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="${C.flow}"/>
  </marker>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${C.grid}" stroke-width="1"/>
  </pattern>
  <style>
    text { font-family: "Segoe UI", "Inter", Arial, sans-serif; }
    .flow-label text { paint-order: stroke; stroke: #ffffff; stroke-width: 4px; stroke-linejoin: round; }
  </style>
</defs>`;

push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`);
push(defs);
push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
push(`<rect width="${W}" height="${H}" fill="url(#grid)" opacity=".5"/>`);

// ─── header ─────────────────────────────────────────────────────────────────
push(`<g>
  <text x="100" y="66" font-size="30" font-weight="700" fill="${C.ink}">Level 1 Data Flow Diagram — Barangay 179 Crime Intelligence &amp; Patrol Decision Support System</text>
  <text x="100" y="98" font-size="15" fill="${C.muted}">Gane–Sarson notation · 8 processes · 8 data stores (T1–T8) · 4 external entities · every store is connected to at least one process</text>
  <text x="100" y="128" font-size="13.5" fill="#8A5A12">Corrected from the submitted drawing: data stores are wired in, duplicate flow names are merged, CART scoring has an owning process (4.0), and flows are labelled at the end that owns the data (the four authentication pairs share one annotation).</text>
</g>`);

// legend
push(`<g class="legend">
  <rect x="2030" y="36" width="610" height="112" rx="8" fill="#ffffff" stroke="#D5DCE5"/>
  <text x="2050" y="60" font-size="12" font-weight="700" fill="${C.muted}">LEGEND</text>
  <rect x="2050" y="72" width="34" height="22" rx="4" fill="${C.entityFill}" stroke="${C.entityStroke}" stroke-width="1.4"/>
  <text x="2094" y="88" font-size="12.5" fill="${C.ink}">External entity</text>
  <rect x="2270" y="72" width="34" height="22" rx="8" fill="${C.processFill}" stroke="${C.processStroke}" stroke-width="1.4"/>
  <text x="2314" y="88" font-size="12.5" fill="${C.ink}">Process</text>
  <rect x="2425" y="72" width="34" height="22" rx="2" fill="${C.storeFill}" stroke="${C.storeStroke}" stroke-width="1.4"/>
  <line x1="2432" y1="72" x2="2432" y2="94" stroke="${C.storeStroke}"/>
  <text x="2469" y="88" font-size="12.5" fill="${C.ink}">Data store</text>
  <line x1="2050" y1="120" x2="2100" y2="120" stroke="${C.flow}" stroke-width="1.7" marker-end="url(#arrow)"/>
  <text x="2112" y="124" font-size="12.5" fill="${C.ink}">Data flow (arrow = direction)</text>
  <text x="2330" y="124" font-size="12" fill="${C.muted}">labels sit at the end that owns the data</text>
</g>`);

// ─── boxes ──────────────────────────────────────────────────────────────────
const processNames = {
  '1.0': ['Authentication &', 'Session Management'],
  '2.0': ['User Management'],
  '3.0': ['Incident Record', 'Management'],
  '4.0': ['CART Risk Scoring'],
  '5.0': ['Geospatial Heatmap'],
  '6.0': ['Dashboard & Analytics'],
  '7.0': ['Patrol Management'],
  '8.0': ['Reports, Audit Trails,', 'Settings & Archive'],
};
for (const [id, name] of Object.entries(processNames)) processBox(id, name);

const storeNames = {
  T1: 'User', T2: 'Incident Records', T3: 'Cart Risk Factor', T4: 'Patrol Schedules',
  T5: 'Audit Logs', T6: 'Settings', T7: 'Sessions', T8: 'Archive',
};
for (const [id, name] of Object.entries(storeNames)) storeBox(id, name);

entityBox('E1', 'User', 'records entry & lookup');
entityBox('E2', 'Team Leader', 'records, patrols');
entityBox('E3', 'Executive Officer', 'administrator');
entityBox('E4', 'Kagawad', 'read-only');

// ─── flows ──────────────────────────────────────────────────────────────────

// authentication lanes, one per external entity
const auth = [
  { e: 'E1', lane: 2130 },
  { e: 'E2', lane: 2150 },
  { e: 'E3', lane: 2170 },
  { e: 'E4', lane: 2190 },
];

// helper: store → process read, labelled at the process end (destination)
function read(procId, sy, py, text, lane) {
  const pts = [[S.x + S.w, sy]];
  if (sy !== py) pts.push([lane, sy], [lane, py]);
  pts.push([P.x, py]);
  flow(pts, { label: lab(text, P.x - 16, py - 8, 'end') });
}
// helper: process → store write, labelled at the store end (destination)
function write(sy, py, text, lane) {
  const pts = [[P.x, py]];
  if (sy !== py) pts.push([lane, py], [lane, sy]);
  pts.push([S.x + S.w, sy]);
  flow(pts, { label: lab(text, S.x + S.w + 14, sy - 8, 'start') });
}

// — authentication: 4 credential/status pairs into 1.0, each on its own lane.
// One annotation explains the exchange instead of eight overlapping labels.
auth.forEach(({ e, lane }, i) => {
  const yIn = E.y[e] + 26;
  const yOut = E.y[e] + 40;
  const pIn = 206 + i * 20;
  const pOut = pIn + 9;
  flow([[E.x, yIn], [lane, yIn], [lane, pIn], [P.x + P.w, pIn]]);
  flow([[P.x + P.w, pOut], [lane + 12, pOut], [lane + 12, yOut], [E.x, yOut]]);
});
push(`<g class="flow-label">${textBlock('Each entity exchanges login credentials (→ 1.0) for a session token + role (←), on its own lane.', 1400, 162, { size: 12.5, weight: 600, fill: C.muted, anchor: 'start' })}</g>`);

// — owner pairs —
// 1.0 ↔ T7
read('1.0', 230, 230, 'active session & role');
write(246, 258, 'session token & expiry', 620);
// 1.0 ← T1 (auth lookup)
read('1.0', 424, 300, 'stored credentials, role & lockout state', 700);
// 2.0 ↔ T1
read('2.0', 442, 440, 'user accounts, roles & status');
write(462, 476, 'created / updated / deactivated accounts', 840);
// 3.0 ↔ T2
read('3.0', 636, 636, 'incident records & evidence links');
write(660, 664, 'new / updated incident record');
// 4.0 ↔ T3
read('4.0', 875, 886, 'weights, factors & prior scores', 720);
write(900, 912, 'factor scores, level & run log');
// 7.0 ↔ T4
read('7.0', 1500, 1544, 'schedules & patrol logs', 470);
write(1520, 1580, 'new / updated patrol data', 430);
// 8.0 ↔ T5 (audit review)
read('8.0', 1682, 1724, 'audit trail entries', 500);
write(1694, 1778, 'admin-action audit entries', 540);
// 8.0 ↔ T6 (settings)
read('8.0', 1745, 1742, 'current settings & CART weights', 560);
write(1775, 1796, 'updated settings', 580);
// 8.0 ↔ T8 (archive)
read('8.0', 1865, 1760, 'archived records & files', 600);
write(1895, 1814, 'restore / purge request', 620);

// — audit writes into T5, labelled at the store end —
const audits = [
  { py: 322, lane: 830, sy: 1602, text: 'login & session audit' },
  { py: 522, lane: 855, sy: 1622, text: 'user administration audit' },
  { py: 742, lane: 880, sy: 1642, text: 'record change audit' },
  { py: 1600, lane: 905, sy: 1662, text: 'patrol change audit' },
];
audits.forEach(({ py, lane, sy, text }) => {
  flow([[P.x, py], [lane, py], [lane, sy], [S.x + S.w, sy]], {
    label: lab(text, S.x + S.w + 14, sy - 8, 'start'),
  });
});

// — cross-store reads —
read('4.0', 680, 858, 'record & street history', 600);
read('5.0', 696, 1072, 'incident locations & types', 625);
read('5.0', 925, 1094, 'risk scores & levels', 725);
read('6.0', 712, 1286, 'incident aggregates', 650);
read('6.0', 948, 1308, 'risk aggregates', 750);
read('6.0', 1478, 1330, 'patrol coverage', 775);
read('6.0', 1745, 1352, 'display settings', 800);
read('7.0', 728, 1520, 'open incidents', 675);
read('8.0', 744, 1706, 'records for reports', 700);

// — 3.0 → 4.0 (a save triggers scoring) —
flow([[P.x + 120, P.y['3.0'] + P.h], [P.x + 120, P.y['4.0']]], {
  label: lab('saved record (score trigger)', P.x + 134, 800, 'start'),
});

// — entity ↔ process pairs, labelled at the process end —
function entFlow(eId, pId, eBand, pIn, pOut, inText, outText, laneIn, laneOut) {
  const ey = E.y[eId] + eBand;
  flow([[E.x, ey], [laneIn, ey], [laneIn, pIn], [P.x + P.w, pIn]], {
    label: lab(inText, P.x + P.w + 14, pIn - 8, 'start'),
  });
  flow([[P.x + P.w, pOut], [laneOut, pOut], [laneOut, ey + 13], [E.x, ey + 13]], {
    label: lab(outText, P.x + P.w + 14, pOut - 8, 'start'),
  });
}

// E2 — records (p 628/650)
entFlow('E2', '3.0', 52, 628, 650, 'incident forms & evidence', 'incident records & lists', 1740, 1760);
// E1 — records (p 672/694)
entFlow('E1', '3.0', 52, 672, 694, 'incident forms & evidence', 'saved record + number', 1660, 1680);
// E4 — records, read-only (p 716/738)
entFlow('E4', '3.0', 52, 716, 738, 'record search criteria', 'incident records', 1700, 1720);
// E3 — user management (p 450/474)
entFlow('E3', '2.0', 52, 450, 474, 'user account details', 'account confirmation & list', 1620, 1640);
// E3 — heatmap (p 1064/1088)
entFlow('E3', '5.0', 82, 1064, 1088, 'map view & filters', 'interactive heatmap data', 1820, 1840);
// E4 — heatmap (p 1112/1136)
entFlow('E4', '5.0', 82, 1112, 1136, 'map view & filters', 'interactive heatmap data', 1860, 1880);
// E4 — dashboard (p 1300/1324)
entFlow('E4', '6.0', 112, 1300, 1324, 'dashboard filters', 'KPIs, charts & reports', 1900, 1920);
// E2 — patrols (p 1500/1524)
entFlow('E2', '7.0', 112, 1500, 1524, 'schedules, logs & availability', 'patrol recommendations', 1780, 1800);
// E3 — patrol approvals (p 1560/1584)
entFlow('E3', '7.0', 112, 1560, 1584, 'schedule approvals', 'patrol status', 1940, 1960);
// E3 — administration (p 1730/1752)
entFlow('E3', '8.0', 142, 1730, 1752, 'settings, audit & archive requests', 'reports, audit trail & restored records', 1980, 2000);

// Summary note
push(`<g class="note">
  <rect x="100" y="1960" width="2540" height="150" rx="10" fill="${C.noteFill}" stroke="${C.noteStroke}" stroke-width="1.2"/>
  <text x="126" y="1990" font-size="13.5" font-weight="700" fill="#6B5A12">READING NOTES — the complete read/write matrix for every store is in docs/DFD-REVIEW.md §5.</text>
  <text x="126" y="2014" font-size="13" fill="#5A4E16">1. 1.0, 2.0, 3.0 and 7.0 each append an audit row to T5 (one arrow per writer). 8.0 reads, filters and exports the trail.</text>
  <text x="126" y="2038" font-size="13" fill="#5A4E16">2. Session checks are not repeated on every process: all routes re-validate the caller against T7 through 1.0 (see docs/DFD.md §3).</text>
  <text x="126" y="2062" font-size="13" fill="#5A4E16">3. 4.0 reads T6 (weights &amp; thresholds) on every run; 6.0 reads T6 for display thresholds. Only 8.0 writes settings, so the read is drawn once via 6.0 and the T6↔8.0 pair.</text>
  <text x="126" y="2086" font-size="13" fill="#5A4E16">4. E1 is the front-desk “User” account (any authenticated staff session). E2 is the Team Leader acting on records and patrols; E3 is the only administrator; E4 (Kagawad) is read-only. The overlap between E1 and E2–E4 is discussed in docs/DFD-REVIEW.md §6.</text>
</g>`);

push('</svg>');

fs.writeFileSync(path.join(__dirname, 'dfd-level-1-reviewed.svg'), out.join('\n'));
console.log('wrote dfd-level-1-reviewed.svg');
