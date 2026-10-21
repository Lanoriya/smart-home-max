import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { actAsCompany, api, errorText, type Me } from './api';
import { setDisplayZone } from './labels';

// Who is using the app: loaded once and refreshed after actions that change
// the person's role or address (binding an apartment, accepting an invite).

// The company whose desk is open. A company administrator always works for
// their own company; the platform administrator picks one.
export type ActingCompany = { id: string; name: string } | null;

// An employee of a company may live in a house too: the app is used either
// as a resident or as the company, switched without changing the account.
export type Mode = 'resident' | 'company' | 'platform';
const modeKey = 'domoved-mode';

type Session = {
  me: Me; refresh: () => Promise<void>; acting: ActingCompany; setActing: (company: ActingCompany) => void;
  mode: Mode; setMode: (mode: Mode) => void; canSwitchMode: boolean; modes: Mode[];
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: (state: { error: string | null; retry: () => void }) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActingState] = useState<ActingCompany>(null);
  const [savedMode, setSavedMode] = useState<Mode | null>(() => {
    try { const value = localStorage.getItem(modeKey); return value === 'resident' || value === 'company' || value === 'platform' ? value : null; } catch { return null; }
  });
  const setMode = useCallback((next: Mode) => {
    setSavedMode(next);
    try { localStorage.setItem(modeKey, next); } catch { /* the choice lives until the app is closed */ }
  }, []);
  const setActing = useCallback((company: ActingCompany) => {
    actAsCompany(company?.id ?? null);
    setActingState(company);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!me) return <>{fallback({ error, retry: () => { setError(null); void refresh(); } })}</>;
  const own = me.admin && me.admin.role !== 'platform_admin' ? me.admin.company : null;
  // Company staff: resident or company. The platform administrator: also the
  // administration of all companies.
  const isPlatform = me.admin?.role === 'platform_admin';
  const modes: Mode[] = isPlatform ? ['resident', 'company', 'platform'] : own ? ['resident', 'company'] : ['resident'];
  const canSwitchMode = modes.length > 1;
  // Without a remembered choice: the administration for the platform
  // administrator, the company for staff who have no apartment.
  const startMode: Mode = isPlatform ? 'platform' : own && !me.residence ? 'company' : 'resident';
  const mode: Mode = savedMode && modes.includes(savedMode) ? savedMode : startMode;
  // Dates on the clock of the resident's house or of the company's city.
  setDisplayZone(mode === 'resident' ? me.residence?.timeZone : mode === 'company' ? me.admin?.timeZone : null);
  return <SessionContext.Provider value={{ me, refresh, acting: own ?? acting, setActing, mode, setMode, canSwitchMode, modes }}>{children}</SessionContext.Provider>;
}

// Loads data for a screen and reloads it on demand.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
