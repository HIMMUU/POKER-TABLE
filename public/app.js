/**
 * Poker Pot Tracker — Frontend Logic
 * Implements real-time rendering, event emitters, and simulation tools.
 */

const socket = io();

// Application State
let roomState = null;
let playerId = null;
let selectedWinners = {}; // potId -> Array of playerIds

// UI Cache
const screens = {
  landing: document.getElementById('landing-screen'),
  game: document.getElementById('game-screen'),
  settlement: document.getElementById('settlement-screen')
};

const badgeCode = document.getElementById('badge-code');
const roomBadge = document.getElementById('room-badge');

// ==========================================
// 1. INITIALIZATION & SOCKET EVENT LISTENERS
// ==========================================

socket.on('connect', () => {
  console.log('Connected to socket server. ID:', socket.id);
  playerId = socket.id;
});

socket.on('room_state_updated', (newState) => {
  console.log('Room State Updated:', newState);
  roomState = newState;
  renderState();
});

// ==========================================
// 2. LANDING / LOBBY EVENTS
// ==========================================

document.getElementById('btn-create-room').addEventListener('click', () => {
  const hostName = document.getElementById('host-name-input').value.trim();
  if (!hostName) return alert("Please enter a player name.");

  socket.emit('create_room', { playerName: hostName }, (res) => {
    if (res.success) {
      playerId = res.playerId;
      console.log('Room created:', res.roomCode);
    } else {
      alert("Failed to create room: " + res.error);
    }
  });
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const roomCode = document.getElementById('join-code-input').value.trim().toUpperCase();
  const playerName = document.getElementById('player-name-input').value.trim();

  if (!roomCode) return alert("Please enter a room code.");
  if (!playerName) return alert("Please enter your name.");

  socket.emit('join_room', { roomCode, playerName }, (res) => {
    if (res.success) {
      playerId = res.playerId;
      console.log('Room joined:', res.roomCode);
    } else {
      alert("Failed to join room: " + res.error);
    }
  });
});

// ==========================================
// 3. SEATING & BUY-IN PANEL EVENTS
// ==========================================

function sitDown(seat) {
  socket.emit('sit_player', { seat }, (res) => {
    if (!res.success) {
      alert(res.error);
    }
  });
}

document.getElementById('btn-stand-up').addEventListener('click', () => {
  socket.emit('unsit_player', (res) => {
    if (!res.success) console.log("Failed to stand up");
  });
});

document.getElementById('btn-submit-buyin').addEventListener('click', () => {
  const amt = parseInt(document.getElementById('buy-in-amount').value, 10);
  if (isNaN(amt) || amt <= 0) return alert("Enter a valid buy-in amount.");
  
  socket.emit('buy_in', { amount: amt }, (res) => {
    if (!res.success) alert("Buy-in failed");
  });
});

// ==========================================
// 4. GAMEPLAY ACTION PANEL EVENTS
// ==========================================

const btnFold = document.getElementById('btn-fold');
const btnCheckCall = document.getElementById('btn-check-call');
const btnBetRaise = document.getElementById('btn-bet-raise');
const btnAllIn = document.getElementById('btn-all-in');

const raiseSlider = document.getElementById('raise-range-slider');
const raiseInput = document.getElementById('raise-number-input');
const raiseContainer = document.getElementById('raise-slider-container');
const raiseCurrentDisplay = document.getElementById('raise-current-display');

let isRaiseActive = false;

// Double binding for slider and number box
raiseSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  raiseInput.value = val;
  updateRaiseDisplay(val);
});

raiseInput.addEventListener('input', (e) => {
  let val = parseInt(e.target.value, 10);
  if (isNaN(val)) val = parseInt(raiseSlider.min, 10);
  raiseSlider.value = val;
  updateRaiseDisplay(val);
});

function updateRaiseDisplay(val) {
  const mySeatNum = getMySeatNumber();
  const player = roomState.seats[mySeatNum];
  const roundBet = roomState.roundBets[player.id] || 0;
  const increment = val - roomState.currentBet;
  
  if (roomState.currentBet === 0) {
    raiseCurrentDisplay.textContent = `Bet amount: ${val}`;
  } else {
    raiseCurrentDisplay.textContent = `Raise to: ${val} (adds +${val - roundBet})`;
  }
}

btnFold.addEventListener('click', () => submitAction('FOLD'));

btnCheckCall.addEventListener('click', () => {
  const mySeatNum = getMySeatNumber();
  const player = roomState.seats[mySeatNum];
  const currentRoundBet = roomState.roundBets[player.id] || 0;
  const callAmt = roomState.currentBet - currentRoundBet;
  
  if (callAmt === 0) {
    submitAction('CHECK');
  } else {
    submitAction('CALL');
  }
});

btnBetRaise.addEventListener('click', () => {
  if (!isRaiseActive) {
    // Show raise slider controls
    isRaiseActive = true;
    raiseContainer.classList.remove('hidden');
    
    // Configure slider
    const mySeatNum = getMySeatNumber();
    const player = roomState.seats[mySeatNum];
    const roundBet = roomState.roundBets[player.id] || 0;
    
    if (roomState.currentBet === 0) {
      // Placing a Bet
      const minBet = roomState.bigBlindAmount;
      const maxBet = player.stack;
      
      raiseSlider.min = minBet;
      raiseSlider.max = maxBet;
      raiseSlider.value = minBet;
      raiseInput.value = minBet;
      
      document.getElementById('raise-min-val').textContent = minBet;
      document.getElementById('raise-max-val').textContent = maxBet;
      updateRaiseDisplay(minBet);
    } else {
      // Placing a Raise
      const minRaiseTarget = roomState.currentBet + roomState.lastRaiseAmount;
      const maxRaiseTarget = player.stack + roundBet; // maximum they can put in
      
      raiseSlider.min = minRaiseTarget;
      raiseSlider.max = maxRaiseTarget;
      raiseSlider.value = minRaiseTarget;
      raiseInput.value = minRaiseTarget;
      
      document.getElementById('raise-min-val').textContent = minRaiseTarget;
      document.getElementById('raise-max-val').textContent = maxRaiseTarget;
      updateRaiseDisplay(minRaiseTarget);
    }
  } else {
    // Actually submit the Bet/Raise action
    const amount = parseInt(raiseInput.value, 10);
    const action = roomState.currentBet === 0 ? 'BET' : 'RAISE';
    submitAction(action, amount);
    isRaiseActive = false;
    raiseContainer.classList.add('hidden');
  }
});

btnAllIn.addEventListener('click', () => submitAction('ALL-IN'));

function submitAction(actionType, amount = 0) {
  socket.emit('player_action', { actionType, amount }, (res) => {
    if (!res.success) {
      alert("Invalid action: " + res.error);
    }
  });
}

// ==========================================
// 5. HOST CONTROL ACTIONS
// ==========================================

document.getElementById('btn-host-deal').addEventListener('click', () => {
  socket.emit('start_hand', (res) => {
    if (!res.success) alert(res.error);
  });
});

document.getElementById('btn-host-undo').addEventListener('click', () => {
  socket.emit('undo_action', (res) => {
    if (!res.success) alert("Nothing to undo.");
  });
});

document.getElementById('btn-host-cancel').addEventListener('click', () => {
  if (confirm("Are you sure you want to cancel the current hand? Bets will be lost.")) {
    socket.emit('cancel_hand');
  }
});

document.getElementById('btn-host-end-session').addEventListener('click', () => {
  if (confirm("End hand and proceed to settle the game session?")) {
    socket.emit('go_to_settlement');
  }
});

document.getElementById('btn-host-add-bot').addEventListener('click', () => {
  const name = prompt("Enter Virtual Bot Name:", `Bot ${Math.floor(Math.random() * 90) + 10}`);
  if (!name) return;
  const stackStr = prompt("Enter Initial Chip Stack:", "1000");
  const stack = parseInt(stackStr, 10);
  if (isNaN(stack) || stack <= 0) return alert("Enter a valid chip stack");

  socket.emit('add_bot_player', { botName: name, initialStack: stack }, (res) => {
    if (!res.success) alert(res.error);
  });
});

// ==========================================
// 6. BOT VIRTUAL SIMULATION CONTROLS
// ==========================================

const botSimControls = document.getElementById('bot-simulation-controls');
const simBotName = document.getElementById('sim-bot-name');
const btnSimFold = document.getElementById('btn-sim-fold');
const btnSimCheckCall = document.getElementById('btn-sim-check-call');
const btnSimRaise = document.getElementById('btn-sim-raise');
const btnSimAllIn = document.getElementById('btn-sim-all-in');
const inputSimRaiseAmt = document.getElementById('sim-raise-amt');

btnSimFold.addEventListener('click', () => submitSimBotAction('FOLD'));
btnSimCheckCall.addEventListener('click', () => {
  // Determine if bot has to Call or Check
  const activeSeat = roomState.currentTurnSeat;
  const botPlayer = roomState.seats[activeSeat];
  const botRoundBet = roomState.roundBets[botPlayer.id] || 0;
  const callAmt = roomState.currentBet - botRoundBet;
  const action = callAmt === 0 ? 'CHECK' : 'CALL';
  submitSimBotAction(action);
});
btnSimRaise.addEventListener('click', () => {
  const val = parseInt(inputSimRaiseAmt.value, 10);
  if (isNaN(val) || val <= 0) return alert("Enter raise amount");
  const action = roomState.currentBet === 0 ? 'BET' : 'RAISE';
  submitSimBotAction(action, val);
});
btnSimAllIn.addEventListener('click', () => submitSimBotAction('ALL-IN'));

function submitSimBotAction(actionType, amount = 0) {
  const activeSeat = roomState.currentTurnSeat;
  const botPlayer = roomState.seats[activeSeat];
  if (!botPlayer || !botPlayer.id.startsWith('bot_')) return;
  
  socket.emit('simulate_bot_action', {
    botPlayerId: botPlayer.id,
    actionType,
    amount
  }, (res) => {
    if (!res.success) alert(res.error);
    else inputSimRaiseAmt.value = "";
  });
}

// ==========================================
// 7. STATE RENDER CONSOLE
// ==========================================

function getMySeatNumber() {
  if (!roomState) return null;
  for (let s = 1; s <= 8; s++) {
    if (roomState.seats[s] && roomState.seats[s].id === playerId) {
      return s;
    }
  }
  return null;
}

function renderState() {
  if (!roomState) return;

  const isHost = roomState.hostId === playerId;

  // Toggle Screen visibility
  if (roomState.status === 'LOBBY' || roomState.status === 'PLAYING') {
    screens.landing.classList.add('hidden');
    screens.game.classList.remove('hidden');
    screens.settlement.classList.add('hidden');
    roomBadge.classList.remove('hidden');
    badgeCode.textContent = roomState.roomCode;
  } else if (roomState.status === 'SETTLEMENT') {
    screens.landing.classList.add('hidden');
    screens.game.classList.add('hidden');
    screens.settlement.classList.remove('hidden');
    roomBadge.classList.remove('hidden');
    badgeCode.textContent = roomState.roomCode;
    renderSettlement();
    return;
  }

  // Update game action pills
  document.getElementById('pill-blinds').textContent = `${roomState.smallBlindAmount} / ${roomState.bigBlindAmount}`;
  document.getElementById('pill-hand-number').textContent = `#${roomState.handNumber}`;
  document.getElementById('pill-hand-status').textContent = roomState.handStatus;

  // Render Host Panel Elements
  const hostActionPanel = document.getElementById('host-action-buttons');
  const hostDeckPanel = document.getElementById('host-deck-panel');
  if (isHost) {
    hostActionPanel.classList.remove('hidden');
    hostDeckPanel.classList.remove('hidden');
    
    // Toggle host buttons
    document.getElementById('btn-host-deal').disabled = roomState.handStatus !== 'WAITING';
    document.getElementById('btn-host-undo').disabled = roomState.handStatus === 'WAITING';
    document.getElementById('btn-host-cancel').disabled = roomState.handStatus === 'WAITING';
  } else {
    hostActionPanel.classList.add('hidden');
    hostDeckPanel.classList.add('hidden');
  }

  // Calculate and Render Pot Sizes
  let totalPotVal = 0;
  for (const pot of roomState.pots) {
    totalPotVal += pot.amount;
  }
  // Add active round bets to the display pot value for visual updates during rounds
  for (const pid in roomState.roundBets) {
    totalPotVal += roomState.roundBets[pid];
  }
  document.getElementById('total-pot-amount').textContent = totalPotVal;

  // Render Side Pots list
  const sidePotsContainer = document.getElementById('side-pots-container');
  sidePotsContainer.innerHTML = "";
  if (roomState.pots.length > 1) {
    // Sort so Side Pot 1 is first
    const sortedPots = [...roomState.pots];
    sortedPots.forEach(pot => {
      const el = document.createElement('div');
      el.className = 'side-pot-entry';
      el.innerHTML = `${pot.label}: <strong>${pot.amount}</strong>`;
      sidePotsContainer.appendChild(el);
    });
  }

  // Seating & Felt rendering
  for (let s = 1; s <= 8; s++) {
    const seatSlot = document.getElementById(`seat-${s}`);
    seatSlot.innerHTML = "";
    
    const player = roomState.seats[s];
    if (player) {
      // Seat is occupied
      const isMe = player.id === playerId;
      const isTurn = roomState.currentTurnSeat === s;
      
      const card = document.createElement('div');
      card.className = `player-card ${isTurn ? 'active-turn' : ''} ${player.folded ? 'folded' : ''} ${player.allIn ? 'all-in' : ''}`;
      
      // Determine role letter
      let roleLetter = '';
      let roleClass = '';
      if (roomState.dealerSeat === s) { roleLetter = 'D'; roleClass = 'dealer'; }
      else if (roomState.sbSeat === s) { roleLetter = 'S'; roleClass = 'sb'; }
      else if (roomState.bbSeat === s) { roleLetter = 'B'; roleClass = 'bb'; }
      
      if (roleLetter) {
        const badge = document.createElement('div');
        badge.className = `role-badge ${roleClass}`;
        badge.textContent = roleLetter;
        card.appendChild(badge);
      }

      // Name & Stack display
      const nameEl = document.createElement('div');
      nameEl.className = 'player-name';
      nameEl.textContent = player.name + (isMe ? " (You)" : "");
      card.appendChild(nameEl);

      const stackEl = document.createElement('div');
      stackEl.className = 'player-stack';
      stackEl.textContent = player.stack;
      card.appendChild(stackEl);

      // Status tags
      if (player.allIn) {
        const statusTag = document.createElement('span');
        statusTag.className = 'status-badge all-in';
        statusTag.textContent = 'All-in';
        card.appendChild(statusTag);
      } else if (player.folded) {
        const statusTag = document.createElement('span');
        statusTag.className = 'status-badge folded';
        statusTag.textContent = 'Folded';
        card.appendChild(statusTag);
      }

      seatSlot.appendChild(card);

      // Floating Chip Bet display
      const betVal = roomState.roundBets[player.id] || 0;
      if (betVal > 0) {
        const chip = document.createElement('div');
        chip.className = 'floating-bet';
        chip.textContent = ` Bet: ${betVal}`;
        seatSlot.appendChild(chip);
      }
    } else {
      // Seat is empty
      const emptyBtn = document.createElement('div');
      emptyBtn.className = 'empty-seat';
      emptyBtn.textContent = 'Empty Seat';
      emptyBtn.addEventListener('click', () => sitDown(s));
      seatSlot.appendChild(emptyBtn);
    }
  }

  // Active Player Turn controls rendering
  const mySeat = getMySeatNumber();
  const unseatedBanner = document.getElementById('unseated-banner');
  const buyInBanner = document.getElementById('buy-in-banner');
  const turnControls = document.getElementById('turn-controls');
  const waitingBanner = document.getElementById('waiting-banner');
  const waitingMessage = document.getElementById('waiting-message');

  // Clear visibility
  unseatedBanner.classList.add('hidden');
  buyInBanner.classList.add('hidden');
  turnControls.classList.add('hidden');
  waitingBanner.classList.add('hidden');

  if (mySeat === null) {
    // Player not seated
    unseatedBanner.classList.remove('hidden');
  } else {
    // Player is seated
    const me = roomState.seats[mySeat];
    const myBuyins = roomState.ledger.summary[me.id] ? roomState.ledger.summary[me.id].totalBuyIns : 0;
    
    if (me.stack === 0 && myBuyins === 0 && roomState.handStatus === 'WAITING') {
      // Needs initial buy-in
      buyInBanner.classList.remove('hidden');
    } else {
      // Seated and has buy-in
      const isMyTurn = roomState.currentTurnSeat === mySeat;
      
      if (isMyTurn && roomState.handStatus !== 'SHOWDOWN' && roomState.handStatus !== 'END_HAND') {
        // Show actual turn controls
        turnControls.classList.remove('hidden');
        
        // Dynamic Call Button label
        const myRoundBet = roomState.roundBets[me.id] || 0;
        const callAmt = roomState.currentBet - myRoundBet;
        
        if (callAmt === 0) {
          btnCheckCall.textContent = "CHECK";
          btnCheckCall.className = "btn-action btn-call";
        } else {
          // If callAmt is more than stack, they must go all-in instead.
          const actualCall = Math.min(me.stack, callAmt);
          btnCheckCall.textContent = `CALL (${actualCall})`;
        }

        // Configure Bet/Raise limits
        if (roomState.currentBet === 0) {
          btnBetRaise.textContent = "BET";
          // Disable if stack is below min bet
          btnBetRaise.disabled = me.stack < roomState.bigBlindAmount;
        } else {
          btnBetRaise.textContent = "RAISE";
          const minRaise = roomState.currentBet + roomState.lastRaiseAmount;
          // Disable if stack + current round bet is less than min raise target
          btnBetRaise.disabled = (me.stack + myRoundBet) < minRaise;
        }
      } else {
        // Seated but waiting
        waitingBanner.classList.remove('hidden');
        if (roomState.handStatus === 'WAITING') {
          waitingMessage.textContent = "Waiting for Host to start the next hand...";
        } else if (roomState.handStatus === 'SHOWDOWN' || roomState.handStatus === 'END_HAND') {
          waitingMessage.textContent = "Showdown! Waiting for Host to declare the winners...";
        } else {
          // Find active player name
          const activeSeatNum = roomState.currentTurnSeat;
          const activePlayer = roomState.seats[activeSeatNum];
          waitingMessage.textContent = `Waiting for ${activePlayer ? activePlayer.name : 'player'} to act...`;
        }
      }
    }
  }

  // Virtual Bot simulation overlay for host
  const activeSeatNum = roomState.currentTurnSeat;
  const activePlayer = activeSeatNum ? roomState.seats[activeSeatNum] : null;
  
  if (isHost && activePlayer && activePlayer.id.startsWith('bot_') && roomState.handStatus !== 'SHOWDOWN' && roomState.handStatus !== 'END_HAND') {
    botSimControls.classList.remove('hidden');
    simBotName.textContent = activePlayer.name;
    
    // Auto-fill minimum raise in simulation panel
    const botRoundBet = roomState.roundBets[activePlayer.id] || 0;
    const minRaise = roomState.currentBet === 0 ? roomState.bigBlindAmount : (roomState.currentBet + roomState.lastRaiseAmount);
    inputSimRaiseAmt.placeholder = `Min ${minRaise}`;
  } else {
    botSimControls.classList.add('hidden');
  }

  // Render Log action records
  const actionHistoryLog = document.getElementById('action-history-log');
  actionHistoryLog.innerHTML = "";
  roomState.actionHistory.forEach((log) => {
    const el = document.createElement('div');
    if (log.startsWith('---')) {
      el.className = 'log-entry round';
      el.textContent = log;
    } else if (log.includes('started') || log.includes('cancelled') || log.includes('refunded')) {
      el.className = 'log-entry system';
      el.textContent = log;
    } else {
      el.className = 'log-entry action';
      el.textContent = log;
    }
    actionHistoryLog.appendChild(el);
  });
  actionHistoryLog.scrollTop = actionHistoryLog.scrollHeight; // Auto-scroll to bottom

  // Side list stack update
  const seatedPlayersStatusList = document.getElementById('seated-players-status-list');
  seatedPlayersStatusList.innerHTML = "";
  
  const seatedList = roomState.players;
  seatedList.forEach(p => {
    // Find stack if seated
    let stackVal = "Spectating";
    let isSeated = false;
    for (let s = 1; s <= 8; s++) {
      if (roomState.seats[s] && roomState.seats[s].id === p.id) {
        stackVal = `Chips: <strong>${roomState.seats[s].stack}</strong>`;
        isSeated = true;
        break;
      }
    }

    const totalBuy = roomState.ledger.summary[p.id] ? roomState.ledger.summary[p.id].totalBuyIns : 0;

    const row = document.createElement('div');
    row.className = 'status-row';
    row.innerHTML = `<span class="status-row-name">${p.name}</span>
                     <span class="status-row-vals">${stackVal} (Buy-in: ${totalBuy})</span>`;
    
    seatedPlayersStatusList.appendChild(row);
  });

  // Modal checks: Winner modal popup
  const winnerModal = document.getElementById('winner-modal');
  if (isHost && (roomState.handStatus === 'SHOWDOWN' || roomState.handStatus === 'END_HAND')) {
    winnerModal.classList.remove('hidden');
    renderWinnerModalOptions();
  } else {
    winnerModal.classList.add('hidden');
  }
}

// ==========================================
// 8. WINNER MODAL OPTIONS RENDER
// ==========================================

function renderWinnerModalOptions() {
  const container = document.getElementById('modal-pots-container');
  container.innerHTML = "";
  selectedWinners = {};

  if (roomState.pots.length === 0) {
    container.innerHTML = "<p>No pots formed. Hand might have been cancelled.</p>";
    return;
  }

  roomState.pots.forEach((pot) => {
    selectedWinners[pot.id] = [];

    const row = document.createElement('div');
    row.className = 'modal-pot-row';
    
    const header = document.createElement('div');
    header.className = 'modal-pot-title';
    header.innerHTML = `<span>${pot.label}</span> <span>${pot.amount} chips</span>`;
    row.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'modal-winners-grid';

    // List all eligible players
    pot.eligiblePlayers.forEach((pid) => {
      // Find player name
      let name = "Unknown";
      for (let s = 1; s <= 8; s++) {
        if (roomState.seats[s] && roomState.seats[s].id === pid) {
          name = roomState.seats[s].name;
          break;
        }
      }

      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.innerHTML = `<input type="checkbox" data-pot="${pot.id}" data-player="${pid}"> ${name}`;
      
      // Handle checkbox change
      label.querySelector('input').addEventListener('change', (e) => {
        const potId = e.target.getAttribute('data-pot');
        const pId = e.target.getAttribute('data-player');
        
        if (e.target.checked) {
          selectedWinners[potId].push(pId);
        } else {
          selectedWinners[potId] = selectedWinners[potId].filter(id => id !== pId);
        }
      });

      grid.appendChild(label);
    });

    row.appendChild(grid);
    container.appendChild(row);
  });
}

document.getElementById('btn-submit-winners').addEventListener('click', () => {
  // Verify that at least one winner is checked for each pot
  for (const potId in selectedWinners) {
    if (selectedWinners[potId].length === 0) {
      alert("Please select at least one winner for each pot before submitting.");
      return;
    }
  }

  socket.emit('declare_winner', { winnersByPot: selectedWinners }, (res) => {
    if (res.success) {
      console.log('Winners declared successfully.');
    } else {
      alert("Failed to submit winners: " + res.error);
    }
  });
});

document.getElementById('btn-cancel-winners').addEventListener('click', () => {
  // If host cancels winner popup, we force cancel the hand to avoid locked state
  if (confirm("Cancel the hand? This refunds bets or completes default winners.")) {
    socket.emit('cancel_hand');
  }
});

// ==========================================
// 9. SETTLEMENT SCREEN RENDER
// ==========================================

function renderSettlement() {
  if (!roomState) return;

  const tableBody = document.getElementById('settlement-table-body');
  tableBody.innerHTML = "";

  const summary = roomState.ledger.summary;
  const balanceInfo = roomState.ledger.balanceInfo;
  const transfers = roomState.ledger.transfers;

  // Render player records
  roomState.players.forEach((p) => {
    const pSummary = summary[p.id] || { totalBuyIns: 0, cashOut: 0, profit: 0 };
    const tr = document.createElement('tr');
    
    // Check if player is ourselves to allow editing cashout value
    const isMe = p.id === playerId;
    
    let cashOutCellHtml = "";
    if (isMe) {
      cashOutCellHtml = `<input type="number" id="cashout-input-${p.id}" value="${pSummary.cashOut}" min="0" class="input-sm text-center table-input">`;
    } else {
      cashOutCellHtml = `<span>${pSummary.cashOut}</span>`;
    }

    const profitClass = pSummary.profit < 0 ? 'ledger-profit-neg' : 'ledger-profit-pos';
    const profitSign = pSummary.profit > 0 ? '+' : '';
    
    let actionBtnHtml = "";
    if (isMe) {
      actionBtnHtml = `<button class="btn btn-primary btn-xs" onclick="submitCashOut('${p.id}')">Save</button>`;
    } else {
      actionBtnHtml = `<span class="text-muted" style="font-size:0.75rem;">Self-Report</span>`;
    }

    tr.innerHTML = `
      <td><strong>${p.name}</strong></td>
      <td>${pSummary.totalBuyIns}</td>
      <td>${cashOutCellHtml}</td>
      <td class="${profitClass}">${profitSign}${pSummary.profit}</td>
      <td>${actionBtnHtml}</td>
    `;
    tableBody.appendChild(tr);
  });

  // Render ledger status banner
  const balanceAlert = document.getElementById('ledger-balance-alert');
  const balanceText = document.getElementById('ledger-balance-text');

  if (balanceInfo.balanced) {
    balanceAlert.className = 'ledger-balance-status alert-success';
    balanceText.innerHTML = `✔ Ledger is Balanced! Total Chips: <strong>${balanceInfo.totalBuyIns}</strong>`;
  } else {
    balanceAlert.className = 'ledger-balance-status alert-warning';
    const diffSign = balanceInfo.difference > 0 ? '+' : '';
    balanceText.innerHTML = `⚠ Ledger is out of balance. Difference: <strong>${diffSign}${balanceInfo.difference}</strong> (Sum of Cash-outs must equal Sum of Buy-ins)`;
  }

  // Render peer transfers list
  const transfersContainer = document.getElementById('transfers-container');
  transfersContainer.innerHTML = "";

  if (transfers.length === 0) {
    transfersContainer.innerHTML = `<div class="no-transfers-banner">No transfers generated. ${balanceInfo.balanced ? 'All players broke perfectly even.' : 'Please balance the ledger first.'}</div>`;
  } else {
    transfers.forEach((tx) => {
      const card = document.createElement('div');
      card.className = 'transfer-card';
      card.innerHTML = `
        <div class="transfer-flow">
          <span class="transfer-player-from">${tx.from.name}</span>
          <span class="transfer-arrow">➔ pays ➔</span>
          <span class="transfer-player-to">${tx.to.name}</span>
        </div>
        <div class="transfer-amt">$${tx.amount}</div>
      `;
      transfersContainer.appendChild(card);
    });
  }
}

// Global function bound to save button click
window.submitCashOut = function(pId) {
  const inputEl = document.getElementById(`cashout-input-${pId}`);
  if (!inputEl) return;
  const amt = parseInt(inputEl.value, 10);
  if (isNaN(amt) || amt < 0) return alert("Please enter a valid cash-out stack.");

  socket.emit('cash_out', { amount: amt }, (res) => {
    if (res.success) {
      console.log("Cash-out saved");
    }
  });
};

document.getElementById('btn-reset-session').addEventListener('click', () => {
  if (confirm("End this session? You will return to the lobby.")) {
    window.location.reload();
  }
});
