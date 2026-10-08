import { describe, expect, it } from "vitest"

import type { ActiveRankingView } from "../../../shared/types.js"
import { RankingService } from "../../src/rankings/service.js"
import { InMemoryRankingStore } from "../../src/rankings/store.js"

const OWNER = "owner-a"
const STRANGER = "owner-b"

function createService() {
  let id = 0

  return new RankingService(new InMemoryRankingStore(), {
    createId: () => `id-${++id}`,
    random: () => 0
  })
}

async function createActive(service: RankingService): Promise<ActiveRankingView> {
  const view = await service.create(OWNER, {
    title: "Movies",
    items: [{ name: "Arrival" }, { name: "Dune" }, { name: "The Matrix" }, { name: "Heat" }]
  })

  if (view.status !== "active") {
    throw new Error("Expected an active ranking.")
  }

  return view
}

describe("RankingService", () => {
  it("rejects stale comparisons and restores the exact previous view on undo", async () => {
    const service = createService()
    const initial = await service.create(OWNER, {
      title: "Movies",
      items: [{ name: "Arrival" }, { name: "Dune" }, { name: "The Matrix" }]
    })

    expect(initial.status).toBe("active")

    if (initial.status !== "active") {
      throw new Error("Expected an active ranking.")
    }

    expect(await service.answer(OWNER, initial.id, "stale-id", "left")).toMatchObject({
      ok: false,
      error: { status: 409, code: "STALE_COMPARISON" }
    })

    const answered = await service.answer(OWNER, initial.id, initial.comparison.id, "left")
    expect(answered).toMatchObject({ ok: true })

    const duplicateSubmission = await service.answer(OWNER, initial.id, initial.comparison.id, "left")
    expect(duplicateSubmission).toMatchObject({
      ok: false,
      error: { status: 409, code: "STALE_COMPARISON" }
    })

    const undone = await service.undo(OWNER, initial.id)
    expect(undone).toEqual({ ok: true, value: initial })
    expect(await service.undo(OWNER, initial.id)).toMatchObject({
      ok: false,
      error: { status: 409, code: "NOTHING_TO_UNDO" }
    })
  })

  it("returns safe missing-ranking errors", async () => {
    const service = createService()

    expect(await service.answer(OWNER, "missing", "comparison", "tie")).toMatchObject({
      ok: false,
      error: { status: 404, code: "RANKING_NOT_FOUND" }
    })
    expect(await service.undo(OWNER, "missing")).toMatchObject({
      ok: false,
      error: { status: 404, code: "RANKING_NOT_FOUND" }
    })
  })

  it("persists every change through the store", async () => {
    const store = new InMemoryRankingStore()
    const service = new RankingService(store)
    const initial = await createActive(service)

    const afterCreate = await store.get(OWNER, initial.id)
    expect(afterCreate?.undoState).toBeNull()

    await service.answer(OWNER, initial.id, initial.comparison.id, "left")
    const afterAnswer = await store.get(OWNER, initial.id)
    expect(afterAnswer?.state.decisionsMade).toBe(1)
    expect(afterAnswer?.undoState?.decisionsMade).toBe(0)
    expect(afterAnswer?.revision).toBe((afterCreate?.revision ?? 0) + 1)

    await service.undo(OWNER, initial.id)
    const afterUndo = await store.get(OWNER, initial.id)
    expect(afterUndo?.state.decisionsMade).toBe(0)
    expect(afterUndo?.undoState).toBeNull()
  })

  // Requests overlap once the service awaits a store. These start both calls
  // before either finishes, so both read the same state.
  it("accepts only one of two simultaneous submissions of the same comparison", async () => {
    const service = createService()
    const initial = await createActive(service)

    const results = await Promise.all([
      service.answer(OWNER, initial.id, initial.comparison.id, "left"),
      service.answer(OWNER, initial.id, initial.comparison.id, "right")
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { status: 409, code: "STALE_COMPARISON" }
    })

    // Only one decision was applied: a single undo returns to the start.
    expect(await service.undo(OWNER, initial.id)).toEqual({ ok: true, value: initial })
    expect(await service.undo(OWNER, initial.id)).toMatchObject({
      ok: false,
      error: { code: "NOTHING_TO_UNDO" }
    })
  })

  it("applies only one of two simultaneous undos", async () => {
    const service = createService()
    const initial = await createActive(service)
    await service.answer(OWNER, initial.id, initial.comparison.id, "left")

    const results = await Promise.all([
      service.undo(OWNER, initial.id),
      service.undo(OWNER, initial.id)
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({
      ok: false,
      error: { status: 409, code: "NOTHING_TO_UNDO" }
    })
  })

  it("lets many simultaneous submissions advance the ranking exactly once", async () => {
    const service = createService()
    const initial = await createActive(service)

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        service.answer(OWNER, initial.id, initial.comparison.id, "tie")
      )
    )

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    const accepted = results.find((result) => result.ok)
    expect(
      accepted?.ok && accepted.value.status === "active" && accepted.value.progress.decisionsMade
    ).toBe(1)
  })

  it("returns the current view, exactly as the last change returned it", async () => {
    const service = createService()
    const initial = await createActive(service)
    expect(await service.get(OWNER, initial.id)).toEqual({ ok: true, value: initial })

    const answered = await service.answer(OWNER, initial.id, initial.comparison.id, "left")
    expect(await service.get(OWNER, initial.id)).toEqual(answered)

    const undone = await service.undo(OWNER, initial.id)
    expect(await service.get(OWNER, initial.id)).toEqual(undone)
  })

  it("treats another owner's ranking as missing", async () => {
    const service = createService()
    const initial = await createActive(service)
    const notFound = { ok: false, error: { status: 404, code: "RANKING_NOT_FOUND" } }

    expect(await service.get(STRANGER, initial.id)).toMatchObject(notFound)
    expect(
      await service.answer(STRANGER, initial.id, initial.comparison.id, "left")
    ).toMatchObject(notFound)
    expect(await service.undo(STRANGER, initial.id)).toMatchObject(notFound)
    expect(await service.delete(STRANGER, initial.id)).toBe(false)
    expect(await service.list(STRANGER)).toEqual([])

    expect(await service.get(OWNER, initial.id)).toEqual({ ok: true, value: initial })
  })

  it("lists summaries without revealing any order", async () => {
    const service = createService()
    const active = await createActive(service)
    await service.answer(OWNER, active.id, active.comparison.id, "left")

    const summaries = await service.list(OWNER)

    expect(summaries).toHaveLength(1)
    expect(Object.keys(summaries[0]).sort()).toEqual(
      ["id", "itemCount", "placedItems", "status", "title", "updatedAt"].sort()
    )
    expect(summaries[0]).toMatchObject({
      id: active.id,
      title: "Movies",
      status: "active",
      itemCount: 4
    })
    expect(new Date(summaries[0].updatedAt).toISOString()).toBe(summaries[0].updatedAt)
  })

  it("reports a completed ranking as fully placed", async () => {
    const service = createService()
    let view = await service.create(OWNER, {
      title: "Done",
      items: [{ name: "A" }, { name: "B" }, { name: "C" }]
    })
    while (view.status === "active") {
      const result = await service.answer(OWNER, view.id, view.comparison.id, "tie")
      if (!result.ok) throw new Error("Expected the choice to be accepted.")
      view = result.value
    }

    expect(await service.list(OWNER)).toMatchObject([
      { id: view.id, status: "completed", itemCount: 3, placedItems: 3 }
    ])
  })

  it("deletes a ranking for its owner only once", async () => {
    const service = createService()
    const initial = await createActive(service)

    expect(await service.delete(OWNER, initial.id)).toBe(true)
    expect(await service.get(OWNER, initial.id)).toMatchObject({
      ok: false,
      error: { status: 404 }
    })
    expect(await service.delete(OWNER, initial.id)).toBe(false)
    expect(await service.list(OWNER)).toEqual([])
  })
})
