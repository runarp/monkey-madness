# Monkey Madness

Monkey Madness is a playful AI-assisted browser game project developed by kids for them to play.

The idea started as a silly grow-forever game: begin as a tiny T-Rex, eat smaller things, grow larger, then keep scaling up through towns, cities, continents, and the globe. It was built with AI help as an experiment in turning kids' game ideas into something playable.

## Gameplay

- Move around and eat things smaller than you.
- Name your T-Rex before each browser session starts.
- Start with tiny snacks like ants, worms, flowers, brush, and signposts.
- Grow into eating trees, cars, houses, buildings, towers, mountains, and eventually planet-scale objects.
- Ground progression is split into authored boards defined in `src/boards.js`, with fixed groups of snacks, grass, flowers, houses, cars, city blocks, forests, and mountains.
- After the globe scale, jump into orbit, eat the Moon, cross a compressed solar system, consume planets, asteroid belts, the Sun, and nearby star systems until the galaxy comes into view.
- Avoid larger rival T-Rex enemies. They can eat you if they are big enough.
- Multiplayer is on by default for everyone connected to the same running host.
  Players in the same world phase can see, identify, and eat each other.

## Controls

- `WASD` or arrow keys: move
- Touch left stick: move
- Touch right stick: rotate/tilt camera
- Mouse wheel: zoom camera
- Right-click drag: rotate/tilt camera

## Development

Install dependencies:

```bash
npm install
```

Run the game:

```bash
npm run dev
```

The development server includes tiny `/api/scores` and `/api/multiplayer`
backends. Finished runs are saved to `data/top-scores.yml` by default, which
makes the leaderboard shared for everyone using the same running server. Live
players are shared in memory across browsers connected to the host that served
the page. Override the score file location with
`SCORES_FILE=/path/to/top-scores.yml` if needed.

Build:

```bash
npm run build
```

Run the built game with the score backend:

```bash
npm start
```

Render verification:

```bash
npm run verify:render
```

## Credits

T-Rex model: [T-Rex by Poly by Google on Poly Pizza](https://poly.pizza/m/9GyZw9gGPMq), licensed under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/).
