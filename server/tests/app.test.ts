import request from "supertest"
import { describe, expect, it } from "vitest"

import type {
  ActiveRankingView,
  RankingSummary,
  Choice,
  CompletedRankingView,
  Item,
  RankingView
} from "../../shared/types.js"
import { createApp } from "../src/app.js"
import { OWNER_COOKIE } from "../src/owner.js"
import { RankingService } from "../src/rankings/service.js"
import { InMemoryRankingStore } from "../src/rankings/store.js"

// These tests describe the HTTP contract from AGENTS.md, not the current
// implementation. Each test builds a fresh app with the real service so the
// randomized left/right presentation is exercised too.

// request.agent keeps cookies between requests, like a browser does, so one
// agent is one visitor with one owner cookie.
type Agent = ReturnType<typeof request.agent>

const threeItems = [{ name: "Arrival" }, { name: "Dune" }, { name: "The Matrix" }]

function namedItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `Item ${index + 1}` }))
}

function newAgent(): Agent {
  return request.agent(createApp())
}

async function createRanking(
  agent: Agent,
  items: { name: string; imageUrl?: string }[] = threeItems,
  title = "Movies"
): Promise<ActiveRankingView> {
  const response = await agent.post("/api/rankings").send({ title, items })

  expect(response.status).toBe(201)
  expect(response.body.status).toBe("active")

  return response.body as ActiveRankingView
}

async function choose(
  agent: Agent,
  view: ActiveRankingView,
  choice: Choice
): Promise<RankingView> {
  const response = await agent
    .post(`/api/rankings/${view.id}/choices`)
    .send({ comparisonId: view.comparison.id, choice })

  expect(response.status).toBe(200)

  return response.body as RankingView
}

// Answers every comparison from a hidden preference score (higher is better,
// equal scores are a tie), looking only at what is actually shown on screen.
// This makes the expected result independent of left/right presentation.
async function rankByScore(
  agent: Agent,
  start: ActiveRankingView,
  score: Record<string, number>
): Promise<{ view: CompletedRankingView; decisions: number }> {
  let view: RankingView = start
  let decisions = 0

  while (view.status === "active") {
    const left = score[view.comparison.left.name]
    const right = score[view.comparison.right.name]
    const choice: Choice = left === right ? "tie" : left > right ? "left" : "right"

    view = await choose(agent, view, choice)
    decisions += 1

    if (decisions > 1000) {
      throw new Error("Ranking never completed.")
    }
  }

  return { view, decisions }
}

function groupNames(view: CompletedRankingView): string[][] {
  return view.groups.map((group) => group.map((item) => item.name).sort())
}

function expectSafeError(
  response: request.Response,
  status: number,
  code?: string
) {
  expect(response.status).toBe(status)
  expect(response.headers["content-type"]).toMatch(/application\/json/)
  expect(Object.keys(response.body)).toEqual(["error"])
  expect(Object.keys(response.body.error).sort()).toEqual(["code", "message"])
  expect(typeof response.body.error.code).toBe("string")
  expect(typeof response.body.error.message).toBe("string")
  expect(response.body.error.message).not.toBe("")
  expect(JSON.stringify(response.body)).not.toMatch(/\bat .+:\d+:\d+/)

  if (code) {
    expect(response.body.error.code).toBe(code)
  }
}

// Wire-shape checks: an active view must not carry hidden ranking state.
function expectActiveShape(view: ActiveRankingView) {
  expect(Object.keys(view).sort()).toEqual(
    ["canUndo", "comparison", "id", "progress", "status", "title"].sort()
  )
  expect(Object.keys(view.comparison).sort()).toEqual(["id", "left", "right"])
  expect(Object.keys(view.progress).sort()).toEqual(
    ["decisionsMade", "placedItems", "totalItems"].sort()
  )
  expect(view.comparison.left.id).not.toBe(view.comparison.right.id)

  for (const item of [view.comparison.left, view.comparison.right]) {
    expect(Object.keys(item).every((key) => ["id", "name", "imageUrl"].includes(key))).toBe(
      true
    )
  }
}

function expectCompletedShape(view: CompletedRankingView) {
  expect(Object.keys(view).sort()).toEqual(
    ["canUndo", "groups", "id", "status", "title"].sort()
  )
}

describe("GET /api/health", () => {
  it("reports that the API is up", async () => {
    const response = await newAgent().get("/api/health")

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: "ok" })
  })
})

describe("POST /api/rankings", () => {
  it("creates a ranking and returns only the first blind comparison", async () => {
    const response = await newAgent()
      .post("/api/rankings")
      .send({ title: "  Movies  ", items: threeItems })

    expect(response.status).toBe(201)
    expect(response.headers["content-type"]).toMatch(/application\/json/)

    const view = response.body as ActiveRankingView
    expectActiveShape(view)
    expect(typeof view.id).toBe("string")
    expect(view.title).toBe("Movies")
    expect(view.status).toBe("active")
    expect(view.canUndo).toBe(false)
    expect(view.progress.decisionsMade).toBe(0)
    expect(view.progress.totalItems).toBe(3)

    const shownNames = [view.comparison.left.name, view.comparison.right.name]
    for (const name of shownNames) {
      expect(threeItems.map((item) => item.name)).toContain(name)
    }
  })

  it("assigns server-owned IDs and ignores client-supplied fields", async () => {
    const response = await newAgent()
      .post("/api/rankings")
      .send({
        title: "Movies",
        id: "client-ranking-id",
        status: "completed",
        items: threeItems.map((item, index) => ({
          ...item,
          id: `client-${index}`,
          rank: index,
          score: 100
        }))
      })

    expect(response.status).toBe(201)

    const view = response.body as ActiveRankingView
    expectActiveShape(view)
    expect(view.id).not.toBe("client-ranking-id")
    expect(view.status).toBe("active")
    expect(view.comparison.left.id).not.toMatch(/^client-/)
    expect(view.comparison.right.id).not.toMatch(/^client-/)
  })

  it("gives each ranking its own ID", async () => {
    const agent = newAgent()
    const first = await createRanking(agent)
    const second = await createRanking(agent)

    expect(first.id).not.toBe(second.id)
  })

  it.each([3, 40])("accepts %i items", async (count) => {
    const view = await createRanking(newAgent(), namedItems(count))

    expect(view.progress.totalItems).toBe(count)
  })

  it.each([
    ["a missing title", { items: threeItems }, "INVALID_TITLE"],
    ["a blank title", { title: "   ", items: threeItems }, "INVALID_TITLE"],
    ["a non-string title", { title: 42, items: threeItems }, "INVALID_TITLE"],
    ["missing items", { title: "Movies" }, "INVALID_ITEMS"],
    ["items that are not an array", { title: "Movies", items: "Arrival" }, "INVALID_ITEMS"],
    ["only 2 items", { title: "Movies", items: threeItems.slice(0, 2) }, "INVALID_ITEMS"],
    ["41 items", { title: "Movies", items: namedItems(41) }, "INVALID_ITEMS"],
    [
      "a blank item name",
      { title: "Movies", items: [{ name: "  " }, ...threeItems.slice(1)] },
      "INVALID_ITEM_NAME"
    ],
    [
      "an item without a name",
      { title: "Movies", items: [{}, ...threeItems.slice(1)] },
      "INVALID_ITEM_NAME"
    ],
    [
      "a non-object item",
      { title: "Movies", items: ["Arrival", ...threeItems.slice(1)] },
      "INVALID_ITEM_NAME"
    ],
    [
      "names duplicated after trimming and case normalization",
      { title: "Movies", items: [{ name: "Arrival" }, { name: " ARRIVAL " }, { name: "Dune" }] },
      "DUPLICATE_ITEM_NAME"
    ],
    [
      "an http image URL",
      {
        title: "Movies",
        items: [{ name: "Arrival", imageUrl: "http://example.com/a.jpg" }, ...threeItems.slice(1)]
      },
      "INVALID_IMAGE_URL"
    ],
    [
      "a javascript: image URL",
      {
        title: "Movies",
        items: [{ name: "Arrival", imageUrl: "javascript:alert(1)" }, ...threeItems.slice(1)]
      },
      "INVALID_IMAGE_URL"
    ],
    [
      "an unparseable image URL",
      { title: "Movies", items: [{ name: "Arrival", imageUrl: "not a url" }, ...threeItems.slice(1)] },
      "INVALID_IMAGE_URL"
    ],
    ["a 101-character title", { title: "T".repeat(101), items: threeItems }, "INVALID_TITLE"],
    [
      "a 101-character item name",
      { title: "Movies", items: [{ name: "N".repeat(101) }, ...threeItems.slice(1)] },
      "INVALID_ITEM_NAME"
    ],
    [
      "a non-string image URL",
      { title: "Movies", items: [{ name: "Arrival", imageUrl: 42 }, ...threeItems.slice(1)] },
      "INVALID_IMAGE_URL"
    ]
  ])("rejects %s", async (_label, body, code) => {
    const response = await newAgent().post("/api/rankings").send(body)

    expectSafeError(response, 400, code)
  })

  it("rejects a JSON body that is not an object", async () => {
    const response = await newAgent()
      .post("/api/rankings")
      .set("Content-Type", "application/json")
      .send("[]")

    expectSafeError(response, 400)
  })

  it("rejects malformed JSON with a safe error", async () => {
    const response = await newAgent()
      .post("/api/rankings")
      .set("Content-Type", "application/json")
      .send('{"title": "Movies", "items": [')

    expectSafeError(response, 400, "INVALID_JSON")
  })

  it("accepts 40 items with long image URLs", async () => {
    const imageUrl = `https://images.example.com/${"a".repeat(1500)}.jpg`
    const items = namedItems(40).map((item) => ({ ...item, imageUrl }))

    const response = await newAgent().post("/api/rankings").send({ title: "Big", items })

    expect(response.status).toBe(201)
  })

  it("rejects an oversized body with a safe 413 error", async () => {
    const imageUrl = `https://images.example.com/${"a".repeat(5000)}.jpg`
    const items = namedItems(40).map((item) => ({ ...item, imageUrl }))

    const response = await newAgent().post("/api/rankings").send({ title: "Huge", items })

    expectSafeError(response, 413, "PAYLOAD_TOO_LARGE")
  })
})

describe("POST /api/rankings/:id/choices", () => {
  it("advances by exactly one decision and enables undo", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(5))

    const next = await choose(agent, initial, "left")

    expect(next.status).toBe("active")
    if (next.status !== "active") return

    expectActiveShape(next)
    expect(next.id).toBe(initial.id)
    expect(next.title).toBe(initial.title)
    expect(next.canUndo).toBe(true)
    expect(next.progress.decisionsMade).toBe(1)
    expect(next.progress.totalItems).toBe(5)
    expect(next.comparison.id).not.toBe(initial.comparison.id)
  })

  it.each([
    ["descending", ["E", "D", "C", "B", "A"]],
    ["ascending", ["A", "B", "C", "D", "E"]],
    ["shuffled", ["C", "A", "E", "B", "D"]]
  ])(
    "produces the order the choices describe (%s input)",
    async (_label, names) => {
      // A is most preferred, E least.
      const score: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 }

      // Repeat to cover different random left/right presentations.
      for (let run = 0; run < 10; run += 1) {
        const agent = newAgent()
        const start = await createRanking(agent, names.map((name) => ({ name })))
        const { view } = await rankByScore(agent, start, score)

        expect(groupNames(view)).toEqual([["A"], ["B"], ["C"], ["D"], ["E"]])
      }
    }
  )

  it("groups tied items together and keeps dense order", async () => {
    // Expected groups: [A], [B, C], [D], [E, F, G]
    const score: Record<string, number> = { A: 4, B: 3, C: 3, D: 2, E: 1, F: 1, G: 1 }

    for (let run = 0; run < 10; run += 1) {
      const agent = newAgent()
      const start = await createRanking(
        agent,
        ["F", "B", "A", "G", "D", "C", "E"].map((name) => ({ name }))
      )
      const { view } = await rankByScore(agent, start, score)

      expect(groupNames(view)).toEqual([["A"], ["B", "C"], ["D"], ["E", "F", "G"]])
    }
  })

  it("puts everything in one group when every choice is a tie", async () => {
    const agent = newAgent()
    let view: RankingView = await createRanking(agent, namedItems(6))

    while (view.status === "active") {
      view = await choose(agent, view, "tie")
    }

    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]).toHaveLength(6)
  })

  it("needs far fewer decisions than comparing every pair", async () => {
    const count = 20
    const names = Array.from({ length: count }, (_, index) => `Item ${index + 1}`)
    const score = Object.fromEntries(names.map((name, index) => [name, index]))
    // Binary insertion of item k into k already-placed items needs at most
    // ceil(log2(k + 1)) decisions.
    let bound = 0
    for (let k = 1; k < count; k += 1) bound += Math.ceil(Math.log2(k + 1))

    const agent = newAgent()
    const start = await createRanking(agent, names.map((name) => ({ name })))
    const { view, decisions } = await rankByScore(agent, start, score)

    expect(decisions).toBeLessThanOrEqual(bound)
    expect(decisions).toBeLessThan((count * (count - 1)) / 2)
    expect(view.groups.flat()).toHaveLength(count)
  })

  it("keeps progress non-decreasing and within bounds while ranking", async () => {
    const agent = newAgent()
    let view: RankingView = await createRanking(agent, namedItems(8))
    let lastPlaced = 0
    let decisions = 0

    while (view.status === "active") {
      expectActiveShape(view)
      expect(view.progress.decisionsMade).toBe(decisions)
      expect(view.progress.totalItems).toBe(8)
      expect(view.progress.placedItems).toBeGreaterThanOrEqual(lastPlaced)
      expect(view.progress.placedItems).toBeLessThan(8)
      lastPlaced = view.progress.placedItems

      view = await choose(agent, view, "right")
      decisions += 1
    }
  })

  it("returns a completed view with every item exactly once and no active state", async () => {
    const agent = newAgent()
    const items = [
      { name: "  Arrival  ", imageUrl: "  https://example.com/arrival.jpg  " },
      { name: "Dune", imageUrl: "   " },
      { name: "The Matrix" },
      { name: "Heat" }
    ]
    const start = await createRanking(agent, items, "  Films  ")
    const score: Record<string, number> = { Arrival: 4, Dune: 3, "The Matrix": 2, Heat: 1 }
    const { view } = await rankByScore(agent, start, score)

    expectCompletedShape(view)
    expect(view.id).toBe(start.id)
    expect(view.title).toBe("Films")
    expect(view.canUndo).toBe(true)

    const all: Item[] = view.groups.flat()
    expect(all.map((item) => item.name).sort()).toEqual(
      ["Arrival", "Dune", "Heat", "The Matrix"].sort()
    )
    expect(new Set(all.map((item) => item.id)).size).toBe(4)

    const arrival = all.find((item) => item.name === "Arrival")
    const dune = all.find((item) => item.name === "Dune")
    expect(arrival?.imageUrl).toBe("https://example.com/arrival.jpg")
    expect(dune && "imageUrl" in dune).toBe(false)
  })

  it("preserves the creator's display casing", async () => {
    const agent = newAgent()
    const start = await createRanking(agent, [
      { name: "iPhone" },
      { name: "MacBook" },
      { name: "AirPods" }
    ])
    const score: Record<string, number> = { iPhone: 3, MacBook: 2, AirPods: 1 }
    const { view } = await rankByScore(agent, start, score)

    expect(groupNames(view)).toEqual([["iPhone"], ["MacBook"], ["AirPods"]])
  })

  it("rejects a stale comparison ID without changing state", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(5))

    const stale = await agent
      .post(`/api/rankings/${initial.id}/choices`)
      .send({ comparisonId: "not-the-current-comparison", choice: "left" })
    expectSafeError(stale, 409, "STALE_COMPARISON")

    const accepted = await choose(agent, initial, "left")
    expect(accepted.status === "active" && accepted.progress.decisionsMade).toBe(1)
  })

  it("does not apply a duplicate submission twice", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(5))
    const body = { comparisonId: initial.comparison.id, choice: "left" }

    const first = await agent.post(`/api/rankings/${initial.id}/choices`).send(body)
    const second = await agent.post(`/api/rankings/${initial.id}/choices`).send(body)

    expect(first.status).toBe(200)
    expectSafeError(second, 409, "STALE_COMPARISON")

    // State is still one decision in: undo goes straight back to the start.
    const undone = await agent.post(`/api/rankings/${initial.id}/undo`)
    expect(undone.status).toBe(200)
    expect(undone.body.comparison).toEqual(initial.comparison)
  })

  it.each([
    ["an unknown choice", (comparisonId: string) => ({ comparisonId, choice: "up" })],
    ["a missing choice", (comparisonId: string) => ({ comparisonId })],
    ["a non-string choice", (comparisonId: string) => ({ comparisonId, choice: 1 })],
    ["a missing comparison ID", () => ({ choice: "left" })],
    ["a non-string comparison ID", () => ({ comparisonId: 42, choice: "left" })]
  ])("rejects %s without changing state", async (_label, makeBody) => {
    const agent = newAgent()
    const initial = await createRanking(agent)

    const response = await agent
      .post(`/api/rankings/${initial.id}/choices`)
      .send(makeBody(initial.comparison.id))
    expectSafeError(response, 400, "INVALID_CHOICE")

    const undo = await agent.post(`/api/rankings/${initial.id}/undo`)
    expectSafeError(undo, 409, "NOTHING_TO_UNDO")
  })

  it("rejects malformed JSON with a safe error", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent)

    const response = await agent
      .post(`/api/rankings/${initial.id}/choices`)
      .set("Content-Type", "application/json")
      .send("{choice:")

    expectSafeError(response, 400, "INVALID_JSON")
  })

  it("returns 404 for an unknown ranking", async () => {
    const response = await newAgent()
      .post("/api/rankings/does-not-exist/choices")
      .send({ comparisonId: "anything", choice: "left" })

    expectSafeError(response, 404, "RANKING_NOT_FOUND")
  })

  it("rejects choices once the ranking is complete", async () => {
    const agent = newAgent()
    const start = await createRanking(agent)
    const { view } = await rankByScore(agent, start, { Arrival: 3, Dune: 2, "The Matrix": 1 })

    const response = await agent
      .post(`/api/rankings/${view.id}/choices`)
      .send({ comparisonId: start.comparison.id, choice: "left" })

    expectSafeError(response, 409, "RANKING_COMPLETED")
  })

  it("keeps rankings independent of each other", async () => {
    const agent = newAgent()
    const first = await createRanking(agent)
    const second = await createRanking(agent)

    const crossed = await agent
      .post(`/api/rankings/${second.id}/choices`)
      .send({ comparisonId: first.comparison.id, choice: "left" })
    expectSafeError(crossed, 409, "STALE_COMPARISON")

    await choose(agent, first, "left")
    const secondUndo = await agent.post(`/api/rankings/${second.id}/undo`)
    expectSafeError(secondUndo, 409, "NOTHING_TO_UNDO")
  })
})

describe("POST /api/rankings/:id/undo", () => {
  it("refuses to undo before any choice", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent)

    const response = await agent.post(`/api/rankings/${initial.id}/undo`)

    expectSafeError(response, 409, "NOTHING_TO_UNDO")
  })

  it("restores the exact previous comparison, including left/right order", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(6))
    const second = await choose(agent, initial, "left")
    if (second.status !== "active") throw new Error("Expected an active ranking.")
    await choose(agent, second, "right")

    const response = await agent.post(`/api/rankings/${initial.id}/undo`)

    expect(response.status).toBe(200)
    const restored = response.body as ActiveRankingView
    expectActiveShape(restored)
    expect(restored.comparison).toEqual(second.comparison)
    expect(restored.progress).toEqual(second.progress)
    expect(restored.title).toBe(second.title)
  })

  it("only undoes one level", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(6))
    const second = await choose(agent, initial, "left")
    if (second.status !== "active") throw new Error("Expected an active ranking.")
    await choose(agent, second, "left")

    const firstUndo = await agent.post(`/api/rankings/${initial.id}/undo`)
    expect(firstUndo.status).toBe(200)
    expect(firstUndo.body.canUndo).toBe(false)

    const secondUndo = await agent.post(`/api/rankings/${initial.id}/undo`)
    expectSafeError(secondUndo, 409, "NOTHING_TO_UNDO")
  })

  it("makes the undone comparison stale and the restored one current", async () => {
    const agent = newAgent()
    const initial = await createRanking(agent, namedItems(5))
    const next = await choose(agent, initial, "left")
    if (next.status !== "active") throw new Error("Expected an active ranking.")

    await agent.post(`/api/rankings/${initial.id}/undo`)

    const staleAfterUndo = await agent
      .post(`/api/rankings/${initial.id}/choices`)
      .send({ comparisonId: next.comparison.id, choice: "left" })
    expectSafeError(staleAfterUndo, 409, "STALE_COMPARISON")

    const replayed = await choose(agent, initial, "right")
    expect(replayed.status === "active" && replayed.progress.decisionsMade).toBe(1)
  })

  it("reopens a completed ranking at its last comparison", async () => {
    const agent = newAgent()
    const score: Record<string, number> = { Arrival: 3, Dune: 2, "The Matrix": 1 }
    let view: RankingView = await createRanking(agent)
    let lastActive = view

    while (view.status === "active") {
      lastActive = view
      const left = score[view.comparison.left.name]
      const right = score[view.comparison.right.name]
      view = await choose(agent, view, left > right ? "left" : "right")
    }

    const response = await agent.post(`/api/rankings/${view.id}/undo`)

    expect(response.status).toBe(200)
    expect(response.body.status).toBe("active")
    expectActiveShape(response.body)
    expect(response.body.comparison).toEqual(lastActive.comparison)
  })

  it("lets a corrected answer change the final result", async () => {
    const agent = newAgent()
    const start = await createRanking(agent)
    const score: Record<string, number> = { Arrival: 3, Dune: 2, "The Matrix": 1 }

    // Answer the first comparison against the preference, then undo it.
    const left = score[start.comparison.left.name]
    const right = score[start.comparison.right.name]
    await choose(agent, start, left > right ? "right" : "left")
    const undone = await agent.post(`/api/rankings/${start.id}/undo`)
    expect(undone.status).toBe(200)

    const { view } = await rankByScore(agent, undone.body as ActiveRankingView, score)

    expect(groupNames(view)).toEqual([["Arrival"], ["Dune"], ["The Matrix"]])
  })

  it("returns 404 for an unknown ranking", async () => {
    const response = await newAgent().post("/api/rankings/does-not-exist/undo")

    expectSafeError(response, 404, "RANKING_NOT_FOUND")
  })
})

function ownerCookie(response: request.Response): string | undefined {
  const cookies = response.headers["set-cookie"] as unknown as string[] | undefined

  return cookies?.find((cookie) => cookie.startsWith(`${OWNER_COOKIE}=`))
}

function ownerToken(response: request.Response): string {
  return /^[^=]+=([^;]*)/.exec(ownerCookie(response) ?? "")?.[1] ?? ""
}

async function completeRanking(agent: Agent, view: ActiveRankingView) {
  let current: RankingView = view
  while (current.status === "active") {
    current = await choose(agent, current, "tie")
  }
  return current
}

describe("owner cookie", () => {
  it("gives a new visitor a long random HttpOnly, SameSite=Lax cookie", async () => {
    const response = await newAgent().post("/api/rankings").send({ title: "Movies", items: threeItems })

    const cookie = ownerCookie(response) ?? ""
    expect(ownerToken(response)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookie).toMatch(/;\s*HttpOnly/i)
    expect(cookie).toMatch(/;\s*SameSite=Lax/i)
    expect(cookie).toMatch(/;\s*Path=\//i)
    expect(cookie).not.toMatch(/;\s*Secure/i)

    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1])
    expect(maxAge).toBeGreaterThanOrEqual(300 * 24 * 60 * 60)
    expect(maxAge).toBeLessThanOrEqual(400 * 24 * 60 * 60)
  })

  it("marks the cookie Secure when secure cookies are enabled", async () => {
    const response = await request(createApp(undefined, { secureCookies: true })).get(
      "/api/rankings"
    )

    expect(ownerCookie(response)).toMatch(/;\s*Secure/i)
  })

  it("keeps the same cookie value for a returning visitor", async () => {
    const agent = newAgent()
    const first = await agent.get("/api/rankings")
    const second = await agent.get("/api/rankings")

    expect(ownerToken(second)).toBe(ownerToken(first))
  })

  it("gives different visitors different cookies", async () => {
    const app = createApp()
    const first = await request(app).get("/api/rankings")
    const second = await request(app).get("/api/rankings")

    expect(ownerToken(first)).not.toBe(ownerToken(second))
  })

  it("replaces a cookie value the server could not have issued", async () => {
    const response = await request(createApp())
      .get("/api/rankings")
      .set("Cookie", `${OWNER_COOKIE}=not-a-real-token`)

    expect(ownerToken(response)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("is not set by the health check", async () => {
    const response = await newAgent().get("/api/health")

    expect(ownerCookie(response)).toBeUndefined()
  })
})

describe("rankings belong to the browser that created them", () => {
  it("hides a ranking from every other visitor", async () => {
    const app = createApp()
    const owner = request.agent(app)
    const stranger = request.agent(app)
    const view = await createRanking(owner)

    expectSafeError(await stranger.get(`/api/rankings/${view.id}`), 404, "RANKING_NOT_FOUND")
    expectSafeError(
      await stranger
        .post(`/api/rankings/${view.id}/choices`)
        .send({ comparisonId: view.comparison.id, choice: "left" }),
      404,
      "RANKING_NOT_FOUND"
    )
    expectSafeError(await stranger.post(`/api/rankings/${view.id}/undo`), 404, "RANKING_NOT_FOUND")
    expectSafeError(await stranger.delete(`/api/rankings/${view.id}`), 404, "RANKING_NOT_FOUND")
    expect((await stranger.get("/api/rankings")).body).toEqual({ rankings: [] })

    // Nothing the stranger did changed the owner's ranking.
    expect((await owner.get(`/api/rankings/${view.id}`)).body).toEqual(view)
  })

  it("rejects requests that carry no cookie at all", async () => {
    const app = createApp()
    const view = await createRanking(request.agent(app))

    const response = await request(app)
      .post(`/api/rankings/${view.id}/choices`)
      .send({ comparisonId: view.comparison.id, choice: "left" })

    expectSafeError(response, 404, "RANKING_NOT_FOUND")
  })

  it("gives access to anyone holding the same cookie value", async () => {
    const app = createApp()
    const created = await request(app).post("/api/rankings").send({ title: "Movies", items: threeItems })
    const cookie = `${OWNER_COOKIE}=${ownerToken(created)}`

    const response = await request(app).get(`/api/rankings/${created.body.id}`).set("Cookie", cookie)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(created.body)
  })
})

describe("GET /api/rankings", () => {
  it("returns an empty list for a new visitor", async () => {
    const response = await newAgent().get("/api/rankings")

    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toMatch(/application\/json/)
    expect(response.body).toEqual({ rankings: [] })
  })

  it("lists the visitor's rankings as summaries, most recently changed first", async () => {
    const agent = newAgent()
    const older = await createRanking(agent, namedItems(5), "Older")
    const newer = await createRanking(agent, namedItems(4), "Newer")
    await choose(agent, older, "left")

    const response = await agent.get("/api/rankings")

    expect(response.status).toBe(200)
    expect(Object.keys(response.body)).toEqual(["rankings"])
    const rankings = response.body.rankings as RankingSummary[]
    expect(rankings.map((ranking) => ranking.id)).toEqual([older.id, newer.id])
    for (const ranking of rankings) {
      expect(Object.keys(ranking).sort()).toEqual(
        ["id", "itemCount", "placedItems", "status", "title", "updatedAt"].sort()
      )
      expect(Number.isNaN(Date.parse(ranking.updatedAt))).toBe(false)
    }
    expect(rankings[0]).toMatchObject({ title: "Older", status: "active", itemCount: 5 })
    expect(rankings[1]).toMatchObject({ title: "Newer", status: "active", itemCount: 4 })
    expect(rankings[0].placedItems).toBeGreaterThanOrEqual(1)
    expect(rankings[0].placedItems).toBeLessThan(5)
  })

  it("never includes item names or order, even for finished rankings", async () => {
    const agent = newAgent()
    const items = [{ name: "Zebra Unique" }, { name: "Quokka Unique" }, { name: "Narwhal Unique" }]
    const active = await createRanking(agent, items, "Active one")
    const finished = await createRanking(agent, items, "Finished one")
    await completeRanking(agent, finished)
    await choose(agent, active, "left")

    const response = await agent.get("/api/rankings")
    const text = JSON.stringify(response.body)

    for (const item of items) {
      expect(text).not.toContain(item.name)
    }
    expect(text).not.toMatch(/groups|comparison|rankedGroups|remainingItems/)
    expect(response.body.rankings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Finished one", status: "completed", placedItems: 3, itemCount: 3 })
      ])
    )
  })
})

describe("GET /api/rankings/:id", () => {
  it("returns exactly the view the last change returned, so a reload resumes in place", async () => {
    const agent = newAgent()
    const created = await createRanking(agent, namedItems(5))
    expect((await agent.get(`/api/rankings/${created.id}`)).body).toEqual(created)

    const answered = await choose(agent, created, "left")
    expect((await agent.get(`/api/rankings/${created.id}`)).body).toEqual(answered)

    const undone = await agent.post(`/api/rankings/${created.id}/undo`)
    expect((await agent.get(`/api/rankings/${created.id}`)).body).toEqual(undone.body)
  })

  it("returns the results of a completed ranking", async () => {
    const agent = newAgent()
    const created = await createRanking(agent)
    const completed = await completeRanking(agent, created)

    const response = await agent.get(`/api/rankings/${created.id}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(completed)
  })

  it("returns 404 for an unknown ranking", async () => {
    expectSafeError(await newAgent().get("/api/rankings/does-not-exist"), 404, "RANKING_NOT_FOUND")
  })
})

describe("DELETE /api/rankings/:id", () => {
  it("removes the ranking for good", async () => {
    const agent = newAgent()
    const view = await createRanking(agent)

    const response = await agent.delete(`/api/rankings/${view.id}`)

    expect(response.status).toBe(204)
    expect(response.text).toBe("")
    expectSafeError(await agent.get(`/api/rankings/${view.id}`), 404, "RANKING_NOT_FOUND")
    expectSafeError(
      await agent
        .post(`/api/rankings/${view.id}/choices`)
        .send({ comparisonId: view.comparison.id, choice: "left" }),
      404,
      "RANKING_NOT_FOUND"
    )
    expect((await agent.get("/api/rankings")).body).toEqual({ rankings: [] })
    expectSafeError(await agent.delete(`/api/rankings/${view.id}`), 404, "RANKING_NOT_FOUND")
  })

  it("leaves the visitor's other rankings alone", async () => {
    const agent = newAgent()
    const keep = await createRanking(agent, threeItems, "Keep")
    const remove = await createRanking(agent, threeItems, "Remove")

    await agent.delete(`/api/rankings/${remove.id}`)

    const rankings = (await agent.get("/api/rankings")).body.rankings as RankingSummary[]
    expect(rankings.map((ranking) => ranking.id)).toEqual([keep.id])
  })

  it("returns 404 for an unknown ranking", async () => {
    expectSafeError(await newAgent().delete("/api/rankings/does-not-exist"), 404, "RANKING_NOT_FOUND")
  })
})

describe("storage failures", () => {
  class FailingStore extends InMemoryRankingStore {
    override async get(): Promise<undefined> {
      throw new Error("connection refused at db.internal:5432")
    }

    override async insert(): Promise<void> {
      throw new Error("connection refused at db.internal:5432")
    }
  }

  it.each([
    ["creating", (agent: Agent) => agent.post("/api/rankings").send({ title: "Movies", items: threeItems })],
    [
      "choosing",
      (agent: Agent) =>
        agent.post("/api/rankings/some-id/choices").send({ comparisonId: "c", choice: "left" })
    ],
    ["undoing", (agent: Agent) => agent.post("/api/rankings/some-id/undo")]
  ])("returns a safe 500 when %s fails in storage", async (_label, send) => {
    const agent = request.agent(createApp(new RankingService(new FailingStore())))

    const response = await send(agent)

    expectSafeError(response, 500, "INTERNAL_ERROR")
    expect(JSON.stringify(response.body)).not.toContain("db.internal")
  })
})

describe("unknown routes", () => {
  it.each([
    ["GET", "/api/does-not-exist"],
    ["PUT", "/api/rankings"],
    ["PATCH", "/api/rankings/some-id"],
    ["GET", "/api/rankings/some-id/choices"]
  ])("%s %s returns a safe JSON 404", async (method, path) => {
    const agent = newAgent()
    const response =
      method === "GET"
        ? await agent.get(path)
        : method === "PUT"
          ? await agent.put(path)
          : await agent.patch(path)

    expectSafeError(response, 404)
  })
})
