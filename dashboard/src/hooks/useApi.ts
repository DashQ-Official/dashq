import { useState, useEffect, useRef } from "react";

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetcherRef.current().then(
      (result) => {
        if (active) {
          setData(result);
          setError(null);
          setLoading(false);
        }
      },
      (e: unknown) => {
        if (active) {
          setError(e as Error);
          setLoading(false);
        }
      },
    );

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
