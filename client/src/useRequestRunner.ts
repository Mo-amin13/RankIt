import { useCallback, useRef, useState } from "react";

// Runs one request at a time and tracks its error message. Extra clicks or
// key presses while a request is in flight are ignored, so a choice can never
// be sent twice.
export function useRequestRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The ref blocks a second request before React re-renders with busy = true.
  const busyRef = useRef(false);

  const run = useCallback(async (request: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await request();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
