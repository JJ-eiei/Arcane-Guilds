# Adding a game

The live game is `arcane/` (Arcane Guilds). The framework can host more games:

A game is two files with the same id:

| File | Runs on | Job |
|---|---|---|
| `server/games/<id>.js` | server | rules — the only source of truth |
| `public/games/<id>.js` | browser | drawing the board + sending moves |

Register the server module in `server/games/index.js` and add
`<script src="/games/<id>.js"></script>` to `public/index.html`.

## Server module

```js
module.exports = {
  id: 'mygame', name: 'My Game', minPlayers: 2, maxPlayers: 4,
  setup(players)            // -> initial state (players = [{id,name}] in seat order)
  move(state, seat, move)   // validate + mutate; return an error string to reject
  view(state, seat)         // what this seat may see (hide other hands here!)
  currentTurn(state)        // seat to act, or null
  isOver(state)             // true when finished
};
```

Never trust `move` — it comes from the browser. Validate everything.

## Browser renderer

```js
window.GameRenderers.mygame = ({ el, sendMove }) => ({
  update(snap),   // snap.view, snap.players, snap.mySeat, snap.turnSeat, snap.status
  result(snap),   // optional { title, sub } for the game-over card
  unmount(),
});
```
