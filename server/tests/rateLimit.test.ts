import request from "supertest"
import { describe, expect, it } from "vitest"

import type { ActiveRankingView, RankingView } from "../../shared/types.js"
import { createApp } from "../src/app.js"
import { OWNER_COOKIE } from "../src/owner.js"
import { RankingService } from "../src/rankings/service.js"

// These tests describe the rate-limiting contract, not the current
// implementation. Every test builds its own app(s) so counters start fresh.
// All supertest requests to one app come from the same client IP.

type Agent = ReturnType<typeof request.agent>
type RateLimits = { windowMs?: number; create?: number; actions?: number; reads?: number }

// Rankings belong to the browser (owner cookie) that created them. Some tests
// below use several apps over one shared service to stand for one person, so
// every agent sends the same owner cookie.
const SAME_VISITOR = `${OWNER_COOKIE}=${"v".repeat(43)}`

function client(app: ReturnType<typeof createApp>): Agent {
  return request.agent(app).set("Cookie", SAME_VISITOR)
}

const threeItems = [{ name: "Arrival" }, { name: "Dune" }, { name: "The Matrix" }]
const validBody = { title: "Movies", items: threeItems }

function namedItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({ name: `Item ${index + 1}` }))
}

function limitedAgent(rateLimits: RateLimits, service?: RankingService): Agent {
  return client(createApp(service, { rateLimits }))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sleepUntil(timestamp: number) {
  await sleep(Math.max(0, timestamp - Date.now()))
}

function postCreate(agent: Agent, body: unknown = validBody) {
  return agent.post("/api/rankings").send(body as object)
}

function postChoice(agent: Agent, rankingId: string, body: unknown) {
  return agent.post(`/api/rankings/${rankingId}/choices`).send(body as object)
}

function postUndo(agent: Agent, rankingId: string) {
  return agent.post(`/api/rankings/${rankingId}/undo`)
}

async function createRanking(
  agent: Agent,
  items: { name: string }[] = namedItems(5)
): Promise<ActiveRankingView> {
  const response = await postCreate(agent, { title: "Movies", items })

  expect(response.status).toBe(201)
  expect(response.body.status).toBe("active")

  return response.body as ActiveRankingView
}

function expectRateLimited(response: request.Response) {
  expect(response.status).toBe(429)
  expect(response.headers["content-type"]).toMatch(/application\/json/)
  expect(Object.keys(response.body)).toEqual(["error"])
  expect(Object.keys(response.body.error).sort()).toEqual(["code", "message"])
  expect(response.body.error.code).toBe("RATE_LIMITED")
  expect(typeof response.body.error.message).toBe("string")
  expect(response.body.error.message).not.toBe("")
  expect(JSON.stringify(response.body)).not.toMatch(/\bat .+:\d+:\d+/)

  const retryAfter = response.headers["retry-after"]
  expect(retryAfter).toBeDefined()
  expect(String(retryAfter)).toMatch(/^\d+$/)
  expect(Number(retryAfter)).toBeGreaterThan(0)
}

describe("create limit", () => {
  it("handles the first N creates normally and rejects N+1 and later", async () => {
    const agent = limitedAgent({ create: 3 })

    for (let index = 0; index < 3; index += 1) {
      const response = await postCreate(agent)
      expect(response.status).toBe(201)
    }

    for (let index = 0; index < 3; index += 1) {
      expectRateLimited(await postCreate(agent))
    }
  })

  it("defaults to 10 creates per window", async () => {
    const agent = client(createApp())

    for (let index = 0; index < 10; index += 1) {
      const response = await postCreate(agent)
      expect(response.status).toBe(201)
    }

    expectRateLimited(await postCreate(agent))
  })

  it.each([
    ["undefined service and empty options", () => createApp(undefined, {})],
    ["a service and empty rateLimits", () => createApp(new RankingService(), { rateLimits: {} })],
    ["only actions overridden", () => createApp(undefined, { rateLimits: { actions: 1 } })],
    ["only windowMs overridden", () => createApp(undefined, { rateLimits: { windowMs: 60_000 } })]
  ])("uses the default create limit with %s", async (_label, makeApp) => {
    const agent = client(makeApp())

    for (let index = 0; index < 10; index += 1) {
      const response = await postCreate(agent)
      expect(response.status).toBe(201)
    }

    expectRateLimited(await postCreate(agent))
  })

  it.each([
    ["a successful create", 201, (agent: Agent) => postCreate(agent)],
    [
      "a validation error",
      400,
      (agent: Agent) => postCreate(agent, { title: "   ", items: threeItems })
    ],
    [
      "malformed JSON",
      400,
      (agent: Agent) =>
        agent
          .post("/api/rankings")
          .set("Content-Type", "application/json")
          .send('{"title": "Movies", "items": [')
    ],
    [
      "a non-object JSON body",
      400,
      (agent: Agent) =>
        agent.post("/api/rankings").set("Content-Type", "application/json").send("[]")
    ],
    [
      "an oversized body",
      413,
      (agent: Agent) => {
        const imageUrl = `https://images.example.com/${"a".repeat(5000)}.jpg`
        const items = namedItems(40).map((item) => ({ ...item, imageUrl }))
        return postCreate(agent, { title: "Huge", items })
      }
    ]
  ])("counts %s toward the create limit", async (_label, status, send) => {
    const agent = limitedAgent({ create: 1 })

    const first = await send(agent)
    expect(first.status).toBe(status)

    expectRateLimited(await postCreate(agent))
  })

  it("returns 429 instead of a validation or JSON error once over the limit", async () => {
    const agent = limitedAgent({ create: 1 })
    expect((await postCreate(agent)).status).toBe(201)

    expectRateLimited(await postCreate(agent, { title: "   ", items: threeItems }))
    expectRateLimited(
      await agent
        .post("/api/rankings")
        .set("Content-Type", "application/json")
        .send('{"title": "Movies", "items": [')
    )
  })
})

describe("actions limit", () => {
  it("handles the first N actions normally and rejects N+1 and later", async () => {
    const agent = limitedAgent({ actions: 3 })

    for (let index = 0; index < 3; index += 1) {
      const response = await postUndo(agent, "does-not-exist")
      expect(response.status).toBe(404)
    }

    for (let index = 0; index < 3; index += 1) {
      expectRateLimited(await postUndo(agent, "does-not-exist"))
    }
    expectRateLimited(
      await postChoice(agent, "does-not-exist", { comparisonId: "anything", choice: "left" })
    )
  })

  it("defaults to 120 actions per window", async () => {
    const agent = client(createApp())

    for (let index = 0; index < 120; index += 1) {
      const response =
        index % 2 === 0
          ? await postUndo(agent, "does-not-exist")
          : await postChoice(agent, "does-not-exist", { comparisonId: "x", choice: "left" })
      expect(response.status).toBe(404)
    }

    expectRateLimited(await postUndo(agent, "does-not-exist"))
  })

  it("uses the default actions limit when only create is overridden", async () => {
    const agent = limitedAgent({ create: 1 })

    for (let index = 0; index < 120; index += 1) {
      const response = await postUndo(agent, "does-not-exist")
      expect(response.status).toBe(404)
    }

    expectRateLimited(await postUndo(agent, "does-not-exist"))
  })

  // Each case prepares state through an unlimited app that shares the service,
  // then sends exactly one request through an app limited to one action.
  it.each([
    [
      "an accepted choice",
      200,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        return postChoice(limited, view.id, { comparisonId: view.comparison.id, choice: "left" })
      }
    ],
    [
      "an invalid choice body",
      400,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        return postChoice(limited, view.id, { comparisonId: view.comparison.id, choice: "up" })
      }
    ],
    [
      "a choice for an unknown ranking",
      404,
      async (_setup: Agent, limited: Agent) =>
        postChoice(limited, "does-not-exist", { comparisonId: "anything", choice: "left" })
    ],
    [
      "a stale choice",
      409,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        return postChoice(limited, view.id, { comparisonId: "not-current", choice: "left" })
      }
    ],
    [
      "a choice with malformed JSON",
      400,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        return limited
          .post(`/api/rankings/${view.id}/choices`)
          .set("Content-Type", "application/json")
          .send("{choice:")
      }
    ],
    [
      "an accepted undo",
      200,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        const chosen = await postChoice(setup, view.id, {
          comparisonId: view.comparison.id,
          choice: "left"
        })
        expect(chosen.status).toBe(200)
        return postUndo(limited, view.id)
      }
    ],
    [
      "an undo with nothing to undo",
      409,
      async (setup: Agent, limited: Agent) => {
        const view = await createRanking(setup)
        return postUndo(limited, view.id)
      }
    ],
    [
      "an undo for an unknown ranking",
      404,
      async (_setup: Agent, limited: Agent) => postUndo(limited, "does-not-exist")
    ]
  ])("counts %s toward the actions limit", async (_label, status, send) => {
    const service = new RankingService()
    const setup = client(createApp(service))
    const limited = limitedAgent({ actions: 1 }, service)

    const first = await send(setup, limited)
    expect(first.status).toBe(status)

    expectRateLimited(await postUndo(limited, "does-not-exist"))
  })

  it("returns 429 instead of a validation or JSON error once over the limit", async () => {
    const agent = limitedAgent({ actions: 1 })
    const view = await createRanking(agent)
    expect((await postUndo(agent, view.id)).status).toBe(409)

    expectRateLimited(await postChoice(agent, view.id, { comparisonId: view.comparison.id }))
    expectRateLimited(
      await agent
        .post(`/api/rankings/${view.id}/choices`)
        .set("Content-Type", "application/json")
        .send("{choice:")
    )
    expectRateLimited(await postUndo(agent, view.id))
  })

  it("shares one bucket between choices and undo (choice first)", async () => {
    const agent = limitedAgent({ actions: 1 })
    const view = await createRanking(agent)

    const chosen = await postChoice(agent, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(chosen.status).toBe(200)

    expectRateLimited(await postUndo(agent, view.id))
  })

  it("shares one bucket between choices and undo (undo first)", async () => {
    const agent = limitedAgent({ actions: 1 })
    const view = await createRanking(agent)

    expect((await postUndo(agent, view.id)).status).toBe(409)

    expectRateLimited(
      await postChoice(agent, view.id, { comparisonId: view.comparison.id, choice: "left" })
    )
  })

  it("shares one bucket across different rankings", async () => {
    const agent = limitedAgent({ actions: 2 })
    const first = await createRanking(agent)
    const second = await createRanking(agent)

    expect(
      (await postChoice(agent, first.id, { comparisonId: first.comparison.id, choice: "left" }))
        .status
    ).toBe(200)
    expect((await postUndo(agent, first.id)).status).toBe(200)

    expectRateLimited(
      await postChoice(agent, second.id, { comparisonId: second.comparison.id, choice: "left" })
    )
    expectRateLimited(await postUndo(agent, second.id))
  })
})

describe("no side effects when limited", () => {
  it("does not advance the ranking for a limited choice", async () => {
    const service = new RankingService()
    const limited = limitedAgent({ actions: 1 }, service)
    const view = await createRanking(limited)

    // Use up the single action.
    expect((await postUndo(limited, view.id)).status).toBe(409)

    expectRateLimited(
      await postChoice(limited, view.id, { comparisonId: view.comparison.id, choice: "left" })
    )

    // A fresh app over the same service sees the untouched ranking.
    const checker = client(createApp(service))
    expectNothingToUndo(await postUndo(checker, view.id))

    const accepted = await postChoice(checker, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(accepted.status).toBe(200)
    const next = accepted.body as RankingView
    expect(next.status === "active" && next.progress.decisionsMade).toBe(1)
  })

  it("does not undo for a limited undo", async () => {
    const service = new RankingService()
    const limited = limitedAgent({ actions: 1 }, service)
    const view = await createRanking(limited)

    const chosen = await postChoice(limited, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(chosen.status).toBe(200)
    const next = chosen.body as RankingView
    if (next.status !== "active") throw new Error("Expected an active ranking.")

    expectRateLimited(await postUndo(limited, view.id))

    // The choice is still applied: its next comparison is current and the
    // original comparison is stale.
    const checker = client(createApp(service))
    const stale = await postChoice(checker, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe("STALE_COMPARISON")

    const accepted = await postChoice(checker, view.id, {
      comparisonId: next.comparison.id,
      choice: "left"
    })
    expect(accepted.status).toBe(200)
    expect(accepted.body.status === "completed" || accepted.body.progress.decisionsMade === 2).toBe(
      true
    )
  })

  it("does not apply a limited choice once a new window opens", async () => {
    const windowMs = 400
    const agent = limitedAgent({ actions: 1, windowMs })
    const view = await createRanking(agent)

    const windowStart = Date.now()
    expect((await postUndo(agent, view.id)).status).toBe(409)
    expectRateLimited(
      await postChoice(agent, view.id, { comparisonId: view.comparison.id, choice: "left" })
    )

    await sleepUntil(windowStart + windowMs + 300)

    // If the limited choice had been applied, this comparison would be stale.
    const accepted = await postChoice(agent, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(accepted.status).toBe(200)
    expect(accepted.body.progress.decisionsMade).toBe(1)
  })
})

function expectNothingToUndo(response: request.Response) {
  expect(response.status).toBe(409)
  expect(response.body.error.code).toBe("NOTHING_TO_UNDO")
}

describe("bucket independence", () => {
  it("still allows actions after the create limit is exhausted", async () => {
    const agent = limitedAgent({ create: 1 })
    const view = await createRanking(agent)
    expectRateLimited(await postCreate(agent))

    const chosen = await postChoice(agent, view.id, {
      comparisonId: view.comparison.id,
      choice: "left"
    })
    expect(chosen.status).toBe(200)
    expect((await postUndo(agent, view.id)).status).toBe(200)
  })

  it("still allows creates after the actions limit is exhausted", async () => {
    const agent = limitedAgent({ actions: 1 })
    const view = await createRanking(agent)

    expect((await postUndo(agent, view.id)).status).toBe(409)
    expectRateLimited(await postUndo(agent, view.id))

    expect((await postCreate(agent)).status).toBe(201)
    expect((await postCreate(agent)).status).toBe(201)
  })

  it("does not count creates toward the actions limit", async () => {
    const agent = limitedAgent({ actions: 1, create: 5 })

    for (let index = 0; index < 4; index += 1) {
      expect((await postCreate(agent)).status).toBe(201)
    }

    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
  })

  it("does not count actions toward the create limit", async () => {
    const agent = limitedAgent({ create: 1, actions: 10 })

    for (let index = 0; index < 5; index += 1) {
      expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
    }

    expect((await postCreate(agent)).status).toBe(201)
  })
})

describe("GET /api/health", () => {
  it("is never rate limited, even with every bucket exhausted", async () => {
    const agent = limitedAgent({ create: 1, actions: 1 })

    expect((await postCreate(agent)).status).toBe(201)
    expectRateLimited(await postCreate(agent))
    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
    expectRateLimited(await postUndo(agent, "does-not-exist"))

    for (let index = 0; index < 30; index += 1) {
      const response = await agent.get("/api/health")
      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: "ok" })
    }
  })

  it("does not consume the create or actions allowance", async () => {
    const agent = limitedAgent({ create: 1, actions: 1 })

    for (let index = 0; index < 20; index += 1) {
      expect((await agent.get("/api/health")).status).toBe(200)
    }

    expect((await postCreate(agent)).status).toBe(201)
    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
  })

  it("is not limited under default settings", async () => {
    const agent = client(createApp())

    for (let index = 0; index < 150; index += 1) {
      expect((await agent.get("/api/health")).status).toBe(200)
    }
  })
})

describe("per-app counters", () => {
  it("gives each createApp call its own create counter", async () => {
    const first = limitedAgent({ create: 1 })
    expect((await postCreate(first)).status).toBe(201)
    expectRateLimited(await postCreate(first))

    const second = limitedAgent({ create: 1 })
    expect((await postCreate(second)).status).toBe(201)
  })

  it("gives each createApp call its own actions counter, even over a shared service", async () => {
    const service = new RankingService()
    const first = limitedAgent({ actions: 1 }, service)
    expect((await postUndo(first, "does-not-exist")).status).toBe(404)
    expectRateLimited(await postUndo(first, "does-not-exist"))

    const second = limitedAgent({ actions: 1 }, service)
    expect((await postUndo(second, "does-not-exist")).status).toBe(404)
  })

  it("starts default-configured apps fresh", async () => {
    const first = client(createApp())
    for (let index = 0; index < 10; index += 1) {
      expect((await postCreate(first)).status).toBe(201)
    }
    expectRateLimited(await postCreate(first))

    const second = client(createApp())
    expect((await postCreate(second)).status).toBe(201)
  })
})

describe("window reset", () => {
  it("allows creates again after the window has elapsed", async () => {
    const windowMs = 400
    const agent = limitedAgent({ create: 2, windowMs })

    const windowStart = Date.now()
    expect((await postCreate(agent)).status).toBe(201)
    expect((await postCreate(agent)).status).toBe(201)
    expectRateLimited(await postCreate(agent))

    await sleepUntil(windowStart + windowMs + 300)

    expect((await postCreate(agent)).status).toBe(201)
    expect((await postCreate(agent)).status).toBe(201)
    expectRateLimited(await postCreate(agent))
  })

  it("allows actions again after the window has elapsed", async () => {
    const windowMs = 400
    const agent = limitedAgent({ actions: 2, windowMs })

    const windowStart = Date.now()
    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
    expectRateLimited(await postUndo(agent, "does-not-exist"))

    await sleepUntil(windowStart + windowMs + 300)

    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)
    expect(
      (await postChoice(agent, "does-not-exist", { comparisonId: "x", choice: "left" })).status
    ).toBe(404)
    expectRateLimited(await postUndo(agent, "does-not-exist"))
  })

  it("keeps the default 60 second window when only limits are overridden", async () => {
    const agent = limitedAgent({ create: 1 })

    expect((await postCreate(agent)).status).toBe(201)
    expectRateLimited(await postCreate(agent))

    await sleep(700)

    expectRateLimited(await postCreate(agent))
  })
})

describe("X-Forwarded-For", () => {
  it("does not give a fresh create allowance for a different forwarded address", async () => {
    const agent = limitedAgent({ create: 1 })

    const first = await agent.post("/api/rankings").set("X-Forwarded-For", "203.0.113.1").send(validBody)
    expect(first.status).toBe(201)

    expectRateLimited(
      await agent.post("/api/rankings").set("X-Forwarded-For", "203.0.113.2").send(validBody)
    )
    expectRateLimited(
      await agent.post("/api/rankings").set("X-Forwarded-For", "198.51.100.7, 203.0.113.3").send(validBody)
    )
    expectRateLimited(await postCreate(agent))
  })

  it("does not give a fresh actions allowance for a different forwarded address", async () => {
    const agent = limitedAgent({ actions: 1 })

    expect((await postUndo(agent, "does-not-exist")).status).toBe(404)

    for (const address of ["203.0.113.10", "203.0.113.11", "2001:db8::1"]) {
      expectRateLimited(
        await agent.post("/api/rankings/does-not-exist/undo").set("X-Forwarded-For", address)
      )
    }
  })

  it("counts requests with and without the header against the same client", async () => {
    const agent = limitedAgent({ create: 2 })

    expect(
      (await agent.post("/api/rankings").set("X-Forwarded-For", "203.0.113.20").send(validBody))
        .status
    ).toBe(201)
    expect((await postCreate(agent)).status).toBe(201)

    expectRateLimited(
      await agent.post("/api/rankings").set("X-Forwarded-For", "203.0.113.21").send(validBody)
    )
  })
})

describe("reads limit", () => {
  it("handles the first N reads normally and rejects N+1 and later", async () => {
    const agent = limitedAgent({ reads: 2 })
    const view = await createRanking(agent)

    expect((await agent.get("/api/rankings")).status).toBe(200)
    expect((await agent.get(`/api/rankings/${view.id}`)).status).toBe(200)

    expectRateLimited(await agent.get("/api/rankings"))
    expectRateLimited(await agent.get(`/api/rankings/${view.id}`))
  })

  it("defaults to 300 reads per window", async () => {
    const agent = client(createApp())

    for (let index = 0; index < 300; index += 1) {
      expect((await agent.get("/api/rankings")).status).toBe(200)
    }

    expectRateLimited(await agent.get("/api/rankings"))
  })

  it("is independent of the create and actions limits", async () => {
    const agent = limitedAgent({ reads: 1, create: 1, actions: 1 })

    expect((await agent.get("/api/rankings")).status).toBe(200)
    expectRateLimited(await agent.get("/api/rankings"))

    const view = await createRanking(agent)
    expect((await postUndo(agent, view.id)).status).toBe(409)
  })

  it("counts deleting toward the actions limit", async () => {
    const agent = limitedAgent({ actions: 1 })
    const view = await createRanking(agent)

    expect((await agent.delete(`/api/rankings/${view.id}`)).status).toBe(204)
    expectRateLimited(await postUndo(agent, "does-not-exist"))
  })
})
