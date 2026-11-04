import { useEffect, useRef, useState } from "react";
import { backendAvailable, beagleApi } from "../../api/beagleApi";
import type { HistorySessionItem } from "../../types";

/**
 * History loaded only while the modal is open. The search goes to the backend (title and message
 * text of BeagleDock conversations; title and folder of terminal conversations) with a small delay.
 */
export function useConversationHistory(open: boolean, query: string) {
  const [items, setItems] = useState<HistorySessionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  const load = (term: string) => {
    if (!backendAvailable()) return;
    const id = ++request.current;
    setLoading(true);
    beagleApi
      .getCliHistory(term)
      .then((list) => {
        if (id !== request.current) return;
        setItems(list || []);
        setError("");
      })
      .catch((e: Error) => {
        if (id === request.current) setError(e.message);
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => load(query), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query]);

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((item) => item.id !== id));

  return { items, loading, error, removeItem };
}
