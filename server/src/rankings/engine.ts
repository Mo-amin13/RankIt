import type {
  Choice,
  Item,
  RankedGroup,
  RankingSummary,
  RankingView
} from "../../../shared/types.js"

type CurrentComparison = {
  id: string
  candidateItemId: string
  opponentItemId: string
  opponentGroupIndex: number
  leftItemId: string
  rightItemId: string
}

type CommonRankingState = {
  id: string
  title: string
  totalItems: number
  decisionsMade: number
}

export type ActiveRankingState = CommonRankingState & {
  status: "active"
  rankedGroups: RankedGroup[]
  remainingItems: Item[]
  low: number
  high: number
  comparison: CurrentComparison
}

export type CompletedRankingState = CommonRankingState & {
  status: "completed"
  rankedGroups: RankedGroup[]
}

export type RankingState = ActiveRankingState | CompletedRankingState

export type EngineDependencies = {
  createId: () => string
  random: () => number
}

type ActiveCore = Omit<ActiveRankingState, "status" | "comparison">

function itemCount(groups: RankedGroup[]): number {
  return groups.reduce((count, group) => count + group.length, 0)
}

function prepareComparison(
  initialCore: ActiveCore,
  dependencies: EngineDependencies
): RankingState {
  let core = initialCore

  while (core.remainingItems.length > 0 && core.low === core.high) {
    const candidate = core.remainingItems[0]
    const rankedGroups = [
      ...core.rankedGroups.slice(0, core.low),
      [candidate],
      ...core.rankedGroups.slice(core.low)
    ]
    const remainingItems = core.remainingItems.slice(1)

    if (remainingItems.length === 0) {
      return {
        id: core.id,
        title: core.title,
        totalItems: core.totalItems,
        decisionsMade: core.decisionsMade,
        status: "completed",
        rankedGroups
      }
    }

    core = {
      ...core,
      rankedGroups,
      remainingItems,
      low: 0,
      high: rankedGroups.length
    }
  }

  const candidate = core.remainingItems[0]
  const opponentGroupIndex = Math.floor((core.low + core.high) / 2)
  const opponent = core.rankedGroups[opponentGroupIndex][0]
  const candidateIsLeft = dependencies.random() < 0.5

  return {
    ...core,
    status: "active",
    comparison: {
      id: dependencies.createId(),
      candidateItemId: candidate.id,
      opponentItemId: opponent.id,
      opponentGroupIndex,
      leftItemId: candidateIsLeft ? candidate.id : opponent.id,
      rightItemId: candidateIsLeft ? opponent.id : candidate.id
    }
  }
}

export function createRankingState(
  id: string,
  title: string,
  items: Item[],
  dependencies: EngineDependencies
): RankingState {
  if (items.length < 2) {
    throw new Error("At least two items are required to start ranking.")
  }

  return prepareComparison(
    {
      id,
      title,
      totalItems: items.length,
      decisionsMade: 0,
      rankedGroups: [[items[0]]],
      remainingItems: items.slice(1),
      low: 0,
      high: 1
    },
    dependencies
  )
}

export function answerComparison(
  state: ActiveRankingState,
  choice: Choice,
  dependencies: EngineDependencies
): RankingState {
  const candidate = state.remainingItems[0]
  const comparison = state.comparison
  const decisionsMade = state.decisionsMade + 1

  if (choice === "tie") {
    const rankedGroups = state.rankedGroups.map((group, index) =>
      index === comparison.opponentGroupIndex ? [...group, candidate] : group
    )
    const remainingItems = state.remainingItems.slice(1)

    if (remainingItems.length === 0) {
      return {
        id: state.id,
        title: state.title,
        totalItems: state.totalItems,
        decisionsMade,
        status: "completed",
        rankedGroups
      }
    }

    return prepareComparison(
      {
        id: state.id,
        title: state.title,
        totalItems: state.totalItems,
        decisionsMade,
        rankedGroups,
        remainingItems,
        low: 0,
        high: rankedGroups.length
      },
      dependencies
    )
  }

  const selectedItemId =
    choice === "left" ? comparison.leftItemId : comparison.rightItemId
  const candidateWasSelected = selectedItemId === comparison.candidateItemId

  return prepareComparison(
    {
      id: state.id,
      title: state.title,
      totalItems: state.totalItems,
      decisionsMade,
      rankedGroups: state.rankedGroups,
      remainingItems: state.remainingItems,
      low: candidateWasSelected
        ? state.low
        : comparison.opponentGroupIndex + 1,
      high: candidateWasSelected
        ? comparison.opponentGroupIndex
        : state.high
    },
    dependencies
  )
}

export function toRankingView(
  state: RankingState,
  canUndo: boolean
): RankingView {
  if (state.status === "completed") {
    return {
      id: state.id,
      title: state.title,
      status: "completed",
      groups: state.rankedGroups,
      canUndo
    }
  }

  const candidate = state.remainingItems[0]
  const opponent = state.rankedGroups[state.comparison.opponentGroupIndex][0]
  const left =
    state.comparison.leftItemId === candidate.id ? candidate : opponent
  const right =
    state.comparison.rightItemId === candidate.id ? candidate : opponent

  return {
    id: state.id,
    title: state.title,
    status: "active",
    comparison: {
      id: state.comparison.id,
      left,
      right
    },
    progress: {
      decisionsMade: state.decisionsMade,
      placedItems: itemCount(state.rankedGroups),
      totalItems: state.totalItems
    },
    canUndo
  }
}

// The list-entry shape. Like toRankingView, it is the only way from internal
// state to the wire, so it can never leak the order of an active ranking.
export function toRankingSummary(
  state: RankingState,
  updatedAt: Date
): RankingSummary {
  return {
    id: state.id,
    title: state.title,
    status: state.status,
    itemCount: state.totalItems,
    placedItems:
      state.status === "completed" ? state.totalItems : itemCount(state.rankedGroups),
    updatedAt: updatedAt.toISOString()
  }
}
