import { randomUUID } from "node:crypto"

import type {
  Choice,
  Item,
  RankingSummary,
  RankingView
} from "../../../shared/types.js"
import type { ValidatedCreateRankingInput } from "./validation.js"
import {
  answerComparison,
  createRankingState,
  toRankingSummary,
  toRankingView,
  type EngineDependencies
} from "./engine.js"
import {
  InMemoryRankingStore,
  type RankingRecord,
  type RankingStore,
  type StoredRanking
} from "./store.js"

export type ServiceError = {
  status: number
  code: string
  message: string
}

export type ServiceResult =
  | { ok: true; value: RankingView }
  | { ok: false; error: ServiceError }

const defaultDependencies: EngineDependencies = {
  createId: randomUUID,
  random: Math.random
}

// The most rankings returned when listing someone's rankings.
export const LIST_LIMIT = 100

// How often a choice or undo is re-evaluated after losing a race with another
// request for the same ranking before giving up.
const MAX_ATTEMPTS = 3

function failure(status: number, code: string, message: string): ServiceResult {
  return { ok: false, error: { status, code, message } }
}

const notFound = () => failure(404, "RANKING_NOT_FOUND", "Ranking not found.")

// Decides what a request does with the ranking it read: either an error, or the
// record to save and the view to return once the save succeeds.
type Transition =
  | { ok: false; result: ServiceResult }
  | { ok: true; record: RankingRecord; view: RankingView }

export class RankingService {
  constructor(
    private readonly store: RankingStore = new InMemoryRankingStore(),
    private readonly dependencies: EngineDependencies = defaultDependencies
  ) {}

  // Every method takes the owner (the hash of the visitor's cookie). Rankings
  // of other owners are reported as not found.
  async create(
    ownerHash: string,
    input: ValidatedCreateRankingInput
  ): Promise<RankingView> {
    const rankingId = this.dependencies.createId()
    const items: Item[] = input.items.map((item) => ({
      id: this.dependencies.createId(),
      ...item
    }))
    const state = createRankingState(
      rankingId,
      input.title,
      items,
      this.dependencies
    )

    await this.store.insert(ownerHash, rankingId, { state, undoState: null })

    return toRankingView(state, false)
  }

  // The current view, exactly as the last create, choice or undo returned it.
  async get(ownerHash: string, id: string): Promise<ServiceResult> {
    const stored = await this.store.get(ownerHash, id)

    if (!stored) {
      return notFound()
    }

    return { ok: true, value: toRankingView(stored.state, stored.undoState !== null) }
  }

  async list(ownerHash: string): Promise<RankingSummary[]> {
    const entries = await this.store.list(ownerHash, LIST_LIMIT)

    return entries.map((entry) => toRankingSummary(entry.state, entry.updatedAt))
  }

  delete(ownerHash: string, id: string): Promise<boolean> {
    return this.store.delete(ownerHash, id)
  }

  answer(
    ownerHash: string,
    id: string,
    comparisonId: string,
    choice: Choice
  ): Promise<ServiceResult> {
    return this.change(ownerHash, id, (stored) => {
      if (stored.state.status === "completed") {
        return {
          ok: false,
          result: failure(409, "RANKING_COMPLETED", "This ranking is already complete.")
        }
      }

      if (stored.state.comparison.id !== comparisonId) {
        return {
          ok: false,
          result: failure(409, "STALE_COMPARISON", "This comparison is no longer current.")
        }
      }

      const state = answerComparison(stored.state, choice, this.dependencies)

      return {
        ok: true,
        record: { state, undoState: stored.state },
        view: toRankingView(state, true)
      }
    })
  }

  undo(ownerHash: string, id: string): Promise<ServiceResult> {
    return this.change(ownerHash, id, (stored) => {
      if (!stored.undoState) {
        return {
          ok: false,
          result: failure(409, "NOTHING_TO_UNDO", "There is no previous choice to undo.")
        }
      }

      return {
        ok: true,
        record: { state: stored.undoState, undoState: null },
        view: toRankingView(stored.undoState, false)
      }
    })
  }

  // Read, decide, and save only if nobody else saved in between. If another
  // request won the race, read again so the decision is made on fresh state
  // (a duplicate choice then correctly becomes STALE_COMPARISON).
  private async change(
    ownerHash: string,
    id: string,
    decide: (stored: StoredRanking) => Transition
  ): Promise<ServiceResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const stored = await this.store.get(ownerHash, id)

      if (!stored) {
        return notFound()
      }

      const transition = decide(stored)

      if (!transition.ok) {
        return transition.result
      }

      if (await this.store.update(ownerHash, id, transition.record, stored.revision)) {
        return { ok: true, value: transition.view }
      }
    }

    return failure(
      409,
      "CONCURRENT_UPDATE",
      "This ranking was changed by another request. Please try again."
    )
  }
}
