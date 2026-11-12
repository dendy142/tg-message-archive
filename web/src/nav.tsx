import { createContext, useContext } from 'react';
import type { Bootstrap } from './types';
import type { IconName } from './components/Icon';

export type Tab = 'feed' | 'chats' | 'media' | 'stats' | 'settings';
export type FeedKind = 'events' | 'deleted' | 'edited' | 'oneTime' | 'favorite';

export type Route =
  | { name: 'event'; id: number }
  | { name: 'chat'; chatId: number; chatName?: string | null; jumpTo?: string; focusId?: number; compose?: boolean }
  | { name: 'contact'; chatId: number }
  | { name: 'media'; chatId: number; chatName?: string | null }
  | { name: 'stats'; chatId: number; chatName?: string | null }
  | { name: 'search'; q?: string; chatId?: number; chatName?: string | null };

export interface ChoiceOption<T> {
  value: T;
  label: string;
  hint?: string;
  icon?: IconName;
  tone?: 'danger' | 'accent';
}

export interface ChoiceSpec<T> {
  title?: string;
  message?: string;
  options: ChoiceOption<T>[];
  selected?: T;
}

export interface Nav {
  boot: Bootstrap;
  reloadBoot: () => Promise<Bootstrap>;
  tab: Tab;
  setTab: (t: Tab, opts?: { feedKind?: FeedKind }) => void;
  feedIntent: { kind: FeedKind; n: number } | null;
  push: (r: Route) => void;
  pop: () => void;
  toast: (msg: string, tone?: 'ok' | 'err') => void;
  patchCounts: (p: Partial<Bootstrap['counts']>) => void;
  choose: <T>(spec: ChoiceSpec<T>) => Promise<T | null>;
}

export const NavCtx = createContext<Nav | null>(null);
export const useNav = (): Nav => {
  const n = useContext(NavCtx);
  if (!n) throw new Error('NavCtx missing');
  return n;
};

/** Виден ли экран, на котором стоит компонент (скрытые слои стека не опрашивают сервер). */
export const LayerCtx = createContext(true);
export const useLayerActive = () => useContext(LayerCtx);
