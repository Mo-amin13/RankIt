import { extname, join, resolve, sep } from "node:path"

import express from "express"
import { rateLimit } from "express-rate-limit"

import type { Choice, RankingListResponse } from "../../shared/types.js"
import {
  OWNER_COOKIE,
  OWNER_COOKIE_MAX_AGE_MS,
  hashOwnerToken,
  newOwnerToken,
  readOwnerToken
} from "./owner.js"
import { RankingService, type ServiceError } from "./rankings/service.js"
import { validateCreateRankingInput } from "./rankings/validation.js"

const choices: Choice[] = ["left", "right", "tie"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type RateLimitOptions = {
  windowMs?: number
  create?: number
  actions?: number
  reads?: number
}

export type AppOptions = {
  rateLimits?: RateLimitOptions
  // Mark the owner cookie Secure (HTTPS only). On in production.
  secureCookies?: boolean
  // How many proxies sit in front of the app (Render: 3). With it, the
  // rate limiter sees each visitor's real IP from X-Forwarded-For. Leave it
  // unset when there is no proxy, or anyone could fake their IP.
  trustProxy?: number
  // The built client (client/dist). When set, the app serves the website too.
  clientDir?: string
}

// Serves the built client: hashed files under /assets are cached for a year,
// and every other GET outside /api gets index.html so client routes like
// /r/:id work on reload. Missing files (anything with an extension) fall
// through to the JSON 404.
function serveClient(app: express.Express, clientDir: string) {
  const root = resolve(clientDir)

  app.use(
    express.static(root, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.startsWith(join(root, "assets") + sep)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
        }
      }
    })
  )

  app.use((req, res, next) => {
    const isPageRequest =
      (req.method === "GET" || req.method === "HEAD") &&
      req.path !== "/api" &&
      !req.path.startsWith("/api/") &&
      extname(req.path) === ""

    if (!isPageRequest) {
      return next()
    }

    // Always revalidate the page so a new deploy is picked up immediately.
    res.setHeader("Cache-Control", "no-cache")
    res.sendFile(join(root, "index.html"))
  })
}

// Gives every visitor an anonymous owner cookie (see owner.ts) and makes the
// hash of it available to the routes. Re-sending the cookie on each request
// keeps it alive for a year after the last visit.
function identifyOwner(secure: boolean): express.RequestHandler {
  return (req, res, next) => {
    const token = readOwnerToken(req.headers.cookie) ?? newOwnerToken()

    res.cookie(OWNER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: OWNER_COOKIE_MAX_AGE_MS
    })
    res.locals.ownerHash = hashOwnerToken(token)
    next()
  }
}

function ownerHash(res: express.Response): string {
  return res.locals.ownerHash as string
}

function sendError(res: express.Response, error: ServiceError) {
  return res.status(error.status).json({
    error: { code: error.code, message: error.message }
  })
}

function buildLimiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait a moment and try again."
        }
      })
    }
  })
}

export function createApp(
  service = new RankingService(),
  options: AppOptions = {}
) {
  const app = express()
  app.disable("x-powered-by")

  if (options.trustProxy !== undefined) {
    app.set("trust proxy", options.trustProxy)
  }

  const windowMs = options.rateLimits?.windowMs ?? 60_000
  // Limiters are created per app so every app instance starts with fresh counts.
  // They run before JSON parsing so rejected requests are as cheap as possible.
  const createLimiter = buildLimiter(windowMs, options.rateLimits?.create ?? 10)
  const actionLimiter = buildLimiter(windowMs, options.rateLimits?.actions ?? 120)
  const readLimiter = buildLimiter(windowMs, options.rateLimits?.reads ?? 300)
  const parseJson = express.json({ limit: "100kb" })

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" })
  })

  app.use("/api/rankings", identifyOwner(options.secureCookies ?? false))

  app.get("/api/rankings", readLimiter, async (_req, res) => {
    const body: RankingListResponse = { rankings: await service.list(ownerHash(res)) }

    res.json(body)
  })

  app.get<{ id: string }>("/api/rankings/:id", readLimiter, async (req, res) => {
    const result = await service.get(ownerHash(res), req.params.id)

    if (!result.ok) {
      return sendError(res, result.error)
    }

    return res.json(result.value)
  })

  app.delete<{ id: string }>("/api/rankings/:id", actionLimiter, async (req, res) => {
    if (!(await service.delete(ownerHash(res), req.params.id))) {
      return sendError(res, {
        status: 404,
        code: "RANKING_NOT_FOUND",
        message: "Ranking not found."
      })
    }

    return res.status(204).end()
  })

  app.post("/api/rankings", createLimiter, parseJson, async (req, res) => {
    const result = validateCreateRankingInput(req.body)

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    return res.status(201).json(await service.create(ownerHash(res), result.value))
  })

  app.post<{ id: string }>("/api/rankings/:id/choices", actionLimiter, parseJson, async (req, res) => {
    if (
      !isRecord(req.body) ||
      typeof req.body.comparisonId !== "string" ||
      !choices.includes(req.body.choice as Choice)
    ) {
      return res.status(400).json({
        error: {
          code: "INVALID_CHOICE",
          message: "Submit a valid choice for the current comparison."
        }
      })
    }

    const result = await service.answer(
      ownerHash(res),
      req.params.id,
      req.body.comparisonId,
      req.body.choice as Choice
    )

    if (!result.ok) {
      return sendError(res, result.error)
    }

    return res.json(result.value)
  })

  app.post<{ id: string }>("/api/rankings/:id/undo", actionLimiter, async (req, res) => {
    const result = await service.undo(ownerHash(res), req.params.id)

    if (!result.ok) {
      return sendError(res, result.error)
    }

    return res.json(result.value)
  })

  if (options.clientDir) {
    serveClient(app, options.clientDir)
  }

  // Runs only when no route above matched.
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "This endpoint does not exist."
      }
    })
  })

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          error: {
            code: "INVALID_JSON",
            message: "Submit valid JSON."
          }
        })
      }
      if (isRecord(error) && error.status === 413) {
        return res.status(413).json({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "This ranking is too large. Try fewer items or shorter image URLs."
          }
        })
      }

      console.error(error)
      return res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong."
        }
      })
    }
  )

  return app
}
