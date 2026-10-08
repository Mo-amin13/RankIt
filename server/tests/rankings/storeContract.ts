import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import type { RankingState } from "../../src/rankings/engine.js"
import type { RankingRecord, RankingStore } from "../../src/rankings/store.js"

// Every ID and owner the contract uses starts with this, so a shared database
// can be cleaned up afterwards without touching real rankings.
export const CONTRACT_ID_PREFIX = "store-contract-test-"

// The behaviour every RankingStore must have. Each store implementation runs
// this same contract, so they stay interchangeable.
export function describeRankingStore(name: string, createStore: () => RankingStore) {
  function newId(): string {
    return `${CONTRACT_ID_PREFIX}${randomUUID()}`
  }

  function completedState(id: string, title: string): RankingState {
    return {
      id,
      title,
      totalItems: 1,
      decisionsMade: 0,
      status: "completed",
      rankedGroups: [[{ id: `${id}-item`, name: "Only item" }]]
    }
  }

  function record(id: string, title = "Movies"): RankingRecord {
    return { state: completedState(id, title), undoState: null }
  }

  describe(name, () => {
    it("returns undefined for an unknown ranking", async () => {
      expect(await createStore().get(newId(), newId())).toBeUndefined()
    })

    it("returns an inserted ranking at revision 0", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))

      expect(await store.get(owner, r1)).toEqual({ ...record(r1), revision: 0 })
    })

    it("keeps rankings separate", async () => {
      const owner = newId()
      const r1 = newId()
      const r2 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1, "First"))
      await store.insert(owner, r2, record(r2, "Second"))

      expect((await store.get(owner, r1))?.state.title).toBe("First")
      expect((await store.get(owner, r2))?.state.title).toBe("Second")
    })

    it("refuses to insert the same ID twice, even for another owner", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))

      await expect(store.insert(owner, r1, record(r1, "Other"))).rejects.toThrow()
      await expect(store.insert(newId(), r1, record(r1, "Other"))).rejects.toThrow()
      expect((await store.get(owner, r1))?.state.title).toBe("Movies")
    })

    it("updates when the expected revision matches and bumps the revision", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))
      const next: RankingRecord = {
        state: completedState(r1, "Renamed"),
        undoState: completedState(r1, "Movies")
      }

      expect(await store.update(owner, r1, next, 0)).toBe(true)
      expect(await store.get(owner, r1)).toEqual({ ...next, revision: 1 })
      expect(await store.update(owner, r1, record(r1, "Again"), 1)).toBe(true)
      expect((await store.get(owner, r1))?.revision).toBe(2)
    })

    it("rejects an update with an outdated revision and writes nothing", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))
      await store.update(owner, r1, record(r1, "Winner"), 0)

      expect(await store.update(owner, r1, record(r1, "Loser"), 0)).toBe(false)
      expect(await store.get(owner, r1)).toEqual({ ...record(r1, "Winner"), revision: 1 })
    })

    it("rejects an update for an unknown ranking", async () => {
      const owner = newId()
      const missing = newId()
      const store = createStore()

      expect(await store.update(owner, missing, record(missing), 0)).toBe(false)
      expect(await store.get(owner, missing)).toBeUndefined()
    })

    it("does not let callers change stored data without update", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      const original = record(r1)
      await store.insert(owner, r1, original)

      original.state.title = "Changed after insert"
      const read = await store.get(owner, r1)
      if (read) read.state.title = "Changed after get"
      const [listed] = await store.list(owner, 10)
      if (listed) listed.state.title = "Changed after list"

      expect((await store.get(owner, r1))?.state.title).toBe("Movies")
    })

    it("hides another owner's ranking from get, update and delete", async () => {
      const owner = newId()
      const stranger = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))

      expect(await store.get(stranger, r1)).toBeUndefined()
      expect(await store.update(stranger, r1, record(r1, "Hijacked"), 0)).toBe(false)
      expect(await store.delete(stranger, r1)).toBe(false)
      expect(await store.list(stranger, 10)).toEqual([])

      expect(await store.get(owner, r1)).toEqual({ ...record(r1), revision: 0 })
    })

    it("lists only the owner's rankings, most recently changed first", async () => {
      const owner = newId()
      const [a, b, c] = [newId(), newId(), newId()]
      const store = createStore()
      await store.insert(owner, a, record(a, "A"))
      await store.insert(owner, b, record(b, "B"))
      await store.insert(newId(), c, record(c, "Someone else's"))
      await store.update(owner, a, record(a, "A changed"), 0)

      const listed = await store.list(owner, 10)

      expect(listed.map((entry) => entry.id)).toEqual([a, b])
      expect(listed[0].state.title).toBe("A changed")
      expect(listed[0].updatedAt).toBeInstanceOf(Date)
      expect(listed[0].updatedAt.getTime()).toBeGreaterThanOrEqual(listed[1].updatedAt.getTime())
    })

    it("lists at most the requested number of rankings", async () => {
      const owner = newId()
      const store = createStore()
      for (let index = 0; index < 4; index += 1) {
        const id = newId()
        await store.insert(owner, id, record(id, `Ranking ${index}`))
      }

      const listed = await store.list(owner, 3)

      expect(listed.map((entry) => entry.state.title)).toEqual([
        "Ranking 3",
        "Ranking 2",
        "Ranking 1"
      ])
    })

    it("deletes the owner's ranking once", async () => {
      const owner = newId()
      const r1 = newId()
      const store = createStore()
      await store.insert(owner, r1, record(r1))

      expect(await store.delete(owner, r1)).toBe(true)
      expect(await store.get(owner, r1)).toBeUndefined()
      expect(await store.list(owner, 10)).toEqual([])
      expect(await store.delete(owner, r1)).toBe(false)
    })
  })
}
