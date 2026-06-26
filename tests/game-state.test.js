const assert = require('assert');
const GameState = require('../engines/game-state');
const SettlementLedger = require('../engines/settlement-ledger');

console.log('Running Game State tests...');

function testGameSetupAndLobby() {
  console.log('- Running testGameSetupAndLobby');
  const game = new GameState('ABC123', 'host-uuid');
  const ledger = new SettlementLedger();

  // Add players
  game.addPlayer('host-uuid', 'Alice', true);
  game.addPlayer('player-bob', 'Bob');
  game.addPlayer('player-charlie', 'Charlie');

  assert.strictEqual(game.players.length, 3);
  assert.strictEqual(game.players[0].isHost, true);

  // Sit players
  assert.strictEqual(game.sitPlayer('host-uuid', 1), true);
  assert.strictEqual(game.sitPlayer('player-bob', 2), true);
  assert.strictEqual(game.sitPlayer('player-charlie', 3), true);

  // Seat occupation checks
  assert.strictEqual(game.sitPlayer('player-bob', 3), false); // Seat occupied
  
  // Buy-ins
  assert.strictEqual(game.buyIn('host-uuid', 1000, ledger), true);
  assert.strictEqual(game.buyIn('player-bob', 1000, ledger), true);
  assert.strictEqual(game.buyIn('player-charlie', 1000, ledger), true);

  assert.strictEqual(game.seats[1].stack, 1000);
  assert.strictEqual(ledger.getTotalBuyIns('host-uuid'), 1000);
}

function testStandardBettingHand() {
  console.log('- Running testStandardBettingHand');
  const game = new GameState('ABC123', 'host-uuid');
  const ledger = new SettlementLedger();

  game.addPlayer('host-uuid', 'Alice', true);
  game.addPlayer('player-bob', 'Bob');
  game.addPlayer('player-charlie', 'Charlie');

  game.sitPlayer('host-uuid', 1);
  game.sitPlayer('player-bob', 2);
  game.sitPlayer('player-charlie', 3);

  game.buyIn('host-uuid', 1000, ledger);
  game.buyIn('player-bob', 1000, ledger);
  game.buyIn('player-charlie', 1000, ledger);

  // Start hand
  // Seats: 1=Alice (Dealer), 2=Bob (SB), 3=Charlie (BB)
  // Blinds: 10/20
  const started = game.startHand();
  assert.strictEqual(started, true);
  assert.strictEqual(game.handStatus, 'PRE_FLOP');
  assert.strictEqual(game.dealerSeat, 1);
  assert.strictEqual(game.sbSeat, 2);
  assert.strictEqual(game.bbSeat, 3);

  // Stack verification after blinds
  assert.strictEqual(game.seats[1].stack, 1000); // Dealer hasn't bet yet
  assert.strictEqual(game.seats[2].stack, 990);  // SB posted 10
  assert.strictEqual(game.seats[3].stack, 980);  // BB posted 20

  // Turn UTG (since Alice is dealer, she acts first heads up, but with 3 players: UTG is after BB = Alice!)
  // UTG = Alice (seat 1). Let's verify.
  assert.strictEqual(game.currentTurnSeat, 1);

  // UTG Alice calls BB (20)
  game.processAction('host-uuid', 'CALL');
  assert.strictEqual(game.seats[1].stack, 980);
  assert.strictEqual(game.roundBets['host-uuid'], 20);

  // SB Bob calls (needs to add 10 to reach 20)
  assert.strictEqual(game.currentTurnSeat, 2);
  game.processAction('player-bob', 'CALL');
  assert.strictEqual(game.seats[2].stack, 980);
  assert.strictEqual(game.roundBets['player-bob'], 20);

  // BB Charlie checks (already bet 20)
  assert.strictEqual(game.currentTurnSeat, 3);
  game.processAction('player-charlie', 'CHECK');

  // Round should advance to FLOP
  assert.strictEqual(game.handStatus, 'FLOP');
  // In post-flop, SB acts first. SB is Bob (seat 2).
  assert.strictEqual(game.currentTurnSeat, 2);
  
  // Total in pots should be Alice (20) + Bob (20) + Charlie (20) = 60
  assert.strictEqual(game.pots.length, 1);
  assert.strictEqual(game.pots[0].amount, 60);

  // Check / Check / Check on Flop
  game.processAction('player-bob', 'CHECK');
  game.processAction('player-charlie', 'CHECK');
  game.processAction('host-uuid', 'CHECK');

  // Advances to TURN
  assert.strictEqual(game.handStatus, 'TURN');
}

function testAllInAndPots() {
  console.log('- Running testAllInAndPots');
  const game = new GameState('ABC123', 'host-uuid');
  const ledger = new SettlementLedger();

  game.addPlayer('A', 'Alice', true);
  game.addPlayer('B', 'Bob');
  game.addPlayer('C', 'Charlie');

  game.sitPlayer('A', 1);
  game.sitPlayer('B', 2);
  game.sitPlayer('C', 3);

  // Alice has 200 stack, Bob has 500, Charlie has 1000
  game.buyIn('A', 200, ledger);
  game.buyIn('B', 500, ledger);
  game.buyIn('C', 1000, ledger);

  // Start hand
  game.startHand(); // Button: 1 (Alice), SB: 2 (Bob), BB: 3 (Charlie)
  // Alice (D): 200 stack
  // Bob (SB): 500 - 10 = 490 stack
  // Charlie (BB): 1000 - 20 = 980 stack

  // Alice raises to 200 (all-in)
  game.processAction('A', 'RAISE', 200);
  assert.strictEqual(game.seats[1].stack, 0);
  assert.strictEqual(game.seats[1].allIn, true);

  // Bob raises to 500 (all-in)
  game.processAction('B', 'RAISE', 500);
  assert.strictEqual(game.seats[2].stack, 0);
  assert.strictEqual(game.seats[2].allIn, true);

  // Charlie calls 500 (needs to add 480 to reach 500)
  game.processAction('C', 'CALL');

  // At this point, Alice and Bob are all-in, Charlie is not all-in but has matched the bet.
  // There are no other active players with chips. The hand should skip directly to SHOWDOWN.
  assert.strictEqual(game.handStatus, 'SHOWDOWN');

  // Pots verification
  // Alice total bet: 200
  // Bob total bet: 500
  // Charlie total bet: 500
  // Pots should be:
  // Main Pot: 200 * 3 = 600 (Eligible: A, B, C)
  // Side Pot 1: (500 - 200) * 2 = 600 (Eligible: B, C)
  assert.strictEqual(game.pots.length, 2);
  assert.strictEqual(game.pots[0].amount, 600);
  assert.deepStrictEqual(game.pots[0].eligiblePlayers, ['A', 'B', 'C']);
  
  assert.strictEqual(game.pots[1].amount, 600);
  assert.deepStrictEqual(game.pots[1].eligiblePlayers, ['B', 'C']);

  // Declare winners: Alice wins Main, Charlie wins Side
  game.declareWinner({
    'main': ['A'],
    'side_1': ['C']
  }, ledger);

  // Verification of payouts
  assert.strictEqual(game.seats[1].stack, 600);  // Alice won main (600)
  assert.strictEqual(game.seats[2].stack, 0);    // Bob lost
  assert.strictEqual(game.seats[3].stack, 1100); // Charlie won side (600) + kept remaining 500 of stack
}

try {
  testGameSetupAndLobby();
  testStandardBettingHand();
  testAllInAndPots();
  console.log('All Game State tests passed successfully!');
} catch (error) {
  console.error('Test verification failed:', error);
  process.exit(1);
}
