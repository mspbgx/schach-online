const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const games = new Map();

function generateId() {
  let id;
  do {
    id = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (games.has(id));
  return id;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

io.on('connection', (socket) => {
  console.log('Verbunden:', socket.id);

  socket.on('create', () => {
    const id = generateId();
    const token = generateToken();
    const chess = new Chess();
    games.set(id, {
      chess,
      white: { token, socketId: socket.id, connected: true },
      black: null,
      lastMove: null,
      gameOver: false,
    });
    socket.join(id);
    socket.gameId = id;
    socket.color = 'w';
    socket.playerToken = token;
    socket.emit('created', { gameId: id, color: 'w', token });
    console.log(`Spiel ${id} erstellt von ${socket.id}`);
  });

  socket.on('join', (gameId) => {
    const id = gameId.toUpperCase();
    const game = games.get(id);
    if (!game) {
      socket.emit('error_msg', 'Spiel nicht gefunden.');
      return;
    }
    if (game.black && game.black.connected) {
      socket.emit('error_msg', 'Spiel ist bereits voll.');
      return;
    }
    const token = generateToken();
    game.black = { token, socketId: socket.id, connected: true };
    socket.join(id);
    socket.gameId = id;
    socket.color = 'b';
    socket.playerToken = token;
    socket.emit('joined', { gameId: id, color: 'b', fen: game.chess.fen(), token, lastMove: game.lastMove });
    io.to(id).emit('start', { fen: game.chess.fen(), lastMove: game.lastMove });
    console.log(`Spieler ${socket.id} tritt Spiel ${id} bei`);
  });

  socket.on('reconnect_game', ({ gameId, token }) => {
    const id = gameId.toUpperCase();
    const game = games.get(id);
    if (!game) {
      socket.emit('error_msg', 'Spiel nicht gefunden.');
      return;
    }

    let color = null;
    if (game.white && game.white.token === token) {
      color = 'w';
      game.white.socketId = socket.id;
      game.white.connected = true;
    } else if (game.black && game.black.token === token) {
      color = 'b';
      game.black.socketId = socket.id;
      game.black.connected = true;
    } else {
      socket.emit('error_msg', 'Ungueltige Sitzung.');
      return;
    }

    socket.join(id);
    socket.gameId = id;
    socket.color = color;
    socket.playerToken = token;

    const bothConnected = game.white?.connected && game.black?.connected;

    socket.emit('reconnected', {
      gameId: id,
      color,
      fen: game.chess.fen(),
      lastMove: game.lastMove,
      gameOver: game.gameOver,
      opponentConnected: color === 'w' ? !!game.black?.connected : game.white?.connected,
    });

    // Notify opponent that player is back
    socket.to(id).emit('opponent_reconnected');
    console.log(`Spieler ${socket.id} reconnected zu Spiel ${id} als ${color === 'w' ? 'Weiss' : 'Schwarz'}`);
  });

  socket.on('move', (move) => {
    const game = games.get(socket.gameId);
    if (!game || game.gameOver) return;

    const turn = game.chess.turn();
    if (turn !== socket.color) {
      socket.emit('error_msg', 'Nicht dein Zug.');
      return;
    }

    let result;
    try {
      result = game.chess.move(move);
    } catch (e) {
      socket.emit('error_msg', 'Ungueltiger Zug.');
      return;
    }

    game.lastMove = { from: result.from, to: result.to };

    io.to(socket.gameId).emit('moved', {
      fen: game.chess.fen(),
      move: result,
      lastMove: game.lastMove,
    });

    if (game.chess.isGameOver()) {
      let reason;
      if (game.chess.isCheckmate()) reason = 'Schachmatt';
      else if (game.chess.isStalemate()) reason = 'Patt';
      else if (game.chess.isDraw()) reason = 'Remis';
      else reason = 'Spielende';

      const winner = game.chess.isCheckmate()
        ? (game.chess.turn() === 'w' ? 'Schwarz' : 'Weiss')
        : null;

      game.gameOver = { reason, winner };
      io.to(socket.gameId).emit('gameover', { reason, winner });
    }
  });

  socket.on('resign', () => {
    const game = games.get(socket.gameId);
    if (!game || game.gameOver) return;
    const winner = socket.color === 'w' ? 'Schwarz' : 'Weiss';
    game.gameOver = { reason: 'Aufgabe', winner };
    io.to(socket.gameId).emit('gameover', { reason: 'Aufgabe', winner });
  });

  socket.on('disconnect', () => {
    if (socket.gameId && games.has(socket.gameId)) {
      const game = games.get(socket.gameId);
      // Mark player as disconnected but keep the game
      if (game.white && game.white.token === socket.playerToken) {
        game.white.connected = false;
      } else if (game.black && game.black.token === socket.playerToken) {
        game.black.connected = false;
      }
      socket.to(socket.gameId).emit('opponent_left');
    }
    console.log('Getrennt:', socket.id);
  });
});

// Cleanup: remove games where both players disconnected for over 4 hours
setInterval(() => {
  const now = Date.now();
  for (const [id, game] of games) {
    const whiteOff = !game.white?.connected;
    const blackOff = !game.black?.connected;
    if (whiteOff && blackOff) {
      if (!game.cleanupAt) {
        game.cleanupAt = now + 4 * 60 * 60 * 1000;
      } else if (now > game.cleanupAt) {
        games.delete(id);
        console.log(`Spiel ${id} aufgeraeumt`);
      }
    } else {
      game.cleanupAt = null;
    }
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Schach-Server laeuft auf http://localhost:${PORT}`);
});
