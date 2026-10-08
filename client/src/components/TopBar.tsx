import { Link } from "react-router";
import { LogoMark } from "./icons";

export type Step = "create" | "review" | "rank" | "results";

const steps: { step: Step; label: string }[] = [
  { step: "create", label: "Create" },
  { step: "review", label: "Review" },
  { step: "rank", label: "Rank" },
  { step: "results", label: "Results" },
];

// Header shown on every page. `step` highlights where the visitor is in the
// create → review → rank → results flow; pages outside the flow omit it.
export default function TopBar({ step }: { step?: Step }) {
  const currentIndex = steps.findIndex((entry) => entry.step === step);

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <LogoMark size={22} />
        <span>PairRank</span>
      </Link>
      {step && (
        <ol className="steps" aria-label="Progress">
          {steps.map((entry, index) => (
            <li
              key={entry.step}
              className={`step ${index < currentIndex ? "is-done" : ""}`}
              aria-current={index === currentIndex ? "step" : undefined}
            >
              <span className="step-label">{entry.label}</span>
            </li>
          ))}
        </ol>
      )}
    </header>
  );
}
