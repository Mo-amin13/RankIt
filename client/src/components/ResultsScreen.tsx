import type { RankedGroup } from "../../../shared/types"
import { AlertIcon, UndoIcon } from "./icons"
import ItemVisual from "./ItemVisual"

type ResultsScreenProp = {
    groups: RankedGroup[];
    title: string;
    onUndo: () => void;
    canUndo: boolean;
    onRestart: () => void;
    onEdit: () => void;
    busy: boolean;
    error: string;
}

export default function ResultsScreen({groups, title, onUndo, canUndo, onRestart, onEdit, busy, error}: ResultsScreenProp) {
  const itemCount = groups.reduce((count, group) => count + group.length, 0)
  const tieCount = groups.filter((group) => group.length > 1).length

  return (
    <section className="page" aria-labelledby="results-heading">
        <header className="page-head">
            <p className="eyebrow">Your ranking</p>
            <h1 id="results-heading" className="page-title">{title}</h1>
            <p className="page-sub">
                {itemCount} items ranked
                {tieCount > 0 && ` · ${tieCount} ${tieCount === 1 ? "tie" : "ties"}`}
            </p>
        </header>

        <ol className="results-list">
            {groups.map((group, index) => (
                <li
                    key={group.map((item) => item.id).join("-")}
                    className={`result-row ${index === 0 ? "result-row--first" : ""}`}
                >
                    <span className="rank-num">
                        <span className="visually-hidden">Rank </span>
                        {index + 1}
                    </span>
                    <div className="result-items">
                        {group.map((item) => (
                            <div key={item.id} className="result-item">
                                <ItemVisual item={item} />
                                <span className="result-name">{item.name}</span>
                            </div>
                        ))}
                        {group.length > 1 && <span className="tie-badge">tied</span>}
                    </div>
                </li>
            ))}
        </ol>

        {error && (
            <p role="alert" className="alert">
                <AlertIcon /> {error}
            </p>
        )}

        <div className="results-actions">
            <button type="button" className="btn btn-ghost" onClick={onUndo} disabled={!canUndo || busy}>
                <UndoIcon /> Undo last choice
            </button>
            <div className="button-group">
                <button type="button" className="btn btn-secondary" onClick={onEdit} disabled={busy}>
                    Edit items
                </button>
                <button type="button" className="btn btn-primary" onClick={onRestart} disabled={busy}>
                    Rank again
                </button>
            </div>
        </div>
    </section>
  )
}
