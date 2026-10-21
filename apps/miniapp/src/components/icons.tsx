import type { ComponentType, SVGProps } from 'react';
import {
  Bell,
  Building2,
  ChartColumn,
  ClipboardList,
  DoorOpen,
  Droplet,
  Droplets,
  Flame,
  Home,
  KeyRound,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  Phone,
  Plus,
  Share2,
  ShieldCheck,
  Siren,
  Sparkles,
  ArrowUpDown,
  Users,
  Wrench,
  Zap,
  Vote,
  CalendarDays,
  PencilLine,
  Briefcase,
  Inbox,
  Sun,
  Moon,
  Archive,
  Car,
  Send,
  Info,
  LocateFixed,
  X,
} from 'lucide-react';
import type { Category } from '../api';

// One icon set for the whole app (lucide, ISC licence). Categories of
// problems get a coloured rounded tile, like sections in the settings of MAX.

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

export const icons = {
  home: Home,
  map: MapIcon,
  incidents: ClipboardList,
  desk: Briefcase,
  platform: LayoutGrid,
  more: Menu,
  plus: Plus,
  phone: Phone,
  chat: MessageCircle,
  megaphone: Megaphone,
  siren: Siren,
  building: Building2,
  door: DoorOpen,
  pin: MapPin,
  people: Users,
  key: KeyRound,
  share: Share2,
  bell: Bell,
  chart: ChartColumn,
  shield: ShieldCheck,
  edit: PencilLine,
  move: ArrowUpDown,
  inbox: Inbox,
  sun: Sun,
  moon: Moon,
  archive: Archive,
  car: Car,
  send: Send,
  info: Info,
  locate: LocateFixed,
  close: X,
  poll: Vote,
  calendar: CalendarDays,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof icons;

export function Icon({ name, size = 22, strokeWidth = 2 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const Component = icons[name];
  return <Component size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
}

const categoryIcon: Record<Category, IconComponent> = {
  water: Droplet,
  electricity: Zap,
  heating: Flame,
  elevator: ArrowUpDown,
  leak: Droplets,
  cleaning: Sparkles,
  other: Wrench,
};

// Tile colours: recognisable at a glance in a list, readable with white icons
// in both themes.
export const categoryColor: Record<Category, string> = {
  water: '#2f8cff',
  electricity: '#f5a300',
  heating: '#ff6a3d',
  elevator: '#7b61ff',
  leak: '#00a6c0',
  cleaning: '#2fb45a',
  other: '#8a8f98',
};

export function CategoryTile({ category, size = 40 }: { category: Category; size?: number }) {
  const Component = categoryIcon[category];
  return (
    <span className="tile" style={{ width: size, height: size, background: categoryColor[category] }}>
      <Component size={Math.round(size * 0.55)} strokeWidth={2.2} color="#ffffff" aria-hidden="true" />
    </span>
  );
}

// A coloured tile with any icon of the set, for menus and action lists.
export function IconTile({ name, color, size = 32 }: { name: IconName; color: string; size?: number }) {
  const Component = icons[name];
  return (
    <span className="tile" style={{ width: size, height: size, background: color }}>
      <Component size={Math.round(size * 0.58)} strokeWidth={2.2} color="#ffffff" aria-hidden="true" />
    </span>
  );
}
