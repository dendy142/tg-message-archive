// Новый раздел: файл ru/<раздел>.ts с `as const`, такой же en/<раздел>.ts
// и строчка здесь и в en/index.ts (ключи сверит тип Translation).
import { common } from './common';
import { settings } from './settings';
import { sheets } from './sheets';
import { onboarding } from './onboarding';
import { lock } from './lock';
import { stats } from './stats';
import { conversation } from './conversation';
import { contact } from './contact';
import { deleteChat } from './deleteChat';
import { event } from './event';
import { feed } from './feed';
import { chats } from './chats';
import { search } from './search';
import { media } from './media';
import { ui } from './ui';
import { viewer } from './viewer';
import { composer } from './composer';
import { charts } from './charts';
import { app } from './app';

const ru = { ...common, ...settings, ...sheets, ...onboarding, ...lock, ...stats, ...conversation, ...contact, ...deleteChat, ...event, ...feed, ...chats, ...search, ...media, ...ui, ...viewer, ...composer, ...charts, ...app } as const;
export type Key = keyof typeof ru;
export type Translation<T> = { [K in keyof T]: string };
export default ru;
