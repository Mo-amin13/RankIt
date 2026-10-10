# RankIt

Rank anything by choosing between two items at a time.

You enter a list (movies, albums, supercars, anything), then answer one simple
question over and over: *which of these two do you prefer?* You can also call
it equal. The full ranking stays hidden until the last choice, so early picks
can't bias later ones.

## How it works

RankIt uses a **tie-aware binary insertion sort**. Items are placed one at a
time into an ordered list of groups, using binary search to find each item's
spot. That takes roughly *n log n* choices instead of comparing every pair:
12 items need at most 33 choices, not 66.

- **Ties are real.** Choosing "equal" puts items in the same group, and results
  use dense ranks (`1, 2, 2, 3`).
- **Left and right are random.** Which item appears on which side is shuffled
  separately from the ranking logic, so screen position can't sway you.
- **Undo** restores the exact previous comparison, one step back.
- **Resume anytime.** Reloading or coming back later picks up where you left off.

## Features

- Lists of 3–40 items with optional HTTPS image URLs
- Nine starter lists (movies, TV shows, anime, manga, albums, supercars,
  video games, Pixar movies, Taylor Swift albums) to rank as-is or edit
- Home page with your rankings in progress and finished
- Keyboard shortcuts while comparing: `←` `→` choose, `↓` equal, `U` undo
- Light and dark mode, works on phones

## No accounts

RankIt has no sign-up. Each browser gets a random secret in an `HttpOnly`
cookie, and rankings are stored under a SHA-256 hash of that secret, never the
secret itself. Your rankings are visible only in the browser that created
them; anyone else gets a 404. Clearing cookies or switching devices means
starting fresh.

## Tech stack

| Part | Tools |
|---|---|
| Client | React 19, TypeScript, Vite, React Router |
| Server | Node.js 24, Express 5, TypeScript |
| Database | PostgreSQL (rankings stored as `jsonb`) |
| Tests | Vitest, Supertest |

The server owns all ranking logic. The client only shows the current state and
sends your choices, and the API never reveals the order of an unfinished
ranking.

## Getting started

You need [Node.js 24](https://nodejs.org) and npm.

```sh
git clone https://github.com/Mo-amin13/RankIt.git
cd RankIt
npm install
npm --prefix client install
```

### Database (optional)

Without a database, rankings are kept in memory and disappear when the server
restarts. That's fine for trying it out.

To keep them, create a PostgreSQL database (a free [Neon](https://neon.com)
project works), run the files in `server/db/migrations/` in order, then:

```sh
cp .env.example .env
```

and set `DATABASE_URL` in `.env`.

### Run it

Start the API and the client in two terminals:

```sh
npm run dev                  # API on http://localhost:3000
npm --prefix client run dev  # app on http://localhost:5173
```

Open http://localhost:5173. Vite forwards `/api` requests to the server.

## Scripts

From the repository root:

| Command | What it does |
|---|---|
| `npm run dev` | API server with auto-reload, loading `.env` |
| `npm test` | All server tests |
| `npm run typecheck` | Type-check the server and shared types |
| `npm run build` | Build the server into `dist/` and the client into `client/dist/` |
| `npm start` | Run the built server |

In `client/`: `npm run dev`, `npm run build` and `npm run lint`.

The Postgres tests run only when `DATABASE_URL` is set, and clean up every row
they create. Point them at a development database, never production.

## Project structure

```
client/        React app (pages, components, API calls)
server/
  src/         Express app, ranking engine, service, storage
  db/          SQL migrations
  tests/       Unit and endpoint tests
shared/        Types used by both client and server
```

## Deploying

In production (`NODE_ENV=production`) one Node server serves both the API and
the built client. It reads `PORT` and `DATABASE_URL` from the environment,
trusts one proxy hop for rate limiting, and marks the cookie `Secure`.

On a host like Render:

- **Build:** `npm ci --include=dev && npm --prefix client ci --include=dev && npm run build`
- **Start:** `npm start`
- **Health check:** `/api/health`
- **Environment:** `DATABASE_URL` and `NODE_ENV=production`

See `.env.example` for every setting.

## License

[MIT](LICENSE)
