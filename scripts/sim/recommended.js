// Config recommended by the balance simulation (docs/simulation-report.md).
module.exports = {
  startTokensByPlayers: { 2: [0, 0], 3: [0, 1, 1], 4: [0, 1, 1, 1] },
  dragonReq: 3,
  dragonPoints: 4,
  dragonStealOnTie: true,
  seal: { maxPerPlayer: 2, curse: 1, ownerWild: true, ownerWildCount: 2, takeWith: 2 },
  prophecy: {
    'p-fire': { min: 4 }, 'p-water': { min: 4 }, 'p-earth': { min: 4 }, 'p-wind': { min: 4 }, 'p-light': { min: 4 },
    'p-balance': { min: 2, points: 2 },
    'p-trainee': { min: 12 },
    'p-legend': { min: 1, points: 2 },
    'p-sealer': { min: 3 },
  },
};
