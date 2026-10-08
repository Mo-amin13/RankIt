import type { Pool } from "pg"

import type { RankingState } from "./engine.js"
import type {
  RankingListEntry,
  RankingRecord,
  RankingStore,
  StoredRanking
} from "./store.js"

// Columns as Postgres returns them. pg parses jsonb into plain objects and
// timestamptz into Date.
type RankingRow = {
  state: RankingState
  undo_state: RankingState | null
  revision: number
}

type ListRow = {
  id: string
  state: RankingState
  updated_at: Date
}

// Stores rankings in the `rankings` table (server/db/migrations). Every value
// goes in through $n parameters, never by building SQL strings, and every
// query is limited to the owner's rows.
export class PostgresRankingStore implements RankingStore {
  constructor(private readonly pool: Pool) {}

  async get(ownerHash: string, id: string): Promise<StoredRanking | undefined> {
    const result = await this.pool.query<RankingRow>(
      "select state, undo_state, revision from rankings where id = $1 and owner_hash = $2",
      [id, ownerHash]
    )
    const row = result.rows[0]

    if (!row) {
      return undefined
    }

    return { state: row.state, undoState: row.undo_state, revision: row.revision }
  }

  async list(ownerHash: string, limit: number): Promise<RankingListEntry[]> {
    const result = await this.pool.query<ListRow>(
      `select id, state, updated_at from rankings
       where owner_hash = $1
       order by updated_at desc, id
       limit $2`,
      [ownerHash, limit]
    )

    return result.rows.map((row) => ({
      id: row.id,
      state: row.state,
      updatedAt: row.updated_at
    }))
  }

  async insert(ownerHash: string, id: string, record: RankingRecord): Promise<void> {
    // A duplicate id violates the primary key, so Postgres throws.
    await this.pool.query(
      "insert into rankings (id, owner_hash, state, undo_state) values ($1, $2, $3, $4)",
      [id, ownerHash, JSON.stringify(record.state), toJson(record.undoState)]
    )
  }

  async update(
    ownerHash: string,
    id: string,
    record: RankingRecord,
    expectedRevision: number
  ): Promise<boolean> {
    // Checking the revision and writing happen in one statement, so no other
    // request can change the row in between.
    const result = await this.pool.query(
      `update rankings
       set state = $3, undo_state = $4, revision = revision + 1, updated_at = now()
       where id = $1 and owner_hash = $2 and revision = $5`,
      [id, ownerHash, JSON.stringify(record.state), toJson(record.undoState), expectedRevision]
    )

    return result.rowCount === 1
  }

  async delete(ownerHash: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      "delete from rankings where id = $1 and owner_hash = $2",
      [id, ownerHash]
    )

    return result.rowCount === 1
  }
}

// null must reach Postgres as SQL NULL, not as the JSON text "null".
function toJson(value: RankingState | null): string | null {
  return value === null ? null : JSON.stringify(value)
}
