import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { Pool } from "pg"

import { createApp } from "./app.js"
import { PostgresRankingStore } from "./rankings/postgresStore.js"
import { RankingService } from "./rankings/service.js"
import { InMemoryRankingStore, type RankingStore } from "./rankings/store.js"

const production = process.env.NODE_ENV === "production"
// Render (and most hosts) choose the port; 3000 is for local development.
const port = Number(process.env.PORT) || 3000

function createStore(): { store: RankingStore; close: () => Promise<void> } {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    console.log("DATABASE_URL is not set: rankings are kept in memory only.")
    return { store: new InMemoryRankingStore(), close: async () => {} }
  }

  const pool = new Pool({ connectionString })

  // Neon closes idle connections when it scales to zero. Without this listener
  // that error would crash the server; the pool reconnects on the next query.
  pool.on("error", (error) => {
    console.error("Idle database connection closed:", error.message)
  })

  console.log("Storing rankings in Postgres.")
  return { store: new PostgresRankingStore(pool), close: () => pool.end() }
}

// In production this server also serves the built client. Locally, Vite
// serves the client instead and forwards /api here.
function findClientDir(): string | undefined {
  if (!production) {
    return undefined
  }

  const clientDir = resolve(process.env.CLIENT_DIR ?? "client/dist")

  if (!existsSync(join(clientDir, "index.html"))) {
    console.warn(`No built client at ${clientDir}; serving the API only.`)
    return undefined
  }

  return clientDir
}

const { store, close } = createStore()

const app = createApp(new RankingService(store), {
  // Browsers only send Secure cookies over HTTPS, so this stays off locally.
  secureCookies: production,
  // On Render a request passes Cloudflare, Render's edge and its load
  // balancer: three proxies. Measured on the live site; adjust
  // TRUST_PROXY_HOPS if the host changes.
  trustProxy: production ? Number(process.env.TRUST_PROXY_HOPS ?? 3) : undefined,
  clientDir: findClientDir()
})

const server = app.listen(port, () => {
  console.log(`RankIt listening on http://localhost:${port}`)
})

// Render sends SIGTERM before replacing or stopping the app: finish open
// requests, then close the database pool.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down.`)
  setTimeout(() => process.exit(1), 10_000).unref()
  server.close(() => {
    close().finally(() => process.exit(0))
  })
  server.closeIdleConnections()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
