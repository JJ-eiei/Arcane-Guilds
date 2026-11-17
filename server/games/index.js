// Registry of available games. Add your game module here.
const games = [
  require('./arcane/engine'),
];

const byId = Object.fromEntries(games.map((g) => [g.id, g]));

module.exports = {
  get(id) { return byId[id] || null; },
  list() {
    return games.map((g) => ({
      id: g.id, name: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
    }));
  },
  defaultId: games[0].id,
};
