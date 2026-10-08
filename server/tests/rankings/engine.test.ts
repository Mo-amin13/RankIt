import { describe, expect, it } from "vitest"

import type { Choice, Item } from "../../../shared/types.js"
import {
  answerComparison,
  createRankingState,
  toRankingView,
  type EngineDependencies,
  type RankingState
} from "../../src/rankings/engine.js"

function item(name: string): Item {
  return { id: name.toLowerCase(), name }
}

function dependencies(randomValues = [0, 0.9]): EngineDependencies {
  let id = 0
  let randomIndex = 0

  return {
    createId: () => `comparison-${++id}`,
    random: () => randomValues[randomIndex++ % randomValues.length]
  }
}

function completeRanking(
  items: Item[],
  desiredGroupByItemId: Record<string, number>
): RankingState {
  const deps = dependencies()
  let state = createRankingState("ranking-1", "Test ranking", items, deps)

  while (state.status === "active") {
    const view = toRankingView(state, false)

    if (view.status !== "active") {
      throw new Error("Expected an active ranking view.")
    }

    const leftRank = desiredGroupByItemId[view.comparison.left.id]
    const rightRank = desiredGroupByItemId[view.comparison.right.id]
    let choice: Choice

    if (leftRank === rightRank) {
      choice = "tie"
    } else {
      choice = leftRank < rightRank ? "left" : "right"
    }

    state = answerComparison(state, choice, deps)
  }

  return state
}

describe("binary insertion ranking engine", () => {
  it("inserts candidates at the start, middle, and end", () => {
    const state = completeRanking(
      [item("C"), item("A"), item("D"), item("B")],
      { a: 0, b: 1, c: 2, d: 3 }
    )

    expect(state.status).toBe("completed")

    if (state.status === "completed") {
      expect(state.rankedGroups.map((group) => group.map(({ name }) => name))).toEqual([
        ["A"],
        ["B"],
        ["C"],
        ["D"]
      ])
    }
  })

  it("adds a tied candidate to the existing dense-ranked group", () => {
    const state = completeRanking(
      [item("B"), item("A"), item("C"), item("D")],
      { a: 0, b: 1, c: 1, d: 2 }
    )

    expect(state.status).toBe("completed")

    if (state.status === "completed") {
      expect(state.rankedGroups.map((group) => group.map(({ name }) => name))).toEqual([
        ["A"],
        ["B", "C"],
        ["D"]
      ])
    }
  })

  it("keeps all-equal items in stable input order", () => {
    const state = completeRanking(
      [item("A"), item("B"), item("C"), item("D")],
      { a: 0, b: 0, c: 0, d: 0 }
    )

    if (state.status === "completed") {
      expect(state.rankedGroups).toHaveLength(1)
      expect(state.rankedGroups[0].map(({ name }) => name)).toEqual([
        "A",
        "B",
        "C",
        "D"
      ])
    }
  })

  it("randomizes presentation without changing candidate semantics", () => {
    const items = [item("A"), item("B"), item("C")]
    const candidateOnLeft = createRankingState(
      "ranking-left",
      "Left",
      items,
      dependencies([0])
    )
    const candidateOnRight = createRankingState(
      "ranking-right",
      "Right",
      items,
      dependencies([0.9])
    )

    expect(toRankingView(candidateOnLeft, false)).toMatchObject({
      status: "active",
      comparison: { left: { id: "b" }, right: { id: "a" } }
    })
    expect(toRankingView(candidateOnRight, false)).toMatchObject({
      status: "active",
      comparison: { left: { id: "a" }, right: { id: "b" } }
    })
  })

  it("keeps hidden ordering out of an active public view", () => {
    const state = createRankingState(
      "ranking-1",
      "Private state",
      [item("A"), item("B"), item("C")],
      dependencies()
    )
    const view = toRankingView(state, false)

    expect(view).not.toHaveProperty("rankedGroups")
    expect(view).not.toHaveProperty("remainingItems")
    expect(view).not.toHaveProperty("low")
    expect(view).not.toHaveProperty("high")
  })
})
