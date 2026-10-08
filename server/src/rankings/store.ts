import type { RankingState } from "./engine.js"

// What the service saves for a ranking.
export type RankingRecord = {
  state: RankingState
  undoState: RankingState | null
}

// What a store returns: the record plus a revision that increases on every
// successful update. The service uses it to detect concurrent changes.
export type StoredRanking = RankingRecord & {
  revision: number
}

// One row of an owner's list, most recently changed first.
export type RankingListEntry = {
  id: string
  state: RankingState
  updatedAt: Date
}

// Every method is scoped to an owner (the hash of the visitor's cookie). A
// ranking that belongs to someone else behaves exactly like a missing one, so
// ownership cannot be bypassed by guessing IDs.
export interface RankingStore {
  get(ownerHash: string, id: string): Promise<StoredRanking | undefined>

  // The owner's rankings, newest change first, at most `limit` of them.
  list(ownerHash: string, limit: number): Promise<RankingListEntry[]>

  // Saves a new ranking at revision 0. Throws if the ID is already taken.
  insert(ownerHash: string, id: string, record: RankingRecord): Promise<void>

  // Saves only if the stored revision still equals expectedRevision, then
  // bumps the revision. Returns false if the ranking is missing, owned by
  // someone else, or another request changed it first; nothing is written then.
  update(
    ownerHash: string,
    id: string,
    record: RankingRecord,
    expectedRevision: number
  ): Promise<boolean>

  // Returns false if there was nothing of this owner's to delete.
  delete(ownerHash: string, id: string): Promise<boolean>
}

type MemoryRow = StoredRanking & {
  ownerHash: string
  updatedAt: Date
  // Breaks ties between changes made in the same millisecond.
  sequence: number
}

// Keeps rankings in process memory. Used by tests and when no database is
// configured. Values are cloned in and out so callers can never change stored
// data without calling update, just like with a real database.
export class InMemoryRankingStore implements RankingStore {
  private readonly rankings = new Map<string, MemoryRow>()
  private sequence = 0

  async get(ownerHash: string, id: string): Promise<StoredRanking | undefined> {
    const row = this.rankings.get(id)

    if (!row || row.ownerHash !== ownerHash) {
      return undefined
    }

    return structuredClone({ state: row.state, undoState: row.undoState, revision: row.revision })
  }

  async list(ownerHash: string, limit: number): Promise<RankingListEntry[]> {
    return [...this.rankings.entries()]
      .filter(([, row]) => row.ownerHash === ownerHash)
      .sort(([, a], [, b]) => b.sequence - a.sequence)
      .slice(0, limit)
      .map(([id, row]) => structuredClone({ id, state: row.state, updatedAt: row.updatedAt }))
  }

  async insert(ownerHash: string, id: string, record: RankingRecord): Promise<void> {
    if (this.rankings.has(id)) {
      throw new Error(`Ranking ${id} already exists.`)
    }

    this.rankings.set(id, this.row(ownerHash, record, 0))
  }

  async update(
    ownerHash: string,
    id: string,
    record: RankingRecord,
    expectedRevision: number
  ): Promise<boolean> {
    const row = this.rankings.get(id)

    if (!row || row.ownerHash !== ownerHash || row.revision !== expectedRevision) {
      return false
    }

    this.rankings.set(id, this.row(ownerHash, record, expectedRevision + 1))

    return true
  }

  async delete(ownerHash: string, id: string): Promise<boolean> {
    const row = this.rankings.get(id)

    if (!row || row.ownerHash !== ownerHash) {
      return false
    }

    return this.rankings.delete(id)
  }

  private row(ownerHash: string, record: RankingRecord, revision: number): MemoryRow {
    this.sequence += 1

    return {
      ...structuredClone(record),
      revision,
      ownerHash,
      updatedAt: new Date(),
      sequence: this.sequence
    }
  }
}
