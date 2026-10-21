import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet, Button, CellList, CellSimple, Spinner, Typography } from '@maxhub/max-ui';
import type { Category, Priority, Status, Zone } from '../api';
import { ago, place, plural, priorityLabels, statusLabels } from '../labels';
import { bridge } from '../bridge';
import { useNavigation } from '../nav';
import { CategoryTile, Icon, type IconName } from './icons';
import { useTheme } from '../theme';
import { useSession } from '../session';

// Building blocks of the screens. The look follows MAX: grey page, white
// rounded groups, system type. One own detail — incident numbers and house
// codes are shown as an enamel house-number plate.

export function Plate({ children, size = 'medium' }: { children: ReactNode; size?: 'small' | 'medium' | 'large' }) {
  return <span className={`plate plate-${size}`}>{children}</span>;
}

export function Page({ title, subtitle, after, children }: { title: string; subtitle?: ReactNode; after?: ReactNode; children: ReactNode }) {
  const navigation = useNavigation();
  // Opened as a usual page the app has no back button of MAX; it gets its own.
  const ownBack = navigation.canGoBack && !bridge.hasSystemBack;
  const { canSwitchMode } = useSession();
  // The thin row above the title only when there is "back" or the mode
  // switch; the theme button alone does not take a row of its own and sits
  // beside the title instead.
  const topbar = ownBack || canSwitchMode;
  return (
    <div className="page">
      {/* One thin row for "back" and the switches, then the title in the full
          width: a long company name wraps instead of squeezing into a column. */}
      {topbar ? (
        <div className="page-topbar">
          {ownBack ? <button type="button" className="back-link" onClick={navigation.back}>‹ Назад</button> : <span />}
          <div className="page-actions">
            <ModeSwitch />
            <ThemeToggle />
          </div>
        </div>
      ) : null}
      <header className={`page-header${topbar ? '' : ' page-header-solo'}`}>
        <div className="page-title">
          <h1>{title}</h1>
          {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
        </div>
        {after || !topbar ? (
          <div className="page-after">
            {after}
            {topbar ? null : <ThemeToggle />}
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="center-block" role="status" aria-label="Загрузка"><Spinner size={32} /></div>;
}

export function Failure({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div className="center-block">
      <span className="empty-icon empty-icon-error"><Icon name="siren" size={28} /></span>
      <Typography.Body variant="medium">{text}</Typography.Body>
      {retry ? <Button variant="secondary" size="medium" onClick={retry}>Повторить</Button> : null}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={28} /></span>
      <Typography.Title variant="medium-strong">{title}</Typography.Title>
      {text ? <p className="empty-text">{text}</p> : null}
      {action}
    </div>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return <span className={`status status-${status}`}>{statusLabels[status]}</span>;
}

export function Section({ header, children }: { header?: string; children: ReactNode }) {
  return (
    <section className="section">
      {header ? <h2 className="section-header">{header}</h2> : null}
      <CellList mode="island" filled>{children}</CellList>
    </section>
  );
}

export function IncidentCell(props: {
  number: number; title: string | null; category: Category; locationZone: Zone; entranceNumber: number | null; status: Status;
  reportsCount: number; when: string; joined?: boolean; addressLine?: string; priority?: Priority; onClick: () => void;
}) {
  const others = props.reportsCount - (props.joined ? 1 : 0);
  const details = [
    props.addressLine,
    props.title ? place(props) : null,
    ago(props.when),
  ].filter(Boolean).join(', ');
  return (
    <CellSimple
      as="button"
      onClick={props.onClick}
      before={<CategoryTile category={props.category} />}
      title={<span className="incident-title">{props.title ?? place(props)}</span>}
      subtitle={(
        <span className="incident-meta">
          <span className="incident-line">
            <Plate size="small">№ {props.number}</Plate><StatusChip status={props.status} />
            {props.priority === 'high' || props.priority === 'emergency' ? <span className={`tag tag-${props.priority}`}>{priorityLabels[props.priority]}</span> : null}
          </span>
          <span className="incident-details">{details}</span>
          {props.reportsCount > 1 || props.joined ? (
            <span className="incident-people">
              <Icon name="people" size={14} />
              {props.joined
                ? others > 0 ? `Вы и ещё ${others} ${plural(others, 'житель', 'жителя', 'жителей')}` : 'Вы сообщили'
                : `${others} ${plural(others, 'житель', 'жителя', 'жителей')}`}
            </span>
          ) : null}
        </span>
      )}
      showChevron
    />
  );
}

export function StatTile({ value, label, tone = 'default', hint }: { value: ReactNode; label: string; tone?: 'default' | 'accent' | 'warn' | 'good'; hint?: string }) {
  return (
    <div className={`stat stat-${tone}`} title={hint}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

// A big square shortcut on the home screen.
export function QuickAction({ icon, color, title, badge, onClick }: { icon: IconName; color: string; title: string; badge?: number; onClick: () => void }) {
  return (
    <button type="button" className="quick" onClick={onClick}>
      <span className="quick-icon" style={{ background: color }}><Icon name={icon} size={22} /></span>
      <span className="quick-title">{title}</span>
      {badge ? <span className="quick-badge">{badge}</span> : null}
    </button>
  );
}

// A company employee who also lives in a house: switch between the resident
// and the company without changing the account. Shown on every screen.
const modeTitles = { resident: 'Житель', company: 'УК', platform: 'Админ' } as const;
const modeHome = { resident: 'home', company: 'desk', platform: 'platform' } as const;

export function ModeSwitch() {
  const { mode, setMode, canSwitchMode, modes } = useSession();
  const navigation = useNavigation();
  if (!canSwitchMode) return null;
  const go = (next: typeof mode) => {
    if (next === mode) return;
    setMode(next);
    navigation.switchTab(modeHome[next]);
  };
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Режим">
      {modes.map((item) => (
        <button key={item} type="button" role="radio" aria-checked={mode === item} className={mode === item ? 'mode-switch-active' : ''} onClick={() => go(item)}>{modeTitles[item]}</button>
      ))}
    </div>
  );
}

// Light or dark right from any screen.
export function ThemeToggle() {
  const { scheme, toggle } = useTheme();
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label={scheme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} title={scheme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
      <Icon name={scheme === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}

// A bottom sheet over the whole app, the tab bar included. It is moved out of
// the screen (whose entrance animation would trap it below the tab bar) into
// the root of MAX UI, so the theme still applies.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const sheet = (
    <BottomSheet open={open} onClose={onClose} {...(title ? { title } : {})} innerClassNames={{ overlay: 'sheet-overlay', sheet: 'sheet-panel', header: 'sheet-header' }}>
      {children}
    </BottomSheet>
  );
  const root = typeof document === 'undefined' ? null : document.querySelector('.app-root');
  return root ? createPortal(sheet, root) : sheet;
}

// Choices that wrap onto the next line instead of a strip to scroll.
export function Chips<T extends string>({ items, active, onChange, label }: { items: Array<{ id: T; title: string }>; active: T; onChange: (id: T) => void; label?: string }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" role="radio" aria-checked={item.id === active} className={`chip${item.id === active ? ' chip-active' : ''}`} onClick={() => onChange(item.id)}>{item.title}</button>
      ))}
    </div>
  );
}

// Photos of a problem: small in the card, one tap opens it on the whole
// screen to look closer; another tap or "×" closes it.
export function PhotoStrip({ photos }: { photos: string[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length) return null;
  const root = typeof document === 'undefined' ? null : document.querySelector('.app-root');
  const viewer = open === null ? null : (
    <div className="photo-viewer" role="dialog" aria-label="Фото" onClick={() => setOpen(null)}>
      <img src={photos[open]} alt={`Фото ${open + 1} из ${photos.length}`} onClick={(event) => { event.stopPropagation(); if (photos.length > 1) setOpen((open + 1) % photos.length); }} />
      <button type="button" className="photo-viewer-close" aria-label="Закрыть" onClick={() => setOpen(null)}><Icon name="close" size={22} strokeWidth={2.4} /></button>
      {photos.length > 1 ? <span className="photo-viewer-count">{open + 1} из {photos.length} — нажмите на фото, чтобы листать</span> : null}
    </div>
  );
  return (
    <>
      <div className="photos">
        {photos.map((url, index) => (
          <button key={index} type="button" className="photo-open" onClick={() => setOpen(index)} aria-label={`Открыть фото ${index + 1}`}>
            <img src={url} alt={`Фото ${index + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {viewer && root ? createPortal(viewer, root) : viewer}
    </>
  );
}
