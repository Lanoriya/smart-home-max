import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useSession } from './session';

// What a resident has not seen: updates of their incidents and announcements
// not marked as read. Shown as dots on the tabs.

// emergencies: unresolved emergencies of the house (resident) or of the company (company mode).
type Counts = { incidents: number; announcements: number; emergencies: number; polls: number };
type Unread = Counts & { refresh: () => Promise<void> };

const none: Counts = { incidents: 0, announcements: 0, emergencies: 0, polls: 0 };
const UnreadContext = createContext<Unread>({ ...none, refresh: async () => undefined });

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { me, mode, acting } = useSession();
  const [counts, setCounts] = useState<Counts>(none);
  const asResident = Boolean(me.residence) && mode === 'resident';
  // The platform administrator has no company until they choose one.
  const asCompany = mode === 'company' && Boolean(me.admin) && Boolean(acting);
  const refresh = useCallback(async () => {
    try {
      if (asResident) { setCounts(await api.unread()); return; }
      if (asCompany) {
        const open = await api.desk.incidents({ priority: 'emergency', sort: 'date_desc' });
        setCounts({ ...none, emergencies: open.filter((incident) => incident.status !== 'resolved' && incident.status !== 'rejected').length });
        return;
      }
      setCounts(none);
    } catch { /* the marks wait for the next check */ }
  }, [asResident, asCompany, acting?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Close to real time: every 15 seconds while the app is on the screen, and
  // right away when the person comes back to it.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [refresh]);
  return <UnreadContext.Provider value={{ ...counts, refresh }}>{children}</UnreadContext.Provider>;
}

export function useUnread() {
  return useContext(UnreadContext);
}
