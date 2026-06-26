const assert = require('assert');
const { calculatePots } = require('../engines/pot-calculator');

console.log('Running Pot Calculator tests...');

// Test Scenario 1: Standard pot, no all-ins
function testStandardPot() {
  console.log('- Running testStandardPot');
  const players = [
    { id: 'A', name: 'Alice', folded: false },
    { id: 'B', name: 'Bob', folded: false },
    { id: 'C', name: 'Charlie', folded: false }
  ];
  const contributions = { A: 100, B: 100, C: 100 };

  const result = calculatePots(players, contributions);

  assert.strictEqual(result.pots.length, 1);
  assert.strictEqual(result.pots[0].amount, 300);
  assert.deepStrictEqual(result.pots[0].eligiblePlayers, ['A', 'B', 'C']);
  assert.deepStrictEqual(result.refunds, {});
}

// Test Scenario 2: Simple all-in creating a side pot and a refund
function testSimpleSidePotAndRefund() {
  console.log('- Running testSimpleSidePotAndRefund');
  const players = [
    { id: 'A', name: 'Alice', folded: false }, // All-in at 500
    { id: 'B', name: 'Bob', folded: false },   // Bets 1000
    { id: 'C', name: 'Charlie', folded: false } // Bets 1500 (unmatched)
  ];
  const contributions = { A: 500, B: 1000, C: 1500 };

  const result = calculatePots(players, contributions);

  // Pots:
  // Main: 500 + 500 + 500 = 1500 (Eligible: A, B, C)
  // Side 1: B's remaining (500) + C's remaining (500) = 1000 (Eligible: B, C)
  // Refund C: remaining 500 (since C put 1500 but A is all-in at 500 and B is all-in at 1000)
  assert.strictEqual(result.pots.length, 2);
  assert.strictEqual(result.pots[0].amount, 1500);
  assert.deepStrictEqual(result.pots[0].eligiblePlayers, ['A', 'B', 'C']);
  assert.strictEqual(result.pots[1].amount, 1000);
  assert.deepStrictEqual(result.pots[1].eligiblePlayers, ['B', 'C']);
  assert.deepStrictEqual(result.refunds, { C: 500 });
}

// Test Scenario 3: All-in with folded player
function testAllInWithFoldedPlayer() {
  console.log('- Running testAllInWithFoldedPlayer');
  const players = [
    { id: 'A', name: 'Alice', folded: false },
    { id: 'B', name: 'Bob', folded: false },
    { id: 'C', name: 'Charlie', folded: false },
    { id: 'D', name: 'Daniel', folded: true }
  ];
  // A is all-in at 500, B at 1000, C bets 1500, D folded after putting 300
  const contributions = { A: 500, B: 1000, C: 1500, D: 300 };

  const result = calculatePots(players, contributions);

  // Main Pot:
  // Alice: 500, Bob: 500, Charlie: 500, Daniel: 300 -> Total: 1800
  // Eligible: Alice, Bob, Charlie (Daniel folded)
  // Side Pot 1:
  // Bob: 500, Charlie: 500 -> Total: 1000
  // Eligible: Bob, Charlie
  // Refund Charlie: 500 (excess)
  assert.strictEqual(result.pots.length, 2);
  assert.strictEqual(result.pots[0].amount, 1800);
  assert.deepStrictEqual(result.pots[0].eligiblePlayers, ['A', 'B', 'C']);
  assert.strictEqual(result.pots[1].amount, 1000);
  assert.deepStrictEqual(result.pots[1].eligiblePlayers, ['B', 'C']);
  assert.deepStrictEqual(result.refunds, { C: 500 });
}

// Run tests
try {
  testStandardPot();
  testSimpleSidePotAndRefund();
  testAllInWithFoldedPlayer();
  console.log('All Pot Calculator tests passed successfully!');
} catch (error) {
  console.error('Test verification failed:', error);
  process.exit(1);
}
