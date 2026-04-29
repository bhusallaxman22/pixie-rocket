# Pixi Rocket Arena

A small Rocket League-inspired multiplayer arena built with JavaScript, Three.js, PixiJS, Socket.IO, and Vite.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The lobby lets you set a driver name and room code before entering the full-screen match. Share the same room name or URL query, such as `http://localhost:5173/?room=arena`, with another browser window to play together.

## Controls

- `W` / `ArrowUp`: throttle
- `S` / `ArrowDown`: reverse
- `A` / `ArrowLeft`: steer left
- `D` / `ArrowRight`: steer right
- `Shift` / `E`: boost
- `Space`: jump
- Controller: left stick or D-pad steers, right trigger throttles, left trigger reverses, `A` / Cross jumps, `B` / Circle or right bumper boosts

The server owns the game simulation and broadcasts snapshots to everyone in the room. The client renders the arena in Three.js with generated texture assets and uses PixiJS for the minimap overlay.

## Docker

Build and run locally:

```bash
docker compose up --build
```

The app will be available at `http://localhost:5173`. Override the host port with `PORT=8080 docker compose up --build`.

GitHub Actions builds the Docker image on pull requests and publishes it to GitHub Container Registry on pushes to `main`, `master`, or `v*` tags:

```text
ghcr.io/<owner>/<repo>
```

## Assets

Generated image assets are stored in `public/assets`:

- `arena-texture-atlas.png`: turf, car paint, boost pad, and stadium material atlas
- `ball-material.png`: spherical ball texture
