/**
 * Pot Calculator Engine
 * Calculates main pot, side pots, and refunds based on player contributions
 * and active/folded status.
 */

/**
 * Calculates the main and side pots, and refunds for excess bets.
 * 
 * @param {Array} players - Array of player objects: { id, folded }
 * @param {Object} contributions - Map of playerId -> totalChipsContributed
 * @returns {Object} { pots: Array, refunds: Object }
 *   where:
 *     pots is an array of: { id, amount, eligiblePlayers, type, label }
 *     refunds is a map of: { playerId: refundAmount }
 */
function calculatePots(players, contributions) {
  // Ensure we have a clean copy of contributions
  const workingContributions = {};
  for (const p of players) {
    workingContributions[p.id] = contributions[p.id] || 0;
  }

  // Get active (non-folded) players with positive contributions
  const activePlayers = players.filter(p => !p.folded);
  
  const pots = [];
  const refunds = {};

  while (true) {
    // Filter out players who still have some contributions left
    const contributors = players.filter(p => workingContributions[p.id] > 0);
    
    // If no one has any remaining contribution, we are done
    if (contributors.length === 0) {
      break;
    }

    // Get active players who contributed to this round/level
    const activeContributors = activePlayers.filter(p => workingContributions[p.id] > 0);

    // If there are no active players left with contributions,
    // any remaining contributions from folded players are dead money and can't be won by them.
    // In this case, we award it to the remaining active players.
    // Or if there is only 1 active player left with contributions, but other active players have folded/all-in,
    // let's see. If there are no active players with contributions left at all, we split it among all active players.
    if (activeContributors.length === 0) {
      // Find all active players in the hand
      const eligible = activePlayers.map(p => p.id);
      if (eligible.length > 0) {
        // Collect all remaining contributions as a single pot
        let amount = 0;
        for (const c of contributors) {
          amount += workingContributions[c.id];
          workingContributions[c.id] = 0;
        }
        pots.push({
          id: `dead_pot_${pots.length + 1}`,
          amount,
          eligiblePlayers: eligible,
          type: pots.length === 0 ? 'main' : 'side',
          label: pots.length === 0 ? 'Main Pot (Dead Money)' : `Side Pot ${pots.length} (Dead Money)`
        });
      } else {
        // If literally zero active players remain, refund remaining contributions
        for (const c of contributors) {
          refunds[c.id] = (refunds[c.id] || 0) + workingContributions[c.id];
          workingContributions[c.id] = 0;
        }
      }
      break;
    }

    // Find the minimum non-zero contribution among active contributors
    const activeContributions = activeContributors.map(p => workingContributions[p.id]);
    const minContribution = Math.min(...activeContributions);

    // If only one active player has contributions left, and no other active players have any contributions left,
    // they can't be matched by anyone.
    // We should refund their remaining contribution above the next highest active player's contribution.
    if (activeContributors.length === 1) {
      const lonePlayer = activeContributors[0];
      // Refund the lone player's remaining contribution
      refunds[lonePlayer.id] = (refunds[lonePlayer.id] || 0) + workingContributions[lonePlayer.id];
      workingContributions[lonePlayer.id] = 0;
      continue;
    }

    // Create a new pot for this contribution tier
    let potAmount = 0;
    const eligiblePlayers = [];

    // All players (active or folded) contribute up to minContribution
    for (const p of players) {
      if (workingContributions[p.id] > 0) {
        const contribution = Math.min(workingContributions[p.id], minContribution);
        potAmount += contribution;
        workingContributions[p.id] -= contribution;

        // Active players who contribute to this tier are eligible to win it
        if (!p.folded) {
          eligiblePlayers.push(p.id);
        }
      }
    }

    // Push the pot
    if (potAmount > 0) {
      const isMain = pots.length === 0;
      pots.push({
        id: isMain ? 'main' : `side_${pots.length}`,
        amount: potAmount,
        eligiblePlayers,
        type: isMain ? 'main' : 'side',
        label: isMain ? 'Main Pot' : `Side Pot ${pots.length}`
      });
    }
  }

  return { pots, refunds };
}

module.exports = {
  calculatePots
};
