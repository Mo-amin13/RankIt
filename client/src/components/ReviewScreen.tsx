import { maxDecisions } from "../draft";
import type { ImageStatus, RankingItem } from "../types";
import { AlertIcon, ArrowLeftIcon, ArrowRightIcon, LockIcon } from "./icons";
import ItemImage from "./ItemImage";

type ReviewScreenProps = {
  onBack: () => void;
  onStart: () => void;
  title: string;
  items: RankingItem[];
  onImageStatusChange: (id: string, status: ImageStatus) => void;
  busy: boolean;
  error: string;
};

export default function ReviewScreen({
  onBack,
  onStart,
  title,
  items,
  onImageStatusChange,
  busy,
  error
}: ReviewScreenProps) {
  return (
    <section className="page page--wide" aria-labelledby="review-heading">
      <header className="page-head">
        <p className="eyebrow">Review</p>
        <h1 id="review-heading" className="page-title">{title.trim()}</h1>
        <p className="page-sub">
          {items.length} items · at most {maxDecisions(items.length)} quick decisions
        </p>
      </header>

      <ul className="review-grid">
        {items.map((item) => (
          <li key={item.id} className="review-card">
            <ItemImage item={item} onStatusChange={onImageStatusChange} variant="card" />
            <p className="review-card-name">{item.name.trim()}</p>
          </li>
        ))}
      </ul>

      <p className="note">
        <LockIcon /> Starting locks this list. Check your items before continuing.
      </p>

      {error && (
        <p role="alert" className="alert">
          <AlertIcon /> {error}
        </p>
      )}

      <div className="action-row">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
          <ArrowLeftIcon /> Edit list
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Start ranking"} <ArrowRightIcon />
        </button>
      </div>
    </section>
  );
}
