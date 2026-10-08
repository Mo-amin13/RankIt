import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { RankingSummary } from "../../../shared/types";
import { api } from "../api";
import { AlertIcon, ArrowRightIcon, LockIcon, PlusIcon, TrashIcon } from "../components/icons";
import TopBar from "../components/TopBar";
import { estimatedMinutes } from "../draft";
import { templates, type RankingTemplate } from "../templates";
import { useDocumentTitle } from "../useDocumentTitle";
import { useRequestRunner } from "../useRequestRunner";

type HomePageProps = {
  onNewRanking: () => void;
  onUseTemplate: (template: RankingTemplate, mode: "rank" | "edit") => void;
};

type ListState =
  | { status: "loading" }
  | { status: "ready"; rankings: RankingSummary[] }
  | { status: "failed" };

// "/" — returning visitors see their own rankings first; first-time visitors
// see how it works and the templates.
export default function HomePage({ onNewRanking, onUseTemplate }: HomePageProps) {
  const [list, setList] = useState<ListState>({ status: "loading" });

  useDocumentTitle(undefined);

  useEffect(() => {
    let cancelled = false;

    api
      .listRankings()
      .then((result) => {
        if (cancelled) return;
        setList(result.ok ? { status: "ready", rankings: result.value.rankings } : { status: "failed" });
      })
      .catch(() => {
        if (!cancelled) setList({ status: "failed" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rankings = list.status === "ready" ? list.rankings : [];
  const isReturning = rankings.length > 0;

  const removeFromList = (id: string) =>
    setList((current) =>
      current.status === "ready"
        ? { status: "ready", rankings: current.rankings.filter((ranking) => ranking.id !== id) }
        : current,
    );

  return (
    <>
      <TopBar />
      <main className="page page--wide home">
        <header className="home-hero">
          <h1 className="page-title">Rank anything, two at a time.</h1>
          <p className="page-sub">
            Your full ranking stays hidden until you're done, so early picks can't bias later
            ones.
          </p>
          <div className="action-row action-row--start">
            <button type="button" className="btn btn-primary btn-lg" onClick={onNewRanking}>
              <PlusIcon size={16} /> New ranking
            </button>
          </div>
        </header>

        {list.status === "loading" && (
          <p className="home-loading" role="status">
            Loading your rankings…
          </p>
        )}

        {list.status === "failed" && (
          <p className="alert" role="alert">
            <AlertIcon /> Your rankings could not be loaded. Reload the page to try again.
          </p>
        )}

        {list.status !== "loading" && (
          <>
            {isReturning && (
              <YourRankings rankings={rankings} onDeleted={removeFromList} />
            )}

            {!isReturning && <HowItWorks />}

            <section className="home-section" aria-labelledby="templates-heading">
              <div className="home-section-head">
                <h2 id="templates-heading">Start from a list</h2>
                <p>Rank one as it is, or edit it first.</p>
              </div>
              <ul className="template-grid">
                {templates.map((template) => (
                  <TemplateCard key={template.id} template={template} onUse={onUseTemplate} />
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function HowItWorks() {
  const steps = [
    ["Add your items", "Anything from 3 to 40 things, or start from a list below."],
    ["Pick one of two", "Choose the one you prefer, or call it equal."],
    ["See your ranking", "The full order appears only once you're done."],
  ];

  return (
    <section className="home-section" aria-labelledby="how-heading">
      <h2 id="how-heading" className="visually-hidden">How it works</h2>
      <ol className="how-steps">
        {steps.map(([title, text], index) => (
          <li key={title}>
            <span className="how-step-num" aria-hidden="true">{index + 1}</span>
            <div>
              <p className="how-step-title">{title}</p>
              <p className="how-step-text">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function YourRankings({
  rankings,
  onDeleted,
}: {
  rankings: RankingSummary[];
  onDeleted: (id: string) => void;
}) {
  const inProgress = rankings.filter((ranking) => ranking.status === "active");
  const finished = rankings.filter((ranking) => ranking.status === "completed");

  return (
    <section className="home-section" aria-labelledby="yours-heading">
      <div className="home-section-head">
        <h2 id="yours-heading">Your rankings</h2>
        <p className="saved-note">
          <LockIcon /> Saved in this browser only
        </p>
      </div>

      {inProgress.length > 0 && (
        <RankingGroup label="In progress" rankings={inProgress} onDeleted={onDeleted} />
      )}
      {finished.length > 0 && (
        <RankingGroup label="Finished" rankings={finished} onDeleted={onDeleted} />
      )}
    </section>
  );
}

function RankingGroup({
  label,
  rankings,
  onDeleted,
}: {
  label: string;
  rankings: RankingSummary[];
  onDeleted: (id: string) => void;
}) {
  return (
    <div className="ranking-group">
      <h3 className="ranking-group-label">{label}</h3>
      <ul className="ranking-list">
        {rankings.map((ranking) => (
          <RankingRow key={ranking.id} ranking={ranking} onDeleted={onDeleted} />
        ))}
      </ul>
    </div>
  );
}

function RankingRow({
  ranking,
  onDeleted,
}: {
  ranking: RankingSummary;
  onDeleted: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useRequestRunner();
  const active = ranking.status === "active";

  const handleDelete = () =>
    run(async () => {
      const result = await api.deleteRanking(ranking.id);
      // Already gone (e.g. deleted in another tab) counts as deleted.
      if (result.ok || result.status === 404) {
        onDeleted(ranking.id);
      } else {
        throw new Error(result.error.message);
      }
    });

  return (
    <li className="ranking-row">
      <div className="ranking-row-main">
        <Link to={`/r/${ranking.id}`} className="ranking-row-title">
          {ranking.title}
        </Link>
        <p className="ranking-row-meta">
          {active
            ? `${ranking.placedItems} of ${ranking.itemCount} placed`
            : `${ranking.itemCount} items`}
          {" · "}
          {active ? "updated " : "finished "}
          {timeAgo(ranking.updatedAt)}
        </p>
        {active && (
          <progress
            className="progress progress--mini"
            value={ranking.placedItems}
            max={ranking.itemCount}
            aria-label={`${ranking.placedItems} of ${ranking.itemCount} placed`}
          />
        )}
        {error && (
          <p className="field-error" role="alert">
            Could not delete. Try again.
          </p>
        )}
      </div>

      {confirming ? (
        <div className="ranking-row-actions">
          <span className="confirm-text">Delete?</span>
          <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirming(false)}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="ranking-row-actions">
          <Link to={`/r/${ranking.id}`} className="btn btn-secondary">
            {active ? "Continue" : "View results"}
          </Link>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${ranking.title}`}
          >
            <TrashIcon size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

function TemplateCard({
  template,
  onUse,
}: {
  template: RankingTemplate;
  onUse: (template: RankingTemplate, mode: "rank" | "edit") => void;
}) {
  const count = template.items.length;
  const preview = template.items.slice(0, 3).join(", ");

  return (
    <li className="template-card">
      <div className="template-card-body">
        <h3 className="template-title">{template.title}</h3>
        <p className="template-description">{template.description}</p>
        <p className="template-preview">
          {preview}, +{count - 3} more
        </p>
      </div>
      <p className="template-meta">
        {count} items · about {estimatedMinutes(count)} min
      </p>
      <div className="template-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onUse(template, "rank")}
          aria-label={`Rank ${template.title} as is`}
        >
          Rank as is <ArrowRightIcon size={16} />
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onUse(template, "edit")}
          aria-label={`Edit ${template.title} first`}
        >
          Edit first
        </button>
      </div>
    </li>
  );
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const timeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

// "3 hours ago", "yesterday", "just now".
function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);

  for (const [unit, size] of timeUnits) {
    if (Math.abs(seconds) >= size) {
      return relativeTime.format(Math.round(seconds / size), unit);
    }
  }

  return "just now";
}
