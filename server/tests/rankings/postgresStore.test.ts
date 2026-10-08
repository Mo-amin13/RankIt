import request from "supertest"
import { afterAll, describe, expect, it } from "vitest"
import { Pool } from "pg"

import { createApp } from "../../src/app.js"
import { OWNER_COOKIE, hashOwnerToken } from "../../src/owner.js"
import { PostgresRankingStore } from "../../src/rankings/postgresStore.js"
import { RankingService } from "../../src/rankings/service.js"
import type { StoredRanking } from "../../src/rankings/store.js"
import { CONTRACT_ID_PREFIX, describeRankingStore } from "./storeContract.js"

// Runs against the database in DATABASE_URL (the Neon dev branch, from the
// root .env). Without it these tests are skipped, so `npm test` still works
// offline. Every row created here is deleted afterwards.
try {
  process.loadEnvFile()
} catch {
  // No .env file: rely on the real environment.
}

// Holds the first `count` reads until all of them have finished, so the
// requests behind them all decide on the same revision.
class SimultaneousReadsStore extends PostgresRankingStore {
  private readonly held: (() => void)[] = []
  private reads = 0

  constructor(pool: Pool, private readonly count: number) {
    super(pool)
  }

  async get(ownerHash: string, id: string): Promise<StoredRanking | undefined> {
    const stored = await super.get(ownerHash, id)
    this.reads += 1

    if (this.reads < this.count) {
      await new Promise<void>((resolve) => this.held.push(resolve))
    } else if (this.reads === this.count) {
      this.held.forEach((release) => release())
    }

    return stored
  }
}

const databaseUrl = process.env.DATABASE_URL
const OWNER = `${CONTRACT_ID_PREFIX}owner`

if (!databaseUrl) {
  describe.skip("PostgresRankingStore (set DATABASE_URL to run)", () => {
    it("needs a database", () => {})
  })
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 })
  const serviceRankingIds: string[] = []

  afterAll(async () => {
    await pool.query("delete from rankings where id like $1", [`${CONTRACT_ID_PREFIX}%`])
    await pool.query("delete from rankings where id = any($1)", [serviceRankingIds])
    await pool.end()
  })

  describeRankingStore("PostgresRankingStore", () => new PostgresRankingStore(pool))

  describe("RankingService on Postgres", () => {
    async function createActive(service: RankingService) {
      const view = await service.create(OWNER, {
        title: "Store test",
        items: [{ name: "Arrival" }, { name: "Dune" }, { name: "The Matrix" }, { name: "Heat" }]
      })
      serviceRankingIds.push(view.id)

      if (view.status !== "active") {
        throw new Error("Expected an active ranking.")
      }

      return view
    }

    it("saves choices and undo across separate store instances", async () => {
      const initial = await createActive(new RankingService(new PostgresRankingStore(pool)))

      // A fresh service and store, like after a server restart.
      const restarted = new RankingService(new PostgresRankingStore(pool))
      const answered = await restarted.answer(OWNER, initial.id, initial.comparison.id, "left")
      expect(answered.ok).toBe(true)

      const undone = await new RankingService(new PostgresRankingStore(pool)).undo(
        OWNER,
        initial.id
      )
      expect(undone).toEqual({ ok: true, value: initial })
    })

    it("applies only one of several simultaneous submissions", async () => {
      const initial = await createActive(new RankingService(new PostgresRankingStore(pool)))

      // Network timing alone may not make the requests overlap, so every request
      // reads before any of them writes; only the database can stop them.
      const service = new RankingService(new SimultaneousReadsStore(pool, 5))

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.answer(OWNER, initial.id, initial.comparison.id, "tie")
        )
      )

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      for (const result of results.filter((result) => !result.ok)) {
        expect(result).toMatchObject({ error: { status: 409, code: "STALE_COMPARISON" } })
      }

      const row = await pool.query<{ revision: number }>(
        "select revision from rankings where id = $1",
        [initial.id]
      )
      expect(row.rows[0]?.revision).toBe(1)
    })

    it("returns not found for IDs that are not UUIDs", async () => {
      const service = new RankingService(new PostgresRankingStore(pool))

      expect(await service.answer(OWNER, "does-not-exist", "c", "left")).toMatchObject({
        ok: false,
        error: { status: 404, code: "RANKING_NOT_FOUND" }
      })
    })
  })

  describe("owner cookie on Postgres", () => {
    it("stores only the hash of the visitor's secret", async () => {
      const agent = request.agent(createApp(new RankingService(new PostgresRankingStore(pool))))

      const created = await agent
        .post("/api/rankings")
        .send({ title: "Store test", items: [{ name: "A" }, { name: "B" }, { name: "C" }] })
      expect(created.status).toBe(201)
      serviceRankingIds.push(created.body.id)

      const cookie = String(created.headers["set-cookie"])
      const token = new RegExp(`${OWNER_COOKIE}=([^;]+)`).exec(cookie)?.[1] ?? ""
      expect(token).not.toBe("")

      const row = await pool.query<{ owner_hash: string }>(
        "select owner_hash from rankings where id = $1",
        [created.body.id]
      )
      expect(row.rows[0]?.owner_hash).toBe(hashOwnerToken(token))
      expect(row.rows[0]?.owner_hash).not.toContain(token)

      const listed = await agent.get("/api/rankings")
      expect(listed.body.rankings.map((ranking: { id: string }) => ranking.id)).toEqual([
        created.body.id
      ])
    })
  })
}
