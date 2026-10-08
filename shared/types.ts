export type Item = {
  id: string
  name: string
  imageUrl?: string
}

export type Choice = "left" | "right" | "tie"

export type RankedGroup = Item[]

export type RankingProgress = {
  decisionsMade: number
  placedItems: number
  totalItems: number
}

export type Comparison = {
  id: string
  left: Item
  right: Item
}

export type ActiveRankingView = {
  id: string
  title: string
  status: "active"
  comparison: Comparison
  progress: RankingProgress
  canUndo: boolean
}

export type CompletedRankingView = {
  id: string
  title: string
  status: "completed"
  groups: RankedGroup[]
  canUndo: boolean
}

export type RankingView = ActiveRankingView | CompletedRankingView

// One entry in the visitor's own list of rankings. It never contains the
// order of an active ranking, only how far along it is.
export type RankingSummary = {
  id: string
  title: string
  status: "active" | "completed"
  itemCount: number
  placedItems: number
  updatedAt: string
}

export type RankingListResponse = {
  rankings: RankingSummary[]
}

export type ApiError = {
  code: string
  message: string
}

export type ApiErrorResponse = {
  error: ApiError
}
