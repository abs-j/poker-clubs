// Entirely fictional club data for the public demo. Names, results and venues are invented and
// generated from a fixed seed, so every visitor sees the same believable season. Dates are counted
// back from today, so the demo always looks current (Home, monthly points and Wrapped included).
// The payload is built by the same functions the real server uses, so its shape cannot drift.
import { buildClubDashboard, type NightInput } from "../../../api-server/src/lib/club-dashboard.ts";
import { buildTournamentEvent, type TournamentInput } from "../../../api-server/src/lib/tournament-native.ts";

export const DEMO_CLUB_NAME = "Riverside Poker Club";
export const DEMO_VIEWER = "Sam Carter";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Persona = { name: string; skill: number; attendance: number };

// skill: roughly -1 (donates) to +1 (grinds). attendance: chance of turning up on a given night.
export const DEMO_PLAYERS: Persona[] = [
  { name: "Sam Carter", skill: 0.45, attendance: 0.9 },
  { name: "Maya Brooks", skill: 0.8, attendance: 0.85 },
  { name: "Leo Fernandez", skill: 0.25, attendance: 0.75 },
  { name: "Nina Okafor", skill: 0.55, attendance: 0.7 },
  { name: "Theo Larsen", skill: -0.2, attendance: 0.8 },
  { name: "Ivy Chen", skill: 0.1, attendance: 0.65 },
  { name: "Marcus Webb", skill: -0.6, attendance: 0.75 },
  { name: "Zara Haddad", skill: 0.35, attendance: 0.55 },
  { name: "Owen Doyle", skill: -0.35, attendance: 0.6 },
  { name: "Hana Sato", skill: 0.0, attendance: 0.5 },
  { name: "Felix Moreau", skill: -0.8, attendance: 0.55 },
  { name: "Ruby Patel", skill: 0.2, attendance: 0.45 },
  { name: "Caleb Ross", skill: -0.45, attendance: 0.4 },
  { name: "Elena Petrova", skill: 0.6, attendance: 0.35 },
];

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The most recent Thursday that is at least `minAgo` days before `now` (UTC dates, no time zones). */
function lastThursday(now: Date, minAgo: number) {
  const day = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - minAgo * DAY);
  while (day.getUTCDay() !== 4) day.setTime(day.getTime() - DAY);
  return day;
}

export function buildDemoNights(now = new Date()): NightInput[] {
  const random = rng(20260);
  const nights: NightInput[] = [];
  const end = lastThursday(now, 2);
  const start = new Date(end.getTime() - 38 * 7 * DAY);
  for (let day = start; day <= end; day = new Date(day.getTime() + 7 * DAY)) {
    if (random() < 0.12) continue;
    let present = DEMO_PLAYERS.filter((p) => random() < p.attendance);
    while (present.length < 6) present = DEMO_PLAYERS.filter((p) => present.includes(p) || random() < 0.5);
    present = present.slice(0, 10);

    const entries = present.map((p) => {
      const rebuys = random() < 0.32 ? 1 + (random() < 0.3 ? 1 : 0) : 0;
      return { p, buyIn: 20 + rebuys * 10 };
    });
    const pot = entries.reduce((sum, e) => sum + e.buyIn, 0);
    const weights = entries.map((e) => Math.exp(e.p.skill * 0.9 + (random() - 0.5) * 2.6) ** 1.7);
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    // Whole 50c chips, with anything left over going to the biggest stack so the table balances.
    const cashOuts = weights.map((w) => Math.round(((pot * w) / weightTotal) * 2) / 2);
    const biggest = cashOuts.indexOf(Math.max(...cashOuts));
    cashOuts[biggest] = round2(cashOuts[biggest] + (pot - cashOuts.reduce((a, b) => a + b, 0)));

    nights.push({ date: iso(day), players: entries.map((e, index) => ({ name: e.p.name, buyIn: e.buyIn, cashOut: cashOuts[index] })) });
  }
  return nights;
}

function buildTournamentInput(seed: number, date: string, title: string, size: number): TournamentInput {
  const random = rng(seed);
  const field = DEMO_PLAYERS.map((p) => ({ p, roll: p.skill * 0.7 + random() * 1.6 })).sort((a, b) => b.roll - a.roll).slice(0, size);
  const order = field.map((f) => f.p.name);
  const rebuys = new Map(order.map((name) => [name, random() < 0.35 ? 1 : 0]));
  const topUps = new Map(order.map((name) => [name, random() < 0.3]));
  const knockouts = new Map(order.map((name) => [name, 0]));
  order.forEach((name, index) => {
    const busts = (rebuys.get(name) ?? 0) + (index === 0 ? 0 : 1);
    for (let bust = 0; bust < busts; bust += 1) {
      const isFinal = index !== 0 && bust === busts - 1;
      const pool = isFinal ? order.slice(0, index) : order.filter((other) => other !== name);
      const killer = pool[Math.floor(random() * pool.length)];
      knockouts.set(killer, (knockouts.get(killer) ?? 0) + 1);
    }
  });
  return {
    id: `demo-${date}`,
    date,
    title,
    venue: "The Back Room",
    notes: null,
    buyIn: 20,
    topUp: 10,
    bounty: 5,
    startingStack: 10000,
    winnerKeepsBounty: false,
    shares: { first: 50, second: 30, third: 20 },
    players: order.map((name, index) => ({
      name,
      finishPlace: index + 1,
      entries: 1 + (rebuys.get(name) ?? 0),
      topUp: topUps.get(name) ?? false,
      freeEntry: false,
      knockouts: knockouts.get(name) ?? 0,
      payout: null,
    })),
  };
}

export function buildDemoDashboard(now = new Date()) {
  const end = lastThursday(now, 2);
  const saturday = (weeksBack: number) => iso(new Date(end.getTime() - weeksBack * 7 * DAY + 2 * DAY));
  const tournaments = [
    buildTournamentEvent(buildTournamentInput(11, saturday(30), "Spring Classic", 10)),
    buildTournamentEvent(buildTournamentInput(22, saturday(16), "Midwinter Bounty", 12)),
    buildTournamentEvent(buildTournamentInput(33, saturday(5), "Autumn Showdown", 11)),
  ];
  const dashboard = buildClubDashboard({ title: DEMO_CLUB_NAME, nights: buildDemoNights(now), tournaments });
  return { ...dashboard, defaultPlayer: DEMO_VIEWER };
}
