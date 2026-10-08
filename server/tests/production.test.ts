import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import request from "supertest"
import { afterAll, describe, expect, it } from "vitest"

import { createApp } from "../src/app.js"

// Production behaviour: serving the built client next to the API, and
// reading the visitor's IP from a trusted proxy.

const clientDir = mkdtempSync(join(tmpdir(), "rankit-client-"))
mkdirSync(join(clientDir, "assets"))
writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>PairRank</title>")
writeFileSync(join(clientDir, "assets", "index-abc123.js"), "console.log('app')")
writeFileSync(join(clientDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>")

afterAll(() => {
  rmSync(clientDir, { recursive: true, force: true })
})

function withClient() {
  return request.agent(createApp(undefined, { clientDir }))
}

function expectJson404(response: request.Response) {
  expect(response.status).toBe(404)
  expect(response.headers["content-type"]).toMatch(/application\/json/)
  expect(Object.keys(response.body)).toEqual(["error"])
}

describe("serving the built client", () => {
  it.each(["/", "/new", "/new/review", "/r/some-ranking-id", "/anything/else"])(
    "returns the app's index.html for %s",
    async (path) => {
      const response = await withClient().get(path)

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toMatch(/text\/html/)
      expect(response.text).toContain("<title>PairRank</title>")
      expect(response.headers["cache-control"]).toBe("no-cache")
    }
  )

  it("serves hashed assets with a long-lived cache", async () => {
    const response = await withClient().get("/assets/index-abc123.js")

    expect(response.status).toBe(200)
    expect(response.headers["content-type"]).toMatch(/javascript/)
    expect(response.text).toContain("console.log")
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable")
  })

  it("serves other static files without the long-lived cache", async () => {
    const response = await withClient().get("/favicon.svg")

    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).not.toContain("immutable")
  })

  it("returns a JSON 404 for a missing file instead of the page", async () => {
    expectJson404(await withClient().get("/assets/missing-file.js"))
    expectJson404(await withClient().get("/robots.txt"))
  })

  it("keeps API 404s as JSON", async () => {
    expectJson404(await withClient().get("/api"))
    expectJson404(await withClient().get("/api/does-not-exist"))
  })

  it("only answers GET and HEAD with the page", async () => {
    expectJson404(await withClient().post("/r/some-ranking-id"))
    expectJson404(await withClient().delete("/new"))

    const head = await withClient().head("/r/some-ranking-id")
    expect(head.status).toBe(200)
  })

  it("leaves the API working", async () => {
    const agent = withClient()

    expect((await agent.get("/api/health")).body).toEqual({ status: "ok" })
    const created = await agent
      .post("/api/rankings")
      .send({ title: "Movies", items: [{ name: "A" }, { name: "B" }, { name: "C" }] })
    expect(created.status).toBe(201)
    expect((await agent.get(`/api/rankings/${created.body.id}`)).body).toEqual(created.body)
  })

  it("serves no pages when no client is configured", async () => {
    expectJson404(await request(createApp()).get("/"))
    expectJson404(await request(createApp()).get("/r/some-ranking-id"))
  })
})

describe("response headers", () => {
  it("does not announce the framework", async () => {
    const response = await withClient().get("/api/health")

    expect(response.headers["x-powered-by"]).toBeUndefined()
  })
})

describe("behind a trusted proxy", () => {
  const body = { title: "Movies", items: [{ name: "A" }, { name: "B" }, { name: "C" }] }

  it("rate-limits each visitor by the IP the proxy reports", async () => {
    const app = createApp(undefined, { trustProxy: 1, rateLimits: { create: 1 } })
    const from = (ip: string) => request(app).post("/api/rankings").set("X-Forwarded-For", ip).send(body)

    expect((await from("203.0.113.1")).status).toBe(201)
    expect((await from("203.0.113.2")).status).toBe(201)
    expect((await from("203.0.113.1")).status).toBe(429)
  })

  it("uses the address added by the proxy, not one the visitor made up", async () => {
    const app = createApp(undefined, { trustProxy: 1, rateLimits: { create: 1 } })
    // The visitor sends a fake first entry; the proxy appends the real IP.
    const from = (fake: string) =>
      request(app).post("/api/rankings").set("X-Forwarded-For", `${fake}, 203.0.113.9`).send(body)

    expect((await from("198.51.100.1")).status).toBe(201)
    expect((await from("198.51.100.2")).status).toBe(429)
  })
})
