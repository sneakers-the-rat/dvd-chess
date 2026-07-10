import Ffish from './ffish.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Position primed to spawn DVDs: white pawns on b7 & g7, black pawn on c2.
const SPAWN_FEN = 'r3k2r/1P4P1/8/8/8/8/2p5/R3K2R w KQkq - 0 1';

const DVD_CONFIG = `[dvdchess:chess]
customPiece1 = d:
customPiece2 = v:
customPiece3 = w:
customPiece4 = y:
dvdChess = true
pieceValueMg = d:200 v:200 w:200 y:200
pieceValueEg = d:200 v:200 w:200 y:200
`;

const GLYPH = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
};
const DVD_ARROW = { d: '↗', v: '↖', w: '↘', y: '↙' }; // NE NW SE SW
const DVD_DIRCLASS = { d: 'ne', v: 'nw', w: 'se', y: 'sw' };

const $ = id => document.getElementById(id);
const boardEl = $('board');
const statusEl = $('status');

let ff = null, board = null, ready = false;
let cur = { fen: START_FEN, legal: [], turn: 'w', over: false, result: '', check: false };
let humanSide = 'w', aiOn = true, movetime = 700;
let selected = null, thinking = false, placingDvd = false;
let history = [], viewIndex = 0;
let DVD_SVG = ''; // inline SVG markup for the DVD logo (fetched at boot)
let sfx_checkbox = $('sfx');

const fileChar = f => String.fromCharCode(97 + f);
const uciSq = (f, r) => fileChar(f) + (r + 1);

function readState() {
  const lm = board.legalMoves();
  const over = board.isGameOver();
  cur = {
    fen: board.fen(),
    legal: lm ? lm.split(' ').filter(Boolean) : [],
    turn: board.turn() ? 'w' : 'b',
    over,
    result: over ? board.result() : '',
    check: board.isCheck()
  };
}

function parseFen(fen) {
  const rows = fen.split(/\s+/)[0].split('/');
  const grid = {};
  for (let i = 0; i < 8; i++) {
    const r = 7 - i; let f = 0;
    for (const ch of rows[i]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const low = ch.toLowerCase();
      grid[uciSq(f, r)] = { c: ch === low ? 'b' : 'w', letter: low };
      f++;
    }
  }
  return grid;
}

function myTurn() { return ready && !cur.over && cur.turn === humanSide && !thinking; }

function render() {
  const grid = parseFen(cur.fen);
  const targets = selected ? cur.legal.filter(m => m.startsWith(selected)).map(m => m.slice(2, 4)) : [];
  // Highlight the last move (the one that led to the position being viewed).
  const lm = (history[viewIndex] && history[viewIndex].uci) || null;
  const lastFrom = lm ? lm.slice(0, 2) : null;
  const lastTo = lm ? lm.slice(2, 4) : null;
  const table = document.createElement('table');
  table.className = 'board';
  for (let r = 7; r >= 0; r--) {
    const tr = document.createElement('tr');
    const rl = document.createElement('td'); rl.className = 'coord'; rl.textContent = r + 1; tr.appendChild(rl);
    for (let f = 0; f < 8; f++) {
      const s = uciSq(f, r);
      const td = document.createElement('td');
      td.className = 'sq ' + ((f + r) % 2 ? 'light' : 'dark');
      if (s === lastFrom) td.classList.add('lastfrom');
      if (s === lastTo) td.classList.add('lastto');
      if (s === selected) td.classList.add('selected');
      if (targets.includes(s)) td.classList.add(grid[s] ? 'capture' : 'target');
      const p = grid[s];
      if (p) {
        const el = document.createElement('span');
        let arrow = null;
        if (DVD_ARROW[p.letter]) {
          el.className = 'piece dvd ' + p.c;
          el.innerHTML = DVD_SVG;
          // Direction arrow is a SEPARATE overlay sibling, not part of the art.
          arrow = document.createElement('span');
          arrow.className = 'dvd-arrow ' + DVD_DIRCLASS[p.letter];
          arrow.textContent = DVD_ARROW[p.letter];
        } else {
          el.className = 'piece ' + p.c;
          el.textContent = GLYPH[p.c + p.letter.toUpperCase()];
        }
        if (myTurn() && cur.legal.some(m => m.startsWith(s))) {
          el.draggable = true;
          el.addEventListener('dragstart', ev => { selected = s; render(); ev.dataTransfer.setData('text/plain', s); });
        }
        td.appendChild(el);
        if (arrow) td.appendChild(arrow);
      }
      td.addEventListener('click', () => onClick(s));
      td.addEventListener('dragover', ev => ev.preventDefault());
      td.addEventListener('drop', ev => { ev.preventDefault(); const from = ev.dataTransfer.getData('text/plain') || selected; if (from) tryMove(from, s); });
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  const fl = document.createElement('tr'); fl.appendChild(document.createElement('td'));
  for (let f = 0; f < 8; f++) { const td = document.createElement('td'); td.className = 'coord'; td.textContent = fileChar(f); fl.appendChild(td); }
  table.appendChild(fl);
  boardEl.innerHTML = '';
  boardEl.appendChild(table);
  const fenBox = $('fen');
  if (fenBox && document.activeElement !== fenBox) fenBox.value = cur.fen;
  updateStatus();
}

function updateStatus() {
  if (!ready) return; // status set by boot
  if (cur.over) { statusEl.textContent = 'Game over — ' + cur.result + '.'; return; }
  let m = (cur.turn === 'w' ? 'White' : 'Black') + ' to move';
  if (cur.check) m += ' (check)';
  if (thinking) m = 'Stockfish is thinking…';
  statusEl.textContent = m;
}

function onClick(s) {
  if (placingDvd) { placingDvd = false; placeDvdAt(s); return; }
  if (!myTurn()) return;
  if (selected) {
    const cands = cur.legal.filter(m => m.startsWith(selected) && m.slice(2, 4) === s);
    if (cands.length) { chooseMove(cands); return; }
  }
  const hasMove = cur.legal.some(m => m.startsWith(s));
  selected = hasMove ? s : null;
  render();
  // Explain why an un-steerable DVD can't be picked up (otherwise it just does
  // nothing, which is confusing).
  if (!hasMove) {
    const p = parseFen(cur.fen)[s];
    if (p && DVD_ARROW[p.letter]) {
      statusEl.textContent = (p.c !== cur.turn)
        ? "That DVD is the opponent's colour this turn — you can capture it, but you can only steer it on your turns when it's yours."
        : "A DVD can only be nudged one square ALONG the edge it rests on (sideways, not into the board, and never into a corner).";
      console.log('[DVD] square=%s colour=%s sideToMove=%s\nFEN: %s\nlegal moves: %s',
        s, p.c, cur.turn, cur.fen, cur.legal.join(' '));
    }
  }
}

function tryMove(from, to) {
  const cands = cur.legal.filter(m => m.startsWith(from) && m.slice(2, 4) === to);
  if (cands.length) chooseMove(cands); else { selected = null; render(); }
}

function chooseMove(cands) {
  if (cands.length > 1 || cands.some(m => m.length === 5)) showPromotion(cands);
  else doMove(cands[0]);
}

function showPromotion(cands) {
  const box = $('promo');
  box.innerHTML = 'Promote to: ';
  const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
  for (const uci of cands) {
    const suf = uci.length === 5 ? uci[4] : null;
    const btn = document.createElement('button');
    if (suf && names[suf]) btn.textContent = names[suf];
    else if (suf && DVD_ARROW[suf]) btn.textContent = 'DVD ' + DVD_ARROW[suf];
    else btn.textContent = 'Move';
    btn.addEventListener('click', () => { box.style.display = 'none'; doMove(uci); });
    box.appendChild(btn);
  }
  const c = document.createElement('button'); c.textContent = 'cancel';
  c.addEventListener('click', () => { box.style.display = 'none'; selected = null; render(); });
  box.appendChild(c);
  box.style.display = 'block';
}

function doMove(uci) {
  selected = null;
  try { board.push(uci); } catch (e) { return fail(e); }
  readState();
  recordMove(uci);
  render();
  maybeAi();
}

function maybeAi() {
  if (!ready || cur.over || !aiOn || cur.turn === humanSide) return;
  thinking = true; render();
  setTimeout(() => {
    let mv = null;
    try {
      mv = board.bestMove(movetime);
      if (mv && mv !== '(none)') board.push(mv);
    } catch (e) { return fail(e); }
    thinking = false; readState();
    if (mv && mv !== '(none)') recordMove(mv);
    render(); maybeAi();
  }, 30);
}

function newGame(fen) {
  if (!ready) return;
  selected = null;
  board.setFen(fen);
  readState();
  resetHistory();
  render();
  maybeAi();
}

// Demo helper: put the board into "place a DVD" mode.
function startPlaceDvd() {
  if (!ready) return;
  placingDvd = true;
  selected = null;
  statusEl.textContent = 'Add DVD: click an empty square (a DVD is placed for ' +
    (cur.turn === 'w' ? 'White' : 'Black') + ', aimed toward the centre).';
}

// Rewrite the current FEN to add a DVD on square `s`, then reload it into the
// engine so it becomes a real piece.
function placeDvdAt(s) {
  const grid = parseFen(cur.fen);
  if (grid[s]) { statusEl.textContent = 'That square is occupied — pick an empty one.'; return; }
  const f = s.charCodeAt(0) - 97, r = +s.slice(1) - 1;
  const df = f < 3.5 ? 1 : -1;               // aim toward the centre
  const dr = r < 3.5 ? 1 : -1;
  const dirLetter = { '1,1': 'd', '-1,1': 'v', '1,-1': 'w', '-1,-1': 'y' }[df + ',' + dr];
  const ch = cur.turn === 'w' ? dirLetter.toUpperCase() : dirLetter;
  const fen = withPiece(cur.fen, f, r, ch);
  try { board.setFen(fen); } catch (e) { return fail(e); }
  readState(); resetHistory('— placed DVD —'); render();
}

function withPiece(fen, f, r, ch) {
  const parts = fen.split(/\s+/);
  const rows = parts[0].split('/');
  const i = 7 - r;
  const cells = [];
  for (const c of rows[i]) { if (/\d/.test(c)) { for (let k = 0; k < +c; k++) cells.push(''); } else cells.push(c); }
  cells[f] = ch;
  let row = '', empty = 0;
  for (const c of cells) { if (c === '') empty++; else { if (empty) { row += empty; empty = 0; } row += c; } }
  if (empty) row += empty;
  rows[i] = row;
  parts[0] = rows.join('/');
  return parts.join(' ');
}

function fail(e) {
  statusEl.textContent = 'Engine error: ' + (e && e.message ? e.message : e);
  console.error(e);
}

// ---- Move history (each ply: player move + the DVD's resulting square) ----
function dvdSuffix(fen) {
  const rows = fen.split(/\s+/)[0].split('/');
  const arr = { d: '↗', v: '↖', w: '↘', y: '↙' };
  const out = [];
  for (let i = 0; i < 8; i++) {
    let f = 0;
    for (const c of rows[i]) {
      if (/\d/.test(c)) { f += +c; continue; }
      const lo = c.toLowerCase();
      if (arr[lo]) out.push(String.fromCharCode(97 + f) + (8 - i) + arr[lo]);
      f++;
    }
  }
  return out.length ? '   DVD ' + out.join(' ') : '';
}
function labelFor(ply, uci, fen) {
  const full = Math.ceil(ply / 2);
  const dot = (ply % 2 === 1) ? '.' : '…';
  return `${full}${dot} ${uci}${dvdSuffix(fen)}`;
}
function renderHistory() {
  const sel = $('history');
  sel.innerHTML = '';
  history.forEach((h, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = h.label;
    sel.appendChild(o);
  });
  sel.selectedIndex = viewIndex;
  const opt = sel.options[viewIndex];
  if (opt) opt.parentNode.scrollTop = opt.offsetTop;
}
function resetHistory(startLabel) {
  history = [{ fen: cur.fen, label: startLabel || '— start —' }];
  viewIndex = 0;
  renderHistory();
}
function recordMove(uci) {
  if (viewIndex < history.length - 1) history.length = viewIndex + 1; // branch off
  const ply = history.length; // new entry's index == ply number
  history.push({ fen: cur.fen, uci, label: labelFor(ply, uci, cur.fen) });
  viewIndex = history.length - 1;
  renderHistory();
}
function gotoHistory(i) {
  if (!ready || i < 0 || i >= history.length) return;
  viewIndex = i;
  selected = null;
  board.setFen(history[i].fen);
  readState();
  render();
}

function initPanelDrag() {
  let drag = null, dx = 0, dy = 0, ztop = 50;
  const INTERACTIVE = 'button, select, option, input, label, textarea, a, iframe, table, .piece';
  document.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const frame = e.target.closest('.frame');
    if (!frame || e.target.closest(INTERACTIVE)) return;
    const r = frame.getBoundingClientRect();
    if (r.right - e.clientX < 20 && r.bottom - e.clientY < 20) return; // leave the resize corner alone
    frame.style.width = r.width + 'px';
    frame.style.left = (r.left + window.scrollX) + 'px';
    frame.style.top = (r.top + window.scrollY) + 'px';
    frame.classList.add('floating');
    frame.style.zIndex = String(++ztop);
    dx = e.pageX - (r.left + window.scrollX);
    dy = e.pageY - (r.top + window.scrollY);
    drag = frame;
    document.body.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    drag.style.left = (e.pageX - dx) + 'px';
    drag.style.top = (e.pageY - dy) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('dragging');
  });
}

async function boot() {
  initPanelDrag();
  // Fetch the logo SVG once so we can inline (and recolour) it per DVD.
  try {
    const txt = await (await fetch('DVD_logo.svg')).text();
    DVD_SVG = txt.replace(/^[\s\S]*?<svg/i, '<svg'); // strip any XML prolog
  } catch (e) { console.warn('DVD logo failed to load:', e); }

  $('btn-new').addEventListener('click', () => newGame(START_FEN));
  $('btn-spawn').addEventListener('click', () => newGame(SPAWN_FEN));
  $('btn-dvd').addEventListener('click', startPlaceDvd);
  $('side').addEventListener('change', e => { humanSide = e.target.value; render(); maybeAi(); });
  $('ai').addEventListener('change', e => { aiOn = e.target.checked; maybeAi(); });
  $('level').addEventListener('change', e => { movetime = +e.target.value; });
  $('history').addEventListener('change', e => gotoHistory(+e.target.value));
  $('fen').addEventListener('change', e => {
    if (!ready) return;
    const v = e.target.value.trim();
    try {
      board.setFen(v);
      readState();
      resetHistory('— edited FEN —');
      render();
      maybeAi();
    } catch (err) {
      statusEl.textContent = 'Invalid FEN — reverted.';
      e.target.value = cur.fen;
    }
  });
  render();

  statusEl.textContent = 'Loading engine…';
  try {
    ff = await Ffish();
    ff.loadVariantConfig(DVD_CONFIG);
    let initFen = START_FEN;
    if (location.hash === '#spawn') initFen = SPAWN_FEN;
    else if (location.hash.startsWith('#fen=')) initFen = decodeURIComponent(location.hash.slice(5));
    board = new ff.Board('dvdchess', initFen);
    ready = true;
    readState(); resetHistory(); render();
    maybeAi();
  } catch (e) {
    statusEl.textContent = 'Could not load the engine. it broken :(. Details: ' + (e && e.message ? e.message : e);
    console.error(e);
  }
}

document.addEventListener('click', e => {
  if (sfx_checkbox.checked) {
    new Audio('./cha-ching.mp3').play();
  }
})

boot();
