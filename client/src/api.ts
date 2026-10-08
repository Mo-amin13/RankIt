import type {
  ApiError,
  ApiErrorResponse,
  Choice,
  RankingListResponse,
  RankingView,
} from "../../shared/types";

// Thin wrappers around the server API. Errors the server reports come back as
// values; a network failure or a non-JSON reply throws, so callers can tell
// "the server said no" apart from "the server could not be reached".

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: ApiError };

export type NewRankingInput = {
  title: string;
  items: { name: string; imageUrl?: string }[];
};

async function send<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return { ok: true, value: undefined as T };
  }

  const data: unknown = await response.json();

  if (!response.ok) {
    return { ok: false, status: response.status, error: (data as ApiErrorResponse).error };
  }

  return { ok: true, value: data as T };
}

// IDs come from the URL, so they are always encoded before use in a path.
function rankingPath(id: string): string {
  return `/api/rankings/${encodeURIComponent(id)}`;
}

export const api = {
  listRankings: () => send<RankingListResponse>("GET", "/api/rankings"),
  createRanking: (input: NewRankingInput) => send<RankingView>("POST", "/api/rankings", input),
  getRanking: (id: string) => send<RankingView>("GET", rankingPath(id)),
  choose: (id: string, comparisonId: string, choice: Choice) =>
    send<RankingView>("POST", `${rankingPath(id)}/choices`, { comparisonId, choice }),
  undo: (id: string) => send<RankingView>("POST", `${rankingPath(id)}/undo`),
  deleteRanking: (id: string) => send<void>("DELETE", rankingPath(id)),
};
