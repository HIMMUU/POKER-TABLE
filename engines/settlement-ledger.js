/**
 * Settlement Ledger Engine
 * Tracks buy-ins, rebuys, cash-outs, and computes the settlement peer-to-peer transfers.
 */

class SettlementLedger {
  constructor() {
    this.buyIns = {};   // playerId -> array of { amount, timestamp }
    this.cashOuts = {}; // playerId -> amount
  }

  /**
   * Adds a buy-in or rebuy for a player.
   * @param {string} playerId 
   * @param {number} amount 
   */
  addBuyIn(playerId, amount) {
    if (amount <= 0) return;
    if (!this.buyIns[playerId]) {
      this.buyIns[playerId] = [];
    }
    this.buyIns[playerId].push({
      amount,
      timestamp: Date.now()
    });
  }

  /**
   * Registers a cash-out amount for a player.
   * @param {string} playerId 
   * @param {number} amount 
   */
  cashOut(playerId, amount) {
    if (amount < 0) return;
    this.cashOuts[playerId] = amount;
  }

  /**
   * Clears cash-out amount for a player (in case they rejoin or undo).
   * @param {string} playerId 
   */
  clearCashOut(playerId) {
    delete this.cashOuts[playerId];
  }

  /**
   * Gets the total buy-ins for a player.
   * @param {string} playerId 
   * @returns {number}
   */
  getTotalBuyIns(playerId) {
    if (!this.buyIns[playerId]) return 0;
    return this.buyIns[playerId].reduce((sum, item) => sum + item.amount, 0);
  }

  /**
   * Gets the total cash-outs for a player.
   * @param {string} playerId 
   * @returns {number}
   */
  getCashOut(playerId) {
    return this.cashOuts[playerId] !== undefined ? this.cashOuts[playerId] : 0;
  }

  /**
   * Checks if the ledger is balanced.
   * Total Buy-ins must equal Total Cash-outs.
   * @param {Array} playerIds - List of active players to include in checking
   * @returns {Object} { balanced: boolean, totalBuyIns: number, totalCashOuts: number, difference: number }
   */
  checkBalance(playerIds) {
    let totalBuyIns = 0;
    let totalCashOuts = 0;

    for (const pid of playerIds) {
      totalBuyIns += this.getTotalBuyIns(pid);
      totalCashOuts += this.getCashOut(pid);
    }

    const difference = totalCashOuts - totalBuyIns;
    return {
      balanced: Math.abs(difference) < 0.01,
      totalBuyIns,
      totalCashOuts,
      difference
    };
  }

  /**
   * Computes individual profits for a list of players.
   * @param {Array} playerIds 
   * @returns {Object} map of playerId -> { totalBuyIns, cashOut, profit }
   */
  getSummary(playerIds) {
    const summary = {};
    for (const pid of playerIds) {
      const totalBuyIns = this.getTotalBuyIns(pid);
      const cashOut = this.getCashOut(pid);
      summary[pid] = {
        totalBuyIns,
        cashOut,
        profit: cashOut - totalBuyIns
      };
    }
    return summary;
  }

  /**
   * Generates a minimized set of peer-to-peer transfers to settle the balances.
   * Using a greedy Splitwise-like algorithm.
   * @param {Array} players - Array of player objects: { id, name }
   * @returns {Array} transfers - Array of { from: { id, name }, to: { id, name }, amount }
   */
  calculateTransfers(players) {
    const playerIds = players.map(p => p.id);
    const balanceInfo = this.checkBalance(playerIds);
    
    // If it's not balanced, we can't settle cleanly (though we can try, it will have a surplus/deficit)
    // For standard poker, the host must adjust cashouts until it balances.
    
    // Calculate net balances for all players
    const nets = players.map(p => {
      const buyIn = this.getTotalBuyIns(p.id);
      const cashOut = this.getCashOut(p.id);
      return {
        id: p.id,
        name: p.name,
        net: cashOut - buyIn
      };
    });

    // Separate into debtors (net < 0) and creditors (net > 0)
    // We filter out people with 0 net balance
    const debtors = nets.filter(p => p.net < -0.01).map(p => ({ ...p, net: -p.net })); // Make debt positive for easy math
    const creditors = nets.filter(p => p.net > 0.01);

    // Sort descending to settle largest amounts first (greedy optimization)
    debtors.sort((a, b) => b.net - a.net);
    creditors.sort((a, b) => b.net - a.net);

    const transfers = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      // Find the transfer amount (min of what debtor owes and what creditor is owed)
      const amount = Math.min(debtor.net, creditor.net);
      
      if (amount > 0.01) {
        transfers.push({
          from: { id: debtor.id, name: debtor.name },
          to: { id: creditor.id, name: creditor.name },
          amount: Math.round(amount * 100) / 100 // Round to 2 decimal places
        });
      }

      debtor.net -= amount;
      creditor.net -= amount;

      if (debtor.net < 0.01) {
        dIdx++;
      }
      if (creditor.net < 0.01) {
        cIdx++;
      }
    }

    return transfers;
  }
}

module.exports = SettlementLedger;
