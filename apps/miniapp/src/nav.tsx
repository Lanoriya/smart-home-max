import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { bridge } from './bridge';

// Screens are a stack per bottom tab. The system "back" button of MAX pops the
// stack; on the root of a tab it is hidden. A screen with steps of its own (a
// form in several steps, an edit mode) takes "back" first: one step back,
// and only from its first step the screen itself is left.

export type Screen =
  | { name: 'home' }
  | { name: 'map'; focusBuildingId?: string }
  | { name: 'incidents' }
  | { name: 'more' }
  | { name: 'neighbours' }
  | { name: 'polls' }
  | { name: 'appointments' }
  | { name: 'desk-polls' }
  | { name: 'desk-poll-new' }
  | { name: 'desk-appointments' }
  | { name: 'desk-stats' }
  | { name: 'desk-joins' }
  | { name: 'services' }
  | { name: 'incident'; ref: string | number }
  | { name: 'new-incident' }
  | { name: 'join-house'; buildingId: string; address: string; change?: boolean }
  | { name: 'announcements' }
  | { name: 'contacts' }
  | { name: 'company-info' }
  | { name: 'duties' }
  | { name: 'privacy' }
  | { name: 'desk-duties' }
  | { name: 'platform-duties' }
  | { name: 'invite'; token: string }
  | { name: 'desk' }
  | { name: 'desk-incidents'; status?: string }
  | { name: 'desk-incident'; id: string }
  | { name: 'desk-houses' }
  | { name: 'desk-apartments'; buildingId: string; address: string }
  | { name: 'desk-broadcast'; buildingId?: string }
  | { name: 'desk-team' }
  | { name: 'desk-company' }
  | { name: 'desk-services' }
  | { name: 'platform' }
  | { name: 'platform-company'; companyId: string }
  | { name: 'platform-bulk'; companyId?: string }
  | { name: 'platform-connect'; point?: { latitude: number; longitude: number } }
  | { name: 'help'; role?: 'resident' | 'company' | 'platform' };

export type Tab = 'home' | 'map' | 'incidents' | 'neighbours' | 'polls' | 'services' | 'desk' | 'desk-incidents' | 'desk-houses' | 'platform' | 'more';

type Navigation = {
  tab: Tab;
  screen: Screen;
  depth: number;
  push: (screen: Screen) => void;
  replace: (screen: Screen) => void;
  back: () => void;
  switchTab: (tab: Tab, screen?: Screen) => void;
  canGoBack: boolean;
  stepBack: { register: (id: number, handler: () => void) => void; unregister: (id: number) => void };
};

const NavigationContext = createContext<Navigation | null>(null);

export function rootOf(tab: Tab): Screen {
  return { name: tab } as Screen;
}

export function NavigationProvider({ initialTab, initialStack, children }: { initialTab: Tab; initialStack?: Screen[]; children: ReactNode }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stacks, setStacks] = useState<Partial<Record<Tab, Screen[]>>>({ [initialTab]: initialStack ?? [rootOf(initialTab)] });
  const stack = stacks[tab] ?? [rootOf(tab)];

  const update = useCallback((change: (stack: Screen[]) => Screen[]) => {
    setStacks((current) => ({ ...current, [tab]: change(current[tab] ?? [rootOf(tab)]) }));
  }, [tab]);

  const push = useCallback((screen: Screen) => { bridge.haptic('tap'); update((current) => [...current, screen]); }, [update]);
  const replace = useCallback((screen: Screen) => update((current) => [...current.slice(0, -1), screen]), [update]);
  // Step handlers of the screens on top, the latest registered first.
  const handlers = useRef(new Map<number, () => void>());
  const [stepCount, setStepCount] = useState(0);
  const stepBack = useMemo(() => ({
    register: (id: number, handler: () => void) => { handlers.current.set(id, handler); setStepCount(handlers.current.size); },
    unregister: (id: number) => { handlers.current.delete(id); setStepCount(handlers.current.size); },
  }), []);
  const back = useCallback(() => {
    const steps = [...handlers.current.values()];
    const step = steps[steps.length - 1];
    if (step) { bridge.haptic('tap'); step(); return; }
    update((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, [update]);
  const currentTab = useRef(tab);
  currentTab.current = tab;
  const switchTab = useCallback((next: Tab, screen?: Screen) => {
    bridge.haptic('tap');
    // Tapping the tab that is already open: back to its first screen, no
    // need to press "back" several times.
    if (currentTab.current === next && !screen) setStacks((stacks) => ({ ...stacks, [next]: [rootOf(next)] }));
    setTab(next);
    if (screen) setStacks((current) => ({ ...current, [next]: [rootOf(next), screen] }));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stack.length, tab]);

  const canGoBack = stack.length > 1 || stepCount > 0;
  useEffect(() => bridge.backButton(canGoBack ? back : null), [canGoBack, back]);

  const value = useMemo(() => ({ tab, screen: stack[stack.length - 1]!, depth: stack.length, push, replace, back, switchTab, canGoBack, stepBack }), [tab, stack, push, replace, back, switchTab, canGoBack, stepBack]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error('useNavigation outside NavigationProvider');
  return navigation;
}

let nextStepId = 1;

// While `active`, "back" calls `handler` instead of leaving the screen.
export function useStepBack(active: boolean, handler: () => void) {
  const { stepBack } = useNavigation();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const id = nextStepId++;
    stepBack.register(id, () => latest.current());
    return () => stepBack.unregister(id);
  }, [active, stepBack]);
}
