const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const roomManager = require('./engines/room-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper: compiles and pushes a full room snapshot to all sockets in that room
function broadcastRoomState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  const { game, ledger } = room;
  const seatedPlayers = game.getSeatedPlayers();
  const playerIds = game.players.map(p => p.id);
  
  // Collect settlement calculations
  const summary = ledger.getSummary(playerIds);
  const balanceInfo = ledger.checkBalance(playerIds);
  const transfers = ledger.calculateTransfers(game.players);

  // Package a state update
  const snapshot = {
    roomCode: game.roomCode,
    hostId: game.hostId,
    status: game.status,
    players: game.players,
    seats: game.seats,
    handNumber: game.handNumber,
    handStatus: game.handStatus,
    dealerSeat: game.dealerSeat,
    sbSeat: game.sbSeat,
    bbSeat: game.bbSeat,
    currentTurnSeat: game.currentTurnSeat,
    smallBlindAmount: game.smallBlindAmount,
    bigBlindAmount: game.bigBlindAmount,
    currentBet: game.currentBet,
    lastRaiseAmount: game.lastRaiseAmount,
    roundBets: game.roundBets,
    totalHandBets: game.totalHandBets,
    pots: game.pots,
    refunds: game.refunds,
    actionHistory: game.actionHistory,
    ledger: {
      summary,
      balanceInfo,
      transfers
    }
  };

  io.to(roomCode).emit('room_state_updated', snapshot);
}

// Socket IO Event handlers
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  let currentRoomCode = null;
  let currentPlayerId = null;

  // Handle Room Creation
  socket.on('create_room', ({ playerName }, callback) => {
    try {
      currentPlayerId = socket.id;
      const room = roomManager.createRoom(currentPlayerId, playerName);
      currentRoomCode = room.roomCode;
      
      socket.join(currentRoomCode);
      
      callback({
        success: true,
        roomCode: currentRoomCode,
        playerId: currentPlayerId
      });
      
      broadcastRoomState(currentRoomCode);
    } catch (err) {
      console.error(err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Joining an existing room
  socket.on('join_room', ({ roomCode, playerName }, callback) => {
    try {
      const code = roomCode.trim().toUpperCase();
      const room = roomManager.getRoom(code);
      
      if (!room) {
        return callback({ success: false, error: "Room not found." });
      }

      currentPlayerId = socket.id;
      currentRoomCode = code;
      
      socket.join(currentRoomCode);
      room.game.addPlayer(currentPlayerId, playerName, false);
      
      callback({
        success: true,
        roomCode: currentRoomCode,
        playerId: currentPlayerId
      });
      
      broadcastRoomState(currentRoomCode);
    } catch (err) {
      console.error(err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Seating a player
  socket.on('sit_player', ({ seat }, callback) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    const success = room.game.sitPlayer(currentPlayerId, seat);
    if (success) {
      callback({ success: true });
      broadcastRoomState(currentRoomCode);
    } else {
      callback({ success: false, error: "Seat is already taken or invalid." });
    }
  });

  // Handle Unseating a player
  socket.on('unsit_player', (callback) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    const success = room.game.unsitPlayer(currentPlayerId);
    callback({ success });
    broadcastRoomState(currentRoomCode);
  });

  // Handle Buy-In/Rebuy
  socket.on('buy_in', ({ amount }, callback) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    const success = room.game.buyIn(currentPlayerId, amount, room.ledger);
    callback({ success });
    broadcastRoomState(currentRoomCode);
  });

  // Handle Start Hand
  socket.on('start_hand', (callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    // Only host can start
    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only the host can start a hand." });
    }

    const success = room.game.startHand();
    callback({ success });
    broadcastRoomState(currentRoomCode);
  });

  // Handle Player actions (Check, Call, Bet, Raise, Fold, All-In)
  socket.on('player_action', ({ actionType, amount }, callback) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    try {
      room.game.processAction(currentPlayerId, actionType, amount);
      callback({ success: true });
      broadcastRoomState(currentRoomCode);
    } catch (err) {
      console.error(err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle declaring hand winner
  socket.on('declare_winner', ({ winnersByPot }, callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    // Only host can declare winner
    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only the host can declare winners." });
    }

    try {
      room.game.declareWinner(winnersByPot, room.ledger);
      callback({ success: true });
      broadcastRoomState(currentRoomCode);
    } catch (err) {
      console.error(err);
      callback({ success: false, error: err.message });
    }
  });

  // Handle Undo Last Action (Host Only)
  socket.on('undo_action', (callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only the host can undo actions." });
    }

    const success = room.game.undo();
    callback({ success });
    broadcastRoomState(currentRoomCode);
  });

  // Handle Cancel Hand (Host Only)
  socket.on('cancel_hand', (callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only the host can cancel a hand." });
    }

    room.game.forceEndHand();
    callback({ success: true });
    broadcastRoomState(currentRoomCode);
  });

  // Handle cashing out
  socket.on('cash_out', ({ amount }, callback) => {
    if (!currentRoomCode || !currentPlayerId) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    room.ledger.cashOut(currentPlayerId, amount);
    
    // Clear seat stack if they cash out
    const seat = room.game.getPlayerSeatNumber(currentPlayerId);
    if (seat) {
      room.game.seats[seat].stack = 0;
    }
    
    callback({ success: true });
    broadcastRoomState(currentRoomCode);
  });

  // Handle transition to Settlement screen (Host Only)
  socket.on('go_to_settlement', (callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only the host can end the session." });
    }

    // Auto-cash out everyone with their current seat stacks if they haven't cashed out manually
    const seated = room.game.getSeatedPlayers();
    for (const p of seated) {
      if (room.ledger.getCashOut(p.id) === 0 && p.stack > 0) {
        room.ledger.cashOut(p.id, p.stack);
        p.stack = 0;
      }
    }

    room.game.status = 'SETTLEMENT';
    callback({ success: true });
    broadcastRoomState(currentRoomCode);
  });

  // Host simulates a player action (to allow single-window testing of game flow)
  socket.on('simulate_bot_action', ({ botPlayerId, actionType, amount }, callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    // Verify requesting socket is host
    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only host can trigger bot actions." });
    }

    try {
      room.game.processAction(botPlayerId, actionType, amount);
      callback({ success: true });
      broadcastRoomState(currentRoomCode);
    } catch (err) {
      console.error(err);
      callback({ success: false, error: err.message });
    }
  });

  // Host adds a virtual bot player (seats them automatically in a free seat)
  socket.on('add_bot_player', ({ botName, initialStack }, callback) => {
    if (!currentRoomCode) return;
    const room = roomManager.getRoom(currentRoomCode);
    if (!room) return;

    if (room.game.hostId !== currentPlayerId) {
      return callback({ success: false, error: "Only host can add bots." });
    }

    // Find first empty seat
    let freeSeat = null;
    for (let s = 1; s <= 8; s++) {
      if (!room.game.seats[s]) {
        freeSeat = s;
        break;
      }
    }

    if (!freeSeat) {
      return callback({ success: false, error: "No empty seats left." });
    }

    const botId = `bot_${Math.random().toString(36).substr(2, 9)}`;
    room.game.addPlayer(botId, botName, false);
    room.game.sitPlayer(botId, freeSeat);
    room.game.buyIn(botId, initialStack, room.ledger);

    callback({ success: true, botId });
    broadcastRoomState(currentRoomCode);
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (currentRoomCode && currentPlayerId) {
      roomManager.leaveRoom(currentRoomCode, currentPlayerId);
      broadcastRoomState(currentRoomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
