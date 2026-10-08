import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Choice, Item, RankingView } from "../../../shared/types";
import { api, type ApiResult } from "../api";
import ComparisonScreen from "../components/ComparisonScreen";
import ResultsScreen from "../components/ResultsScreen";
import TopBar from "../components/TopBar";
import { useDocumentTitle } from "../useDocumentTitle";
import { useRequestRunner } from "../useRequestRunner";

// Errors that mean the page shows an outdated view, for example because the
// ranking was changed in another tab. The fix is to load the current view.
const OUTDATED_VIEW_CODES = ["STALE_COMPARISON", "RANKING_COMPLETED", "NOTHING_TO_UNDO"];

type LoadState = "loading" | "ready" | "not-found" | "failed";

type RankingPageProps = {
  id: string;
  onEditItems: (title: string, items: Item[]) => void;
};

// /r/:id — compare while the ranking is active, results once it is complete.
// The server always has the current view, so a reload resumes in place.
export default function RankingPage({ id, onEditItems }: RankingPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { busy, error, setError, run } = useRequestRunner();

  // A page that just created this ranking passes its first view along to
  // skip one request. Browsers keep that state across reloads, so it is used
  // once and then cleared; afterwards the server is the only source.
  const passedView = (location.state as { view?: RankingView } | null)?.view;
  const [view, setView] = useState<RankingView | null>(
    passedView?.id === id ? passedView : null
  );
  const [loadState, setLoadState] = useState<LoadState>(view ? "ready" : "loading");

  useDocumentTitle(view?.title);

  // Clear the passed view from browser history so a reload asks the server.
  useEffect(() => {
    if (passedView) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [passedView, navigate, location.pathname]);

  useEffect(() => {
    if (loadState !== "loading") {
      return;
    }

    let cancelled = false;

    api
      .getRanking(id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setView(result.value);
          setLoadState("ready");
        } else {
          setLoadState(result.status === 404 ? "not-found" : "failed");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [id, loadState]);

  async function apply(result: ApiResult<RankingView>) {
    if (result.ok) {
      setView(result.value);
      return;
    }

    if (result.status === 409 && OUTDATED_VIEW_CODES.includes(result.error.code)) {
      const latest = await api.getRanking(id);
      if (latest.ok) {
        setView(latest.value);
        setError("This ranking changed somewhere else, so the latest version is shown.");
        return;
      }
    }

    if (result.status === 404) {
      setLoadState("not-found");
      return;
    }

    setError(result.error.message);
  }

  const handleChoose = (choice: Choice) =>
    run(async () => {
      if (view?.status !== "active") return;
      await apply(await api.choose(id, view.comparison.id, choice));
    });

  const handleUndo = () =>
    run(async () => {
      if (!view?.canUndo) return;
      await apply(await api.undo(id));
    });

  // Starts a fresh ranking with the same title and items.
  const handleRankAgain = () =>
    run(async () => {
      if (view?.status !== "completed") return;
      const result = await api.createRanking({
        title: view.title,
        items: view.groups.flat().map((item) => ({ name: item.name, imageUrl: item.imageUrl })),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      navigate(`/r/${result.value.id}`, { state: { view: result.value } });
    });

  if (loadState === "not-found") {
    return (
      <>
        <TopBar />
        <main className="page">
          <h1 className="page-title">Ranking not found</h1>
          <p className="page-sub">
            It may have been deleted, or it was made in another browser. Rankings are saved
            in the browser that created them.
          </p>
          <div className="action-row action-row--start">
            <Link to="/" className="btn btn-primary">Go to your rankings</Link>
          </div>
        </main>
      </>
    );
  }

  if (loadState === "failed") {
    return (
      <>
        <TopBar />
        <main className="page">
          <h1 className="page-title">Could not load this ranking</h1>
          <p className="page-sub">Check your connection, then reload the page.</p>
        </main>
      </>
    );
  }

  if (!view) {
    return (
      <>
        <TopBar step="rank" />
        <main className="page" aria-busy="true">
          <p className="page-sub" role="status">Loading ranking…</p>
        </main>
      </>
    );
  }

  if (view.status === "active") {
    return (
      <>
        <TopBar step="rank" />
        <main>
          <ComparisonScreen
            title={view.title}
            comparison={view.comparison}
            progress={view.progress}
            onChoose={handleChoose}
            onUndo={handleUndo}
            canUndo={view.canUndo}
            busy={busy}
            error={error}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar step="results" />
      <main>
        <ResultsScreen
          title={view.title}
          groups={view.groups}
          onUndo={handleUndo}
          canUndo={view.canUndo}
          onRestart={handleRankAgain}
          onEdit={() => onEditItems(view.title, view.groups.flat())}
          busy={busy}
          error={error}
        />
      </main>
    </>
  );
}
