// The widget gallery's sample day: a believable student's data, built fresh around the moment the gallery opens, so a
// preview always shows what the widget is for at its best, whatever the app holds (or does not hold) yet. The gallery
// reads it through StoreOverride; nothing here is ever saved.

import { createStore, StoreApi } from 'zustand';
import { useStore, initialData, AppState, PlannerWeek } from '../store';
import type { ScoreNode } from '../scores';
import { DAY_NAMES, dayName, todayKey } from '../utils';
import { BLOCK_COLORS } from '../theme';

const hm = (m: number) => {
  const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(m / 5) * 5));
  return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
};
const dayOff = (now: Date, n: number) => todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));

/** The sample state, laid out around `now`: a block on now and one next, a half-done list, a week of focus. */
export function sampleState(now: Date = new Date()): AppState {
  const real = useStore.getState();
  const base = initialData();
  const today = todayKey(now);
  const t = now.getTime();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // a block that started 40 minutes ago, then two after it (all inside today)
  const startA = Math.max(0, Math.min(nowMin - 40, 22 * 60 - 200));
  const today_ = dayName(now);
  const blocks = [
    { id: 's-b1', subject: 'Physics', start: hm(startA), end: hm(startA + 90), color: BLOCK_COLORS[0] },
    { id: 's-b2', subject: 'Chemistry', start: hm(startA + 105), end: hm(startA + 165), color: BLOCK_COLORS[1] },
    { id: 's-b3', subject: 'Maths', start: hm(startA + 180), end: hm(startA + 240), color: BLOCK_COLORS[2] },
  ];
  const planner = Object.fromEntries(DAY_NAMES.map((d) => [d, d === today_ ? blocks : [
    { id: 's-' + d + '1', subject: 'Maths', start: '09:00', end: '10:30', color: BLOCK_COLORS[2] },
    { id: 's-' + d + '2', subject: 'Physics', start: '16:00', end: '17:30', color: BLOCK_COLORS[0] },
  ]])) as PlannerWeek;

  const subjects = ['Physics', 'Chemistry', 'Maths'];
  const perDay = [95, 140, 70, 165, 120, 185, 0];
  const sessions = perDay.flatMap((min, i) => {
    const key = dayOff(now, i - 6);
    if (i === 6) min = 75;
    if (!min) return [];
    return [0, 1].map((k) => ({
      id: 's-f' + i + k, dateKey: key, endedAt: t - (6 - i) * 86400000 - k * 3600000,
      netSeconds: Math.round((min * (k ? 0.4 : 0.6)) * 60), taskTitles: [], subject: subjects[(i + k) % 3],
    }));
  });

  const dailyTasks = [
    { id: 's-d1', title: 'Revise rotational motion notes', doneOn: today, createdAt: t, repeat: undefined },
    { id: 's-d2', title: 'Solve 20 integration problems', doneOn: null, createdAt: t, time: hm(nowMin + 120) },
    { id: 's-d3', title: 'Organic reactions flashcards', doneOn: null, createdAt: t },
    { id: 's-d4', title: 'Read chapter 7, thermodynamics', doneOn: today, createdAt: t },
    { id: 's-d5', title: 'Plan tomorrow', doneOn: null, createdAt: t, time: '21:30' },
  ];
  const missions = [
    {
      id: 's-m1', title: 'Physics project report', deadline: dayOff(now, 4), done: false,
      subtasks: [{ id: 'a', title: 'Data', done: true }, { id: 'b', title: 'Graphs', done: true }, { id: 'c', title: 'Write-up', done: false }],
    },
    {
      id: 's-m2', title: 'Chemistry lab record', deadline: dayOff(now, 9), done: false,
      subtasks: [{ id: 'a', title: 'Titration', done: true }, { id: 'b', title: 'Salt analysis', done: false }],
    },
    { id: 's-m3', title: 'Maths assignment 4', deadline: today, done: false, subtasks: [] },
  ];

  const habits = [
    { title: 'Morning revision', p: [1, 1, 1, 0, 1, 1, 1] },
    { title: 'Read 20 pages', p: [1, 0, 1, 1, 0, 1, 0] },
    { title: 'No phone after 10', p: [0, 1, 1, 1, 1, 0, 1] },
    { title: 'Water, 8 glasses', p: [1, 1, 0, 1, 1, 1, 0] },
  ].map((h, n) => ({
    id: 's-h' + n, title: h.title,
    doneDates: h.p.map((on, i) => (on ? dayOff(now, i - 6) : '')).filter(Boolean),
  }));

  const notes = [
    { title: 'Electrostatics formulas', body: "Coulomb's law, field of a dipole, Gauss's law for a sphere and a sheet", pinned: true },
    { title: 'Organic named reactions', body: 'Aldol, Cannizzaro, Reimer-Tiemann, with the reagents for each', pinned: true },
    { title: 'Mock 4 mistakes', body: 'Sign error in work-energy, misread the units in Q17', pinned: true },
    { title: 'Integration tricks', body: 'King property, by parts twice, and when to substitute tan x/2', pinned: false },
    { title: 'Revision plan', body: 'Mechanics this week, then optics and modern physics', pinned: false },
  ].map((n, i) => ({
    id: 's-n' + i, ...n, folder: 'General', tags: [], createdAt: t - i * 7200000, updatedAt: t - i * 7200000, attachments: [],
  }));

  const moods: (1 | 2 | 3 | 4 | 5)[] = [4, 3, 4, 5, 3, 4, 2, 4, 5, 4, 3, 4, 5, 4];
  const journal = moods.map((mood, i) => {
    const key = dayOff(now, i - 14);
    return {
      id: 's-j' + i, dateKey: key, title: '', excerpt: 'A steady day of revision.', mood, rating: mood,
      tags: [], wordCount: 120 + i * 9, pinned: false, createdAt: t - (14 - i) * 86400000, updatedAt: t - (14 - i) * 86400000,
    };
  });

  // a series of mocks, marked, and the next one coming up
  const exam = (id: string, title: string, date: string, parts: number[] | null): ScoreNode[] => {
    const head: ScoreNode = { id, parentId: 's-g', kind: 'exam', title, date, createdAt: t, updatedAt: t } as ScoreNode;
    if (!parts) return [head];
    return [head, ...parts.map((score, i) => ({
      id: id + '-' + i, parentId: id, kind: 'exam', title: subjects[i], score, outOf: 100, createdAt: t + i, updatedAt: t,
    } as ScoreNode))];
  };
  const scores: ScoreNode[] = [
    { id: 's-g', parentId: null, kind: 'group', title: 'JEE Main mocks', createdAt: t, updatedAt: t } as ScoreNode,
    ...exam('s-e1', 'Mock 1', dayOff(now, -40), [58, 64, 52]),
    ...exam('s-e2', 'Mock 2', dayOff(now, -30), [63, 61, 60]),
    ...exam('s-e3', 'Mock 3', dayOff(now, -21), [61, 70, 66]),
    ...exam('s-e4', 'Mock 4', dayOff(now, -12), [70, 68, 71]),
    ...exam('s-e5', 'Mock 5', dayOff(now, -4), [76, 74, 79]),
    ...exam('s-e6', 'Mock 6', dayOff(now, 6), null),
  ];

  const vaultVideos = [
    { title: 'Rotational dynamics, full chapter', resumeAt: 1834 },
    { title: 'Chemical bonding in one shot', resumeAt: 0 },
    { title: 'Definite integrals, properties', resumeAt: 0 },
  ].map((v, i) => ({
    // no video id: the thumbnail shows its carved play mark rather than a picture fetched for a video that is not there
    id: 's-v' + i, videoId: '', url: '', title: v.title, folderId: null, tags: [], addedAt: t - i * 86400000,
    openedAt: t - i * 3600000, notes: [], bookmarks: [], resumeAt: v.resumeAt,
  }));

  const calcHistory = [
    { id: 's-c1', expr: 'sqrt(2*9.8*45)', result: '29.698' },
    { id: 's-c2', expr: '6.022e23*0.25', result: '1.5055e23' },
    { id: 's-c3', expr: 'sin(30)+cos(60)', result: '1' },
  ];

  return {
    ...real,
    ...base,
    // the app's own look and quick shortcuts, so a preview matches the board it will sit on
    settings: {
      ...base.settings,
      name: real.settings.name, theme: real.settings.theme, accent: real.settings.accent, hour24: real.settings.hour24,
      animLevel: 'none', focusGoalMin: 240, focusLastMin: 50, journalCutoffHour: 0,
    },
    quickAccess: real.quickAccess,
    planner, sessions, dailyTasks, missions, habits, notes, journal, scores, vaultVideos, calcHistory,
    deepWork: null,
  } as AppState;
}

/** A read-only store holding the sample state, made once per gallery opening. */
export function makeSampleStore(now: Date = new Date()): StoreApi<AppState> {
  return createStore<AppState>()(() => sampleState(now));
}
