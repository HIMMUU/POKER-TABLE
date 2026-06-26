/**
 * Poker Game State Engine
 * Manages seats, blinds, turn order, betting actions, and round transitions.
 */

const { calculatePots } = require('./pot-calculator');

class GameState {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    
    // Status can be: 'LOBBY', 'PLAYING', 'SETTLEMENT'
    this.status = 'LOBBY';
    
    // Seat mapping: 1-indexed seats (1 to 8). Values are player objects.
    this.seats = {}; 
    this.players = []; // List of all players in room: { id, name, isHost, connected }
    
    // Hand State
    this.handNumber = 0;
    this.handStatus = 'WAITING'; // 'WAITING', 'PRE_FLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN', 'END_HAND'
    
    this.dealerSeat = null;
    this.sbSeat = null;
    this.bbSeat = null;
    this.currentTurnSeat = null;
    
    this.smallBlindAmount = 10;
    this.bigBlindAmount = 20;
    
    // Betting parameters
    this.currentBet = 0;       // The highest bet in the current round
    this.lastRaiseAmount = 0;  // The size of the last raise increment (for min-raise validation)
    this.roundBets = {};       // playerId -> chips bet in current round (reset each round)
    this.totalHandBets = {};   // playerId -> total chips bet in the entire hand (accumulates)
    this.hasActed = {};        // playerId -> boolean (reset each round)
    
    // Pots & Refunds
    this.pots = [];
    this.refunds = {};
    
    // Action history for log
    this.actionHistory = [];
    
    // Snapshot of previous states for Undo
    this.historyStack = [];
  }

  // Save state before modifying for undo support
  saveToHistory() {
    // Keep max 5 history entries
    if (this.historyStack.length >= 5) {
      this.historyStack.shift();
    }
    
    // Deep clone state properties
    const snapshot = {
      status: this.status,
      handStatus: this.handStatus,
      dealerSeat: this.dealerSeat,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      currentTurnSeat: this.currentTurnSeat,
      currentBet: this.currentBet,
      lastRaiseAmount: this.lastRaiseAmount,
      roundBets: { ...this.roundBets },
      totalHandBets: { ...this.totalHandBets },
      hasActed: { ...this.hasActed },
      pots: JSON.parse(JSON.stringify(this.pots)),
      refunds: { ...this.refunds },
      actionHistory: [...this.actionHistory],
      seats: {}
    };

    // Clone seats (preserving stack size)
    for (let s = 1; s <= 8; s++) {
      if (this.seats[s]) {
        snapshot.seats[s] = {
          id: this.seats[s].id,
          name: this.seats[s].name,
          stack: this.seats[s].stack,
          folded: this.seats[s].folded,
          allIn: this.seats[s].allIn
        };
      }
    }
    
    this.historyStack.push(snapshot);
  }

  undo() {
    if (this.historyStack.length === 0) return false;
    const snapshot = this.historyStack.pop();
    
    this.status = snapshot.status;
    this.handStatus = snapshot.handStatus;
    this.dealerSeat = snapshot.dealerSeat;
    this.sbSeat = snapshot.sbSeat;
    this.bbSeat = snapshot.bbSeat;
    this.currentTurnSeat = snapshot.currentTurnSeat;
    this.currentBet = snapshot.currentBet;
    this.lastRaiseAmount = snapshot.lastRaiseAmount;
    this.roundBets = snapshot.roundBets;
    this.totalHandBets = snapshot.totalHandBets;
    this.hasActed = snapshot.hasActed;
    this.pots = snapshot.pots;
    this.refunds = snapshot.refunds;
    this.actionHistory = snapshot.actionHistory;
    
    // Re-create seats
    this.seats = {};
    for (let s = 1; s <= 8; s++) {
      if (snapshot.seats[s]) {
        this.seats[s] = {
          id: snapshot.seats[s].id,
          name: snapshot.seats[s].name,
          stack: snapshot.seats[s].stack,
          folded: snapshot.seats[s].folded,
          allIn: snapshot.seats[s].allIn
        };
      }
    }
    
    return true;
  }

  addPlayer(id, name, isHost = false) {
    // If player already in game, update connection state
    const existing = this.players.find(p => p.id === id);
    if (existing) {
      existing.connected = true;
      existing.name = name;
      return existing;
    }
    
    const newPlayer = { id, name, isHost, connected: true };
    this.players.push(newPlayer);
    return newPlayer;
  }

  removePlayer(id) {
    const player = this.players.find(p => p.id === id);
    if (player) {
      player.connected = false;
    }
    
    // If we're in LOBBY, clean them out of seat
    if (this.status === 'LOBBY') {
      this.unsitPlayer(id);
      this.players = this.players.filter(p => p.id !== id);
    }
  }

  sitPlayer(id, seat) {
    if (seat < 1 || seat > 8) return false;
    if (this.seats[seat]) return false; // Seat occupied
    
    // Check if player is already seated elsewhere
    this.unsitPlayer(id);
    
    const player = this.players.find(p => p.id === id);
    if (!player) return false;
    
    this.seats[seat] = {
      id: player.id,
      name: player.name,
      stack: 0, // Initial stack is 0 until buy-in
      folded: false,
      allIn: false
    };
    return true;
  }

  unsitPlayer(id) {
    for (let s = 1; s <= 8; s++) {
      if (this.seats[s] && this.seats[s].id === id) {
        delete this.seats[s];
        return true;
      }
    }
    return false;
  }

  buyIn(playerId, amount, ledger) {
    const seat = this.getPlayerSeatNumber(playerId);
    if (!seat) return false;
    
    this.saveToHistory();
    
    ledger.addBuyIn(playerId, amount);
    this.seats[seat].stack += amount;
    this.actionHistory.push(`${this.seats[seat].name} bought in for ${amount}`);
    return true;
  }

  getPlayerSeatNumber(playerId) {
    for (let s = 1; s <= 8; s++) {
      if (this.seats[s] && this.seats[s].id === playerId) {
        return s;
      }
    }
    return null;
  }

  getSeatedPlayers() {
    const list = [];
    for (let s = 1; s <= 8; s++) {
      if (this.seats[s]) {
        list.push({ seat: s, ...this.seats[s] });
      }
    }
    return list;
  }

  getSeatedActivePlayers() {
    return this.getSeatedPlayers().filter(p => !p.folded);
  }

  startHand() {
    const seated = this.getSeatedPlayers();
    // Need at least 2 players with stacks > 0 to start
    const validPlayers = seated.filter(p => p.stack > 0);
    if (validPlayers.length < 2) return false;

    this.saveToHistory();
    
    this.status = 'PLAYING';
    this.handNumber++;
    this.handStatus = 'PRE_FLOP';
    
    // Reset player active flags
    for (let s = 1; s <= 8; s++) {
      if (this.seats[s]) {
        this.seats[s].folded = false;
        this.seats[s].allIn = false;
      }
    }
    
    // Determine Blinds / Button
    this.moveDealerButton();
    this.postBlinds();
    
    // Initialize betting vars
    this.currentBet = this.bigBlindAmount;
    this.lastRaiseAmount = this.bigBlindAmount;
    
    // Setup turn
    this.setInitialTurn();
    
    this.pots = [];
    this.refunds = {};
    this.actionHistory = [`Hand #${this.handNumber} started.`];
    
    return true;
  }

  moveDealerButton() {
    const seated = this.getSeatedPlayers().filter(p => p.stack > 0);
    
    if (this.dealerSeat === null) {
      // Pick first player
      this.dealerSeat = seated[0].seat;
    } else {
      // Find next player clockwise
      this.dealerSeat = this.getNextOccupiedSeat(this.dealerSeat, true);
    }
    
    // Blinds positions depend on player count
    if (seated.length === 2) {
      // Heads up: Dealer is Small Blind, other player is Big Blind
      this.sbSeat = this.dealerSeat;
      this.bbSeat = this.getNextOccupiedSeat(this.dealerSeat, true);
    } else {
      this.sbSeat = this.getNextOccupiedSeat(this.dealerSeat, true);
      this.bbSeat = this.getNextOccupiedSeat(this.sbSeat, true);
    }
  }

  getNextOccupiedSeat(currentSeat, skipEmptyStack = true) {
    let seat = currentSeat;
    for (let i = 0; i < 8; i++) {
      seat = (seat % 8) + 1;
      if (this.seats[seat]) {
        if (!skipEmptyStack || this.seats[seat].stack > 0) {
          return seat;
        }
      }
    }
    return currentSeat;
  }

  postBlinds() {
    this.roundBets = {};
    this.totalHandBets = {};
    this.hasActed = {};
    
    const sbPlayer = this.seats[this.sbSeat];
    const bbPlayer = this.seats[this.bbSeat];
    
    // Post Small Blind
    const sbPost = Math.min(sbPlayer.stack, this.smallBlindAmount);
    sbPlayer.stack -= sbPost;
    this.roundBets[sbPlayer.id] = sbPost;
    this.totalHandBets[sbPlayer.id] = sbPost;
    if (sbPlayer.stack === 0) sbPlayer.allIn = true;
    
    // Post Big Blind
    const bbPost = Math.min(bbPlayer.stack, this.bigBlindAmount);
    bbPlayer.stack -= bbPost;
    this.roundBets[bbPlayer.id] = bbPost;
    this.totalHandBets[bbPlayer.id] = bbPost;
    if (bbPlayer.stack === 0) bbPlayer.allIn = true;
  }

  setInitialTurn() {
    const seated = this.getSeatedPlayers();
    if (seated.filter(p => p.stack > 0).length === 2) {
      // Heads up: Pre-flop dealer (SB) acts first. Post-flop, BB acts first.
      this.currentTurnSeat = this.handStatus === 'PRE_FLOP' ? this.sbSeat : this.bbSeat;
    } else {
      // 3+ players: Pre-flop UTG (seat after BB) acts first. Post-flop, SB acts first.
      this.currentTurnSeat = this.handStatus === 'PRE_FLOP' 
        ? this.getNextOccupiedSeat(this.bbSeat) 
        : this.getNextOccupiedSeat(this.dealerSeat);
    }
    
    // If the selected player is already folded or all-in, skip them
    const active = this.seats[this.currentTurnSeat];
    if (active.folded || active.allIn) {
      this.advanceTurn();
    }
  }

  processAction(playerId, actionType, amount = 0) {
    const turnSeat = this.currentTurnSeat;
    const player = this.seats[turnSeat];
    
    if (!player || player.id !== playerId) {
      throw new Error("Not your turn");
    }
    
    this.saveToHistory();
    
    const playerCurrentBet = this.roundBets[player.id] || 0;
    const callAmount = this.currentBet - playerCurrentBet;
    
    let actionLabel = "";
    
    switch (actionType.toUpperCase()) {
      case 'FOLD':
        player.folded = true;
        actionLabel = `${player.name} folded`;
        break;
        
      case 'CHECK':
        if (callAmount > 0) {
          throw new Error("Cannot check, bet has been made. Must Call, Raise, or Fold.");
        }
        actionLabel = `${player.name} checked`;
        break;
        
      case 'CALL': {
        const toDeduct = Math.min(player.stack, callAmount);
        player.stack -= toDeduct;
        
        this.roundBets[player.id] = playerCurrentBet + toDeduct;
        this.totalHandBets[player.id] = (this.totalHandBets[player.id] || 0) + toDeduct;
        
        if (player.stack === 0) {
          player.allIn = true;
          actionLabel = `${player.name} called all-in (${this.roundBets[player.id]})`;
        } else {
          actionLabel = `${player.name} called (${this.roundBets[player.id]})`;
        }
        break;
      }
      
      case 'BET': {
        if (this.currentBet > 0) {
          throw new Error("Bet already made. Use Raise instead.");
        }
        if (amount < this.bigBlindAmount) {
          throw new Error(`Bet must be at least the Big Blind (${this.bigBlindAmount})`);
        }
        if (amount > player.stack) {
          throw new Error("Bet exceeds stack. Go All-In instead.");
        }
        
        player.stack -= amount;
        this.roundBets[player.id] = amount;
        this.totalHandBets[player.id] = (this.totalHandBets[player.id] || 0) + amount;
        this.currentBet = amount;
        this.lastRaiseAmount = amount; // Initial bet acts as raise increment
        
        if (player.stack === 0) {
          player.allIn = true;
          actionLabel = `${player.name} bet all-in (${amount})`;
        } else {
          actionLabel = `${player.name} bet ${amount}`;
        }
        break;
      }
      
      case 'RAISE': {
        // Amount represents the target total bet for the player in this round
        const minRaiseTarget = this.currentBet + this.lastRaiseAmount;
        const playerCurrentBet = this.roundBets[player.id] || 0;
        const additionalNeeded = amount - playerCurrentBet;
        
        if (amount < minRaiseTarget && amount < (playerCurrentBet + player.stack)) {
          throw new Error(`Raise must be to at least ${minRaiseTarget}`);
        }
        if (additionalNeeded > player.stack) {
          throw new Error("Raise exceeds stack.");
        }
        
        const raiseIncrement = amount - this.currentBet;
        
        player.stack -= additionalNeeded;
        this.roundBets[player.id] = amount;
        this.totalHandBets[player.id] = (this.totalHandBets[player.id] || 0) + additionalNeeded;
        
        this.currentBet = amount;
        if (raiseIncrement > 0) {
          this.lastRaiseAmount = raiseIncrement;
        }
        
        if (player.stack === 0) {
          player.allIn = true;
          actionLabel = `${player.name} raised all-in to ${amount}`;
        } else {
          actionLabel = `${player.name} raised to ${amount}`;
        }
        break;
      }
      
      case 'ALL-IN': {
        const totalBet = playerCurrentBet + player.stack;
        const allInAmount = player.stack;
        player.stack = 0;
        player.allIn = true;
        
        this.roundBets[player.id] = totalBet;
        this.totalHandBets[player.id] = (this.totalHandBets[player.id] || 0) + allInAmount;
        
        const raiseIncrement = totalBet - this.currentBet;
        
        if (totalBet > this.currentBet) {
          this.currentBet = totalBet;
          if (raiseIncrement > 0) {
            this.lastRaiseAmount = raiseIncrement;
          }
        }
        
        actionLabel = `${player.name} went All-in for ${totalBet}`;
        break;
      }
      
      default:
        throw new Error("Unknown action type");
    }
    
    this.hasActed[player.id] = true;
    this.actionHistory.push(actionLabel);
    
    this.advanceTurn();
  }

  advanceTurn() {
    const seated = this.getSeatedPlayers();
    const activeNonFolded = seated.filter(p => !p.folded);
    
    // Check if hand is won because everyone else folded
    if (activeNonFolded.length === 1) {
      this.collectRoundBets();
      this.handStatus = 'END_HAND';
      this.currentTurnSeat = null;
      this.actionHistory.push(`${activeNonFolded[0].name} wins the pot (all other players folded).`);
      return;
    }
    
    // Check if the current betting round is over.
    // Over when all active non-folded players have acted and checked/matched the current bet (or are all-in).
    const bettingRoundOver = activeNonFolded.every(p => {
      const isMatched = (this.roundBets[p.id] || 0) === this.currentBet;
      return p.allIn || (this.hasActed[p.id] && isMatched);
    });

    if (bettingRoundOver) {
      this.collectRoundBets();
      this.advanceRound();
    } else {
      // Find next player to act
      let nextSeat = this.currentTurnSeat;
      let iterations = 0;
      while (iterations < 8) {
        nextSeat = (nextSeat % 8) + 1;
        if (this.seats[nextSeat]) {
          const p = this.seats[nextSeat];
          if (!p.folded && !p.allIn) {
            this.currentTurnSeat = nextSeat;
            return;
          }
        }
        iterations++;
      }
      
      // If we cannot find anyone who can act, the round must be complete
      this.collectRoundBets();
      this.advanceRound();
    }
  }

  collectRoundBets() {
    // Collect all round bets into total hand bets
    for (const pid in this.roundBets) {
      this.totalHandBets[pid] = (this.totalHandBets[pid] || 0);
    }
    this.roundBets = {};
    
    // Calculate pots dynamically using totalHandBets
    const calc = calculatePots(
      this.getSeatedPlayers().map(p => ({ id: p.id, folded: p.folded })),
      this.totalHandBets
    );
    this.pots = calc.pots;
    this.refunds = calc.refunds;
  }

  advanceRound() {
    // Reset round-specific variables
    this.currentBet = 0;
    this.lastRaiseAmount = this.bigBlindAmount;
    this.hasActed = {};
    
    const seated = this.getSeatedPlayers();
    const activeNonFolded = seated.filter(p => !p.folded);
    const activePlayersWithChips = activeNonFolded.filter(p => p.stack > 0);
    
    // If fewer than 2 active players have chips left (e.g. all-ins), no more betting rounds can be played.
    // Skip directly to showdown.
    if (activePlayersWithChips.length < 2) {
      this.handStatus = 'SHOWDOWN';
      this.currentTurnSeat = null;
      this.actionHistory.push("All-in check completed. Heading directly to Showdown.");
      return;
    }

    switch (this.handStatus) {
      case 'PRE_FLOP':
        this.handStatus = 'FLOP';
        this.setInitialTurn();
        this.actionHistory.push("--- FLOP ---");
        break;
      case 'FLOP':
        this.handStatus = 'TURN';
        this.setInitialTurn();
        this.actionHistory.push("--- TURN ---");
        break;
      case 'TURN':
        this.handStatus = 'RIVER';
        this.setInitialTurn();
        this.actionHistory.push("--- RIVER ---");
        break;
      case 'RIVER':
        this.handStatus = 'SHOWDOWN';
        this.currentTurnSeat = null;
        this.actionHistory.push("--- SHOWDOWN ---");
        break;
      default:
        break;
    }
  }

  declareWinner(winnersByPot, ledger) {
    if (this.handStatus !== 'SHOWDOWN' && this.handStatus !== 'END_HAND') {
      throw new Error("Cannot declare winner outside of Showdown or End Hand");
    }

    this.saveToHistory();
    
    // Process refunds first
    for (const pid in this.refunds) {
      const refundAmt = this.refunds[pid];
      if (refundAmt > 0) {
        const seat = this.getPlayerSeatNumber(pid);
        if (seat) {
          this.seats[seat].stack += refundAmt;
          this.actionHistory.push(`Refunded ${refundAmt} to ${this.seats[seat].name}`);
        }
      }
    }
    
    // Process winner distribution for each pot
    // If winnersByPot is a simple player id string (like when everyone else folded)
    if (typeof winnersByPot === 'string') {
      // All pots go to this player
      const winnerId = winnersByPot;
      const seat = this.getPlayerSeatNumber(winnerId);
      if (seat) {
        let totalWon = 0;
        for (const pot of this.pots) {
          totalWon += pot.amount;
        }
        this.seats[seat].stack += totalWon;
        this.actionHistory.push(`${this.seats[seat].name} won all pots: ${totalWon}`);
      }
    } else {
      // Map of potId -> Array of playerIds
      for (const pot of this.pots) {
        const winners = winnersByPot[pot.id] || [];
        if (winners.length === 0) {
          // If no winner specified for a pot, default to first eligible player
          winners.push(pot.eligiblePlayers[0]);
        }
        
        const potShare = Math.floor(pot.amount / winners.length);
        const oddChips = pot.amount % winners.length;
        
        winners.forEach((wid, idx) => {
          const seat = this.getPlayerSeatNumber(wid);
          if (seat) {
            let winAmt = potShare;
            // First player gets the odd chip if split pot has remainder
            if (idx === 0) {
              winAmt += oddChips;
            }
            this.seats[seat].stack += winAmt;
            this.actionHistory.push(`${this.seats[seat].name} won ${pot.label}: ${winAmt}`);
          }
        });
      }
    }
    
    // Complete hand state
    this.handStatus = 'WAITING';
    this.pots = [];
    this.refunds = {};
    this.totalHandBets = {};
    this.roundBets = {};
    this.currentTurnSeat = null;
    
    // If we're not playing anymore (e.g. host manually pauses/stops or people want to cash out), 
    // we can transition status back to LOBBY
    this.status = 'LOBBY';
  }

  forceEndHand() {
    this.saveToHistory();
    this.handStatus = 'WAITING';
    this.pots = [];
    this.refunds = {};
    this.totalHandBets = {};
    this.roundBets = {};
    this.currentTurnSeat = null;
    this.status = 'LOBBY';
    this.actionHistory.push("Hand cancelled by Host.");
  }
}

module.exports = GameState;
