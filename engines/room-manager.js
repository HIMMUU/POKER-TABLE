/**
 * Room Manager Engine
 * Manages multiple isolated poker rooms, each with its GameState and SettlementLedger.
 */

const GameState = require('./game-state');
const SettlementLedger = require('./settlement-ledger');

class RoomManager {
  constructor() {
    this.rooms = {}; // roomCode -> { game: GameState, ledger: SettlementLedger }
  }
constructor as = (){
  
}
  /**
   * Generates a unique 6-character room code.
   * @returns {string}
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters like I, O, 1, 0
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms[code]); // Ensure uniqueness
    
    return code;
  }

  /**
   * Creates a new room.
   * @param {string} hostId 
   * @param {string} hostName 
   * @returns {Object} The room container: { roomCode, game, ledger }
   */
  createRoom(hostId, hostName) {
    const roomCode = this.generateRoomCode();
    const game = new GameState(roomCode, hostId);
    const ledger = new SettlementLedger();
    
    // Add the host as a player
    game.addPlayer(hostId, hostName, true);
    
    this.rooms[roomCode] = {
      roomCode,
      game,
      ledger,
      createdAt: Date.now()
    };
    
    return this.rooms[roomCode];
  }

  /**
   * Retrieves a room by its code.
   * @param {string} roomCode 
   * @returns {Object|null}
   */
  getRoom(roomCode) {
    const code = roomCode.trim().toUpperCase();
    return this.rooms[code] || null;
  }

  /**
   * Removes a player from a room.
   * @param {string} roomCode 
   * @param {string} playerId 
   */
  leaveRoom(roomCode, playerId) {
    const room = this.getRoom(roomCode);
    if (!room) return;
    
    room.game.removePlayer(playerId);
    
    // Cleanup room if all players left
    const seatedPlayers = room.game.getSeatedPlayers();
    const activePlayers = room.game.players.filter(p => p.connected);
    if (activePlayers.length === 0 && seatedPlayers.length === 0) {
      delete this.rooms[roomCode.toUpperCase()];
    }
  }
}

module.exports = new RoomManager(); // Export singleton instance
