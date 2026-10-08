import { useEffect } from "react";

// Sets the browser tab title for the current page.
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · PairRank` : "PairRank";
  }, [title]);
}
