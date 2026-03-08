const socket = io();

// Piece unicode map
const PIECES = {
  wp: '\u2659', wn: '\u2658', wb: '\u2657', wr: '\u2656', wq: '\u2655', wk: '\u2654',
  bp: '\u265F', bn: '\u265E', bb: '\u265D', br: '\u265C', bq: '\u265B', bk: '\u265A',
};

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };

let myColor = null;
let currentFen = null;
let selectedSquare = null;
let legalMoves = [];
let lastMove = null;
let pendingPromotion = null;
let boardState = null;

// DOM elements
const lobby = document.getElementById('lobby');
const waiting = document.getElementById('waiting');
const game = document.getElementById('game');
const gameoverOverlay = document.getElementById('gameover-overlay');

// Session persistence
function saveSession(gameId, token, color) {
  localStorage.setItem('schach_session', JSON.stringify({ gameId, token, color }));
}

function loadSession() {
  try {
    const data = localStorage.getItem('schach_session');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem('schach_session');
}

// Parse FEN to board array
function fenToBoard(fen) {
  const rows = fen.split(' ')[0].split('/');
  const board = [];
  for (const row of rows) {
    const boardRow = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < parseInt(ch); i++) boardRow.push(null);
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        const piece = ch.toLowerCase();
        boardRow.push({ color, type: piece });
      }
    }
    board.push(boardRow);
  }
  return board;
}

function getTurn(fen) {
  return fen.split(' ')[1];
}

function showGame(gameId, fen) {
  lobby.classList.add('hidden');
  waiting.classList.add('hidden');
  game.classList.remove('hidden');
  document.getElementById('game-id-display').textContent = 'Spiel: ' + gameId;
  document.getElementById('player-label').textContent = myColor === 'w' ? 'Weiss (Du)' : 'Schwarz (Du)';
  document.getElementById('opponent-label').textContent = myColor === 'w' ? 'Schwarz' : 'Weiss';
  renderBoard(fen);
}

// Render the board
function renderBoard(fen) {
  currentFen = fen;
  boardState = fenToBoard(fen);
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  const turn = getTurn(fen);

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      // Flip board for black
      const row = myColor === 'b' ? 7 - r : r;
      const col = myColor === 'b' ? 7 - c : c;

      const sq = document.createElement('div');
      const file = String.fromCharCode(97 + col);
      const rank = 8 - row;
      const squareName = file + rank;

      sq.className = 'square ' + ((row + col) % 2 === 0 ? 'light' : 'dark');
      sq.dataset.square = squareName;

      if (lastMove && (squareName === lastMove.from || squareName === lastMove.to)) {
        sq.classList.add('last-move');
      }

      if (selectedSquare === squareName) {
        sq.classList.add('selected');
      }

      // Check indicator
      if (boardState[row][col] && boardState[row][col].type === 'k' &&
          boardState[row][col].color === turn && fen.includes(' ' + turn + ' ') && isKingInCheck(fen)) {
        sq.classList.add('check');
      }

      // Legal move dots
      if (legalMoves.includes(squareName)) {
        if (boardState[row][col]) {
          sq.classList.add('legal-capture');
        } else {
          sq.classList.add('legal-move');
        }
      }

      const piece = boardState[row][col];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece';
        span.textContent = PIECES[piece.color + piece.type];
        sq.appendChild(span);
      }

      sq.addEventListener('click', () => onSquareClick(squareName));
      sq.addEventListener('touchend', (e) => {
        e.preventDefault();
        onSquareClick(squareName);
      });

      boardEl.appendChild(sq);
    }
  }

  updateStatus(fen);
  updateCaptured(fen);
}

function isKingInCheck(fen) {
  return false;
}

function onSquareClick(square) {
  if (!currentFen) return;
  const turn = getTurn(currentFen);
  if (turn !== myColor) return;

  const board = boardState;
  const col = square.charCodeAt(0) - 97;
  const row = 8 - parseInt(square[1]);
  const piece = board[row][col];

  if (selectedSquare) {
    if (square === selectedSquare) {
      selectedSquare = null;
      legalMoves = [];
      renderBoard(currentFen);
      return;
    }

    if (piece && piece.color === myColor) {
      selectedSquare = square;
      legalMoves = getLegalMovesFrom(square);
      renderBoard(currentFen);
      return;
    }

    // Try to move
    const fromRow = 8 - parseInt(selectedSquare[1]);
    const fromCol = selectedSquare.charCodeAt(0) - 97;
    const fromPiece = board[fromRow][fromCol];

    // Check for promotion
    if (fromPiece && fromPiece.type === 'p') {
      const targetRank = parseInt(square[1]);
      if ((myColor === 'w' && targetRank === 8) || (myColor === 'b' && targetRank === 1)) {
        pendingPromotion = { from: selectedSquare, to: square };
        showPromotionModal();
        return;
      }
    }

    socket.emit('move', { from: selectedSquare, to: square });
    selectedSquare = null;
    legalMoves = [];
  } else {
    if (piece && piece.color === myColor) {
      selectedSquare = square;
      legalMoves = getLegalMovesFrom(square);
      renderBoard(currentFen);
    }
  }
}

// Basic legal move computation from FEN (simplified)
function getLegalMovesFrom(from) {
  const col = from.charCodeAt(0) - 97;
  const row = 8 - parseInt(from[1]);
  const piece = boardState[row][col];
  if (!piece || piece.color !== myColor) return [];

  const moves = [];
  const addIf = (r, c) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const target = boardState[r][c];
    const sq = String.fromCharCode(97 + c) + (8 - r);
    if (!target) { moves.push(sq); return true; }
    if (target.color !== piece.color) { moves.push(sq); return false; }
    return false;
  };

  const t = piece.type;
  const dir = piece.color === 'w' ? -1 : 1;

  if (t === 'p') {
    if (!boardState[row + dir]?.[col]) {
      addIf(row + dir, col);
      const startRow = piece.color === 'w' ? 6 : 1;
      if (row === startRow && !boardState[row + 2 * dir]?.[col]) {
        addIf(row + 2 * dir, col);
      }
    }
    for (const dc of [-1, 1]) {
      const tr = row + dir, tc = col + dc;
      if (tr >= 0 && tr <= 7 && tc >= 0 && tc <= 7) {
        const target = boardState[tr][tc];
        if (target && target.color !== piece.color) {
          moves.push(String.fromCharCode(97 + tc) + (8 - tr));
        }
        const epSquare = getEnPassantSquare(currentFen);
        const sq = String.fromCharCode(97 + tc) + (8 - tr);
        if (sq === epSquare) {
          moves.push(sq);
        }
      }
    }
  } else if (t === 'n') {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      addIf(row + dr, col + dc);
    }
  } else if (t === 'b') {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      for (let i = 1; i < 8; i++) { if (!addIf(row + dr*i, col + dc*i)) break; if (boardState[row+dr*i]?.[col+dc*i]) break; }
    }
  } else if (t === 'r') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      for (let i = 1; i < 8; i++) { if (!addIf(row + dr*i, col + dc*i)) break; if (boardState[row+dr*i]?.[col+dc*i]) break; }
    }
  } else if (t === 'q') {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      for (let i = 1; i < 8; i++) { if (!addIf(row + dr*i, col + dc*i)) break; if (boardState[row+dr*i]?.[col+dc*i]) break; }
    }
  } else if (t === 'k') {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      addIf(row + dr, col + dc);
    }
    const castling = currentFen.split(' ')[2];
    if (piece.color === 'w' && row === 7 && col === 4) {
      if (castling.includes('K') && !boardState[7][5] && !boardState[7][6]) moves.push('g1');
      if (castling.includes('Q') && !boardState[7][1] && !boardState[7][2] && !boardState[7][3]) moves.push('c1');
    }
    if (piece.color === 'b' && row === 0 && col === 4) {
      if (castling.includes('k') && !boardState[0][5] && !boardState[0][6]) moves.push('g8');
      if (castling.includes('q') && !boardState[0][1] && !boardState[0][2] && !boardState[0][3]) moves.push('c8');
    }
  }

  return moves;
}

function getEnPassantSquare(fen) {
  const parts = fen.split(' ');
  return parts[3] !== '-' ? parts[3] : null;
}

function showPromotionModal() {
  const modal = document.getElementById('promotion-modal');
  const container = modal.querySelector('.promotion-pieces');
  container.innerHTML = '';
  modal.classList.remove('hidden');

  const pieces = ['q', 'r', 'b', 'n'];
  for (const p of pieces) {
    const btn = document.createElement('div');
    btn.className = 'promotion-piece';
    btn.textContent = PIECES[myColor + p];
    btn.addEventListener('click', () => {
      modal.classList.add('hidden');
      socket.emit('move', { from: pendingPromotion.from, to: pendingPromotion.to, promotion: p });
      selectedSquare = null;
      legalMoves = [];
      pendingPromotion = null;
    });
    container.appendChild(btn);
  }
}

function updateStatus(fen) {
  const turn = getTurn(fen);
  const statusEl = document.getElementById('status-text');
  if (turn === myColor) {
    statusEl.textContent = 'Du bist am Zug';
    statusEl.style.color = '#4ecdc4';
  } else {
    statusEl.textContent = 'Gegner ist am Zug';
    statusEl.style.color = '#e2b04a';
  }
}

function updateCaptured(fen) {
  const initial = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

  for (const row of boardState) {
    for (const piece of row) {
      if (piece && piece.type !== 'k') {
        count[piece.color][piece.type]++;
      }
    }
  }

  const capturedBy = (color) => {
    const enemy = color === 'w' ? 'b' : 'w';
    let str = '';
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const diff = initial[t] - count[enemy][t];
      for (let i = 0; i < diff; i++) str += PIECES[enemy + t];
    }
    return str;
  };

  const myCaptures = capturedBy(myColor);
  const oppCaptures = capturedBy(myColor === 'w' ? 'b' : 'w');

  document.getElementById('player-captured').textContent = myCaptures;
  document.getElementById('opponent-captured').textContent = oppCaptures;
}

// Socket events
socket.on('created', ({ gameId, color, token }) => {
  myColor = color;
  saveSession(gameId, token, color);
  lobby.classList.add('hidden');
  waiting.classList.remove('hidden');
  document.getElementById('game-code').textContent = gameId;

  const qrContainer = document.getElementById('qr-code');
  const url = window.location.origin + '?join=' + gameId;
  generateQR(qrContainer, url);
});

socket.on('joined', ({ gameId, color, fen, token, lastMove: lm }) => {
  myColor = color;
  saveSession(gameId, token, color);
  lastMove = lm;
  showGame(gameId, fen);
});

socket.on('start', ({ fen, lastMove: lm }) => {
  lastMove = lm;
  const gameId = document.getElementById('game-code').textContent || loadSession()?.gameId;
  showGame(gameId, fen);
});

socket.on('moved', ({ fen, move, lastMove: lm }) => {
  lastMove = lm;
  selectedSquare = null;
  legalMoves = [];
  renderBoard(fen);
});

socket.on('reconnected', ({ gameId, color, fen, lastMove: lm, gameOver, opponentConnected }) => {
  myColor = color;
  lastMove = lm;
  showGame(gameId, fen);

  if (!opponentConnected) {
    document.getElementById('status-text').textContent = 'Gegner nicht verbunden';
    document.getElementById('status-text').style.color = '#ff6b6b';
  }

  if (gameOver) {
    gameoverOverlay.classList.remove('hidden');
    const title = document.getElementById('gameover-title');
    const reasonEl = document.getElementById('gameover-reason');
    if (gameOver.winner) {
      const iWon = (gameOver.winner === 'Weiss' && myColor === 'w') || (gameOver.winner === 'Schwarz' && myColor === 'b');
      title.textContent = iWon ? 'Du hast gewonnen!' : 'Du hast verloren!';
    } else {
      title.textContent = 'Unentschieden!';
    }
    reasonEl.textContent = gameOver.reason;
  }
});

socket.on('opponent_reconnected', () => {
  if (currentFen) {
    updateStatus(currentFen);
  }
});

socket.on('gameover', ({ reason, winner }) => {
  gameoverOverlay.classList.remove('hidden');
  const title = document.getElementById('gameover-title');
  const reasonEl = document.getElementById('gameover-reason');

  if (winner) {
    const iWon = (winner === 'Weiss' && myColor === 'w') || (winner === 'Schwarz' && myColor === 'b');
    title.textContent = iWon ? 'Du hast gewonnen!' : 'Du hast verloren!';
  } else {
    title.textContent = 'Unentschieden!';
  }
  reasonEl.textContent = reason;
});

socket.on('opponent_left', () => {
  document.getElementById('status-text').textContent = 'Gegner nicht verbunden';
  document.getElementById('status-text').style.color = '#ff6b6b';
});

socket.on('error_msg', (msg) => {
  const lobbyErr = document.getElementById('lobby-error');
  if (!lobby.classList.contains('hidden')) {
    lobbyErr.textContent = msg;
    setTimeout(() => lobbyErr.textContent = '', 3000);
  }
});

// Button handlers
document.getElementById('btn-create').addEventListener('click', () => {
  clearSession();
  socket.emit('create');
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('input-code').value.trim();
  if (code.length < 4) return;
  clearSession();
  socket.emit('join', code);
});

document.getElementById('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});

document.getElementById('btn-copy').addEventListener('click', () => {
  const code = document.getElementById('game-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    document.getElementById('btn-copy').textContent = 'Kopiert!';
    setTimeout(() => document.getElementById('btn-copy').textContent = 'Kopieren', 2000);
  });
});

document.getElementById('btn-resign').addEventListener('click', () => {
  if (confirm('Wirklich aufgeben?')) {
    socket.emit('resign');
  }
});

document.getElementById('btn-newgame').addEventListener('click', () => {
  clearSession();
  window.location.href = window.location.origin + window.location.pathname;
});

// On load: try to reconnect or auto-join from URL
const params = new URLSearchParams(window.location.search);
if (params.has('join')) {
  const code = params.get('join');
  document.getElementById('input-code').value = code;
  socket.emit('join', code);
} else {
  const session = loadSession();
  if (session) {
    socket.emit('reconnect_game', { gameId: session.gameId, token: session.token });
  }
}

// QR Code generator
function generateQR(container, text) {
  const img = document.createElement('img');
  const size = 180;
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=1a1a2e&color=e2b04a&format=svg`;
  img.alt = 'QR Code';
  img.width = size;
  img.height = size;
  img.style.borderRadius = '8px';
  container.appendChild(img);
}
