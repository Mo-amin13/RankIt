import { useEffect } from "react";
import type { Choice, Comparison, RankingProgress } from "../../../shared/types";
import { AlertIcon, UndoIcon } from "./icons";
import ItemVisual from "./ItemVisual";

type ComparisonScreenProp = {
  title: string;
  comparison: Comparison
  progress: RankingProgress
  onChoose: (choice: Choice) => void,
  onUndo: () => void,
  canUndo: boolean,
  busy: boolean,
  error: string
};

export default function ComparisonScreen({ title, comparison, progress, onChoose, onUndo, canUndo, busy, error}: ComparisonScreenProp) {
  // Keyboard shortcuts: ← left, → right, ↓ or = equal, U undo.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || busy) {
        return;
      }

      if (event.key === "ArrowLeft") {
        onChoose("left");
      } else if (event.key === "ArrowRight") {
        onChoose("right");
      } else if (event.key === "ArrowDown" || event.key === "=") {
        onChoose("tie");
      } else if ((event.key === "u" || event.key === "U") && canUndo) {
        onUndo();
      } else {
        return;
      }

      event.preventDefault();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, canUndo, onChoose, onUndo]);

  return (
    <section className="page page--compare" aria-labelledby="compare-heading">
      <div className="compare-head">
        <div className="progress-block">
          <div className="progress-meta">
            <span className="progress-title">{title}</span>
            <label htmlFor="ranking-progress">
              {progress.placedItems} of {progress.totalItems} placed
            </label>
          </div>
          <progress
            id="ranking-progress"
            className="progress"
            value={progress.placedItems}
            max={progress.totalItems}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onUndo}
          disabled={!canUndo || busy}
          aria-keyshortcuts="U"
        >
          <UndoIcon /> Undo
        </button>
      </div>

      <h1 id="compare-heading" className="compare-question">
        Which do you prefer?
      </h1>

      {/* Keyed by comparison so each new pair animates in. */}
      <div className="duel" key={comparison.id} aria-busy={busy}>
        <button
          type="button"
          className="choice"
          onClick={() => onChoose('left')}
          disabled={busy}
          aria-keyshortcuts="ArrowLeft"
        >
          <ItemVisual item={comparison.left} />
          <span className="choice-name">{comparison.left.name}</span>
        </button>
        <button
          type="button"
          className="choice"
          onClick={() => onChoose('right')}
          disabled={busy}
          aria-keyshortcuts="ArrowRight"
        >
          <ItemVisual item={comparison.right} />
          <span className="choice-name">{comparison.right.name}</span>
        </button>
      </div>

      <div className="duel-tie">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onChoose('tie')}
          disabled={busy}
          aria-keyshortcuts="ArrowDown"
        >
          They're equal
        </button>
      </div>

      {error && (
        <p role="alert" className="alert alert--center">
          <AlertIcon /> {error}
        </p>
      )}

      <p className="compare-hint">
        Keyboard: <kbd className="kbd">←</kbd> <kbd className="kbd">→</kbd> choose,{" "}
        <kbd className="kbd">↓</kbd> equal, <kbd className="kbd">U</kbd> undo
      </p>
    </section>
  );
}
