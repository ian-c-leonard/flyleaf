import releases from '@content/changelog.json' with { type: 'json' };
import { calendarDate } from './date-display.ts';

export type Release = { version: string; date: string; changes: string[] };

/** Plain-language site history, newest release first. */
export const changelog: Release[] = releases;
/** The newest release, or undefined while the family has none. */
export const currentRelease: Release | undefined = changelog[0];

/** "2026-10-16" → "16 October 2026", as the book writes dates. */
export const releaseDate = calendarDate;
