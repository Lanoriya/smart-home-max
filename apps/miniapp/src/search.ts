import { useEffect, useState } from 'react';

// Search as the person types: a short pause before the request, answers to
// older text are dropped (they may come after the newer ones), and results are
// kept for the session, so going back to a typed word is instant.

const cache = new Map<string, unknown>();
const cacheLimit = 300;

export function useSearch<T>(scope: string, query: string, load: (value: string) => Promise<T[]>, options: { minLength?: number; delay?: number } = {}) {
  const { minLength = 2, delay = 250 } = options;
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const value = query.trim();
    if (value.length < minLength) { setItems([]); setLoading(false); setDone(false); return; }
    const key = `${scope}|${value.toLowerCase()}`;
    if (cache.has(key)) { setItems(cache.get(key) as T[]); setLoading(false); setDone(true); return; }
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      load(value)
        .then((result) => {
          if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
          if (current) { setItems(result); setDone(true); }
        })
        .catch(() => { if (current) { setItems([]); setDone(true); } })
        .finally(() => { if (current) setLoading(false); });
    }, delay);
    return () => { current = false; clearTimeout(timer); };
  }, [scope, query]); // eslint-disable-line react-hooks/exhaustive-deps

  return { items, setItems, loading, done };
}
