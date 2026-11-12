import type { ReactNode } from 'react';

const S = (d: string) => <path d={d} />;

const PATHS = {
  inbox: <>{S('M22 12h-6l-2 3h-4l-2-3H2')}{S('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z')}</>,
  chat: S('M7.9 20A9 9 0 1 0 4 16.1L2 22Z'),
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" />{S('m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21')}</>,
  chart: <>{S('M3 3v16a2 2 0 0 0 2 2h16')}{S('M18 17V9')}{S('M13 17V5')}{S('M8 17v-3')}</>,
  settings: <>{S('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z')}<circle cx="12" cy="12" r="3" /></>,
  search: <><circle cx="11" cy="11" r="7.5" />{S('m20.5 20.5-4.2-4.2')}</>,
  more: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  star: S('M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z'),
  starFill: <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95L12 2.5z" fill="currentColor" />,
  trash: <>{S('M3 6h18')}{S('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6')}{S('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')}{S('M10 11v6')}{S('M14 11v6')}</>,
  pencil: <>{S('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z')}{S('m15 5 4 4')}</>,
  flame: S('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z'),
  send: <>{S('M12 19V5')}{S('m5 12 7-7 7 7')}</>,
  chevronRight: S('m9 18 6-6-6-6'),
  chevronDown: S('m6 9 6 6 6-6'),
  close: <>{S('M18 6 6 18')}{S('m6 6 12 12')}</>,
  download: <>{S('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4')}{S('m7 10 5 5 5-5')}{S('M12 15V3')}</>,
  share: <>{S('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8')}{S('m16 6-4-4-4 4')}{S('M12 2v13')}</>,
  bell: <>{S('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9')}{S('M10.3 21a1.94 1.94 0 0 0 3.4 0')}</>,
  bellOff: <>{S('M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5')}{S('M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7')}{S('M10.3 21a1.94 1.94 0 0 0 3.4 0')}{S('m2 2 20 20')}</>,
  user: <>{S('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2')}<circle cx="12" cy="7" r="4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" />{S('M16 2v4')}{S('M8 2v4')}{S('M3 10h18')}</>,
  archive: <><rect x="2" y="3" width="20" height="5" rx="1" />{S('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8')}{S('M10 12h4')}</>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" />{S('M7 11V7a5 5 0 0 1 10 0v4')}</>,
  unlock: <><rect x="3" y="11" width="18" height="11" rx="2" />{S('M7 11V7a5 5 0 0 1 9.9-1')}</>,
  clock: <><circle cx="12" cy="12" r="10" />{S('M12 6v6l4 2')}</>,
  globe: <><circle cx="12" cy="12" r="10" />{S('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20')}{S('M2 12h20')}</>,
  tag: <>{S('M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z')}<circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></>,
  eye: <>{S('M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z')}<circle cx="12" cy="12" r="3" /></>,
  check: S('M20 6 9 17l-5-5'),
  checks: <>{S('M18 6 7 17l-5-5')}{S('m22 10-7.5 7.5L13 16')}</>,
  play: <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></>,
  mic: <>{S('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z')}{S('M19 10v2a7 7 0 0 1-14 0v-2')}{S('M12 19v3')}</>,
  music: <>{S('M9 18V5l12-2v13')}<circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  file: <>{S('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z')}{S('M14 2v4a2 2 0 0 0 2 2h4')}</>,
  video: <>{S('m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5')}<rect x="2" y="6" width="14" height="12" rx="2" /></>,
  circleVideo: <><circle cx="12" cy="12" r="10" />{S('m10 8.5 5 3.5-5 3.5z')}</>,
  smile: <><circle cx="12" cy="12" r="10" />{S('M8 14s1.5 2 4 2 4-2 4-2')}{S('M9 9h.01')}{S('M15 9h.01')}</>,
  pin: <>{S('M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0')}<circle cx="12" cy="10" r="3" /></>,
  paperclip: S('m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'),
  reply: <>{S('M9 17 4 12l5-5')}{S('M20 18v-2a4 4 0 0 0-4-4H4')}</>,
  forward: <>{S('m15 17 5-5-5-5')}{S('M4 18v-2a4 4 0 0 1 4-4h12')}</>,
  external: <>{S('M15 3h6v6')}{S('M10 14 21 3')}{S('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6')}</>,
  refresh: <>{S('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8')}{S('M21 3v5h-5')}{S('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16')}{S('M8 16H3v5')}</>,
  plus: <>{S('M5 12h14')}{S('M12 5v14')}</>,
  arrowDown: <>{S('M12 5v14')}{S('m19 12-7 7-7-7')}</>,
  filter: S('M22 3H2l8 9.46V19l4 2v-8.54L22 3z'),
  copy: <><rect x="8" y="8" width="14" height="14" rx="2" />{S('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')}</>,
  alert: <>{S('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3')}{S('M12 9v4')}{S('M12 17h.01')}</>,
  shield: S('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'),
  bot: <>{S('M12 8V4H8')}<rect x="4" y="8" width="16" height="12" rx="2" />{S('M2 14h2')}{S('M20 14h2')}{S('M15 13v2')}{S('M9 13v2')}</>,
  hourglass: <>{S('M5 22h14')}{S('M5 2h14')}{S('M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22')}{S('M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2')}</>,
  fingerprint: <>{S('M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4')}{S('M14 13.12c0 2.38 0 6.38-1 8.88')}{S('M17.29 21.02c.12-.6.43-2.3.5-3.02')}{S('M2 12a10 10 0 0 1 18-6')}{S('M2 16h.01')}{S('M21.8 16c.2-2 .13-5.35 0-6')}{S('M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2')}{S('M8.65 22c.21-.66.45-1.32.57-2')}{S('M9 6.8a6 6 0 0 1 9 5.2v2')}</>,
  info: <><circle cx="12" cy="12" r="10" />{S('M12 16v-4')}{S('M12 8h.01')}</>,
  chatOff: <>{S('M20.5 14.9A9 9 0 0 0 9.1 3.5')}{S('m2 2 20 20')}{S('M5.6 5.6C3 8.3 2.2 12.5 4 16l-2 6 6-2c3.4 1.8 7.6 1.1 10.3-1.7')}</>,
  moon: S('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
  eyeOff: <>{S('M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68')}{S('M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61')}{S('M9.88 9.88a3 3 0 1 0 4.24 4.24')}{S('m2 2 20 20')}</>,
  timer: <>{S('M10 2h4')}{S('M12 14l3-3')}<circle cx="12" cy="14" r="8" /></>,
  users: <>{S('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2')}<circle cx="9" cy="7" r="4" />{S('M22 21v-2a4 4 0 0 0-3-3.87')}{S('M16 3.13a4 4 0 0 1 0 7.75')}</>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className, strokeWidth = 1.9 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`ico${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

export function mediaIconName(t: string | null): IconName {
  if (!t) return 'chat';
  if (t === 'photo' || t === 'live_photo') return 'image';
  if (t === 'video' || t === 'animation') return 'video';
  if (t === 'video_note') return 'circleVideo';
  if (t === 'voice') return 'mic';
  if (t === 'audio') return 'music';
  if (t === 'document') return 'file';
  if (t === 'sticker') return 'smile';
  if (t === 'location' || t === 'venue') return 'pin';
  if (t === 'contact') return 'user';
  return 'paperclip';
}

export function mediaColor(t: string | null): string {
  if (t === 'photo' || t === 'live_photo') return '#34aadc';
  if (t === 'video' || t === 'animation' || t === 'video_note') return '#af52de';
  if (t === 'voice') return '#ff9500';
  if (t === 'audio') return '#ff2d55';
  if (t === 'document') return '#007aff';
  if (t === 'location' || t === 'venue') return '#34c759';
  return '#8e8e93';
}
