import { Router, type IRouter, type Request, type Response as ExpressResponse } from "express";
import { adminClubId, memberClubId, requireAdminSession, requireMemberSession, type AuthSession } from "../lib/auth";
import { isClubAdmin, resolveClubContext } from "../lib/club-access";
import { canManageNight, LedgerPermissionError, type LedgerActor } from "../lib/ledger-permissions";
import { liveSessionRole } from "../lib/live-activity";
import { changeSettled, getNightSettlement, loadSettleUp, recordedSessionNumbers } from "../lib/night-settlement";
import { recordAdminAction } from "../lib/admin-audit";
import { commitTournamentImport, deleteTournament, getTournament, listTournaments, loadTournamentInputs, previewTournamentImport, recordTournament, updateTournament } from "../lib/club-tournaments";
import { parseTournamentImport } from "../lib/tournament-import";
import Anthropic from "@anthropic-ai/sdk";
import { NotesImageError, readNightFromImage, validateNotesImage } from "../lib/notes-image";
import { buildTournamentEvent, validateTournament } from "../lib/tournament-native";
import { addJackpotDeposit, deleteJackpotDeposit, deleteJackpotPayout, setNightJackpot, updateJackpotPayout } from "../lib/club-sessions";
import { AiNotesError, MAX_NOTES_CHARS, readNightWithAi } from "../lib/ai-notes";
import { getClubAiConfig, getClubAiStatus, updateClubAi } from "../lib/club-ai";
import { cleanNightNote, clubJackpot, commitImport, deleteNight, listNightNotes, recordManualNight, setNightNote, JackpotInputError, listClubNights, loadJackpotPayoutsForExport, loadNightsForExport, previewImport, recordJackpotPayout, setLedgerResolution, undoImport, updateNight } from "../lib/club-sessions";
import { loadGameTools } from "../lib/game-tools";
import { parseResolution } from "../lib/night-balance";
import { nightsToCsv, tournamentsToCsv } from "../lib/export-csv";
import { getClubSettings } from "../lib/club-settings";
import {
  parseDate,
  parseHistory,
  parseMoney,
  sheetExportUrl,
  type DateOrder,
} from "../lib/import-parse";

const router: IRouter = Router();

/** Club owner or admin. A signed-in member gets 403; anyone else gets 401. */
async function requireClubAdmin(req: Request, res: ExpressResponse): Promise<boolean> {
  const context = await resolveClubContext(req);
  if (!context) {
    res.status(401).json({ error: "Sign in required." });
    return false;
  }
  if (!isClubAdmin(context.role)) {
    res.status(403).json({ error: "Only a club admin can change recorded games." });
    return false;
  }
  res.locals.adminSession = {
    role: "admin",
    memberName: context.memberName,
    clubId: context.clubId,
    clubRole: context.role,
    userId: context.userId,
  };
  return true;
}

function nightId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** { date, players: [{ name, buyIn, cashOut }] } shared by recording and editing a cash night. */
function readNightBody(body: { date?: unknown; players?: unknown }):
  | { date: string; players: Array<{ name: string; buyIn: number; cashOut: number }> }
  | { error: string } {
  const date = typeof body?.date === "string" ? parseDate(body.date) : null;
  if (!date) return { error: "Choose the date of the night." };
  const rows: unknown[] = Array.isArray(body?.players) ? body.players : [];
  const players: Array<{ name: string; buyIn: number; cashOut: number }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const entry = row as { name?: unknown; buyIn?: unknown; cashOut?: unknown };
    const name = typeof entry.name === "string" ? entry.name.trim().replace(/\s+/g, " ") : "";
    if (!name) continue;
    const buyIn = parseMoney(String(entry.buyIn ?? ""));
    const cashOut = parseMoney(String(entry.cashOut ?? ""));
    if (name.length > 40 || buyIn === null || cashOut === null || buyIn < 0 || cashOut < 0) {
      return { error: `Check the amounts for ${name || "a player"}.` };
    }
    if (seen.has(name.toLowerCase())) return { error: `${name} is listed twice.` };
    seen.add(name.toLowerCase());
    if (buyIn > 0 || cashOut > 0) players.push({ name, buyIn, cashOut });
  }
  if (players.length < 2) return { error: "Add at least two players with a buy-in or cash-out." };
  if (players.length > 100) return { error: "That's more than 100 players for one night." };
  return { date, players };
}

function ledgerActor(res: { locals: { memberSession?: AuthSession } }): LedgerActor | null {
  const session = res.locals.memberSession;
  if (!session?.memberName) return null;
  return { name: session.memberName, isAdmin: isClubAdmin(session.clubRole ?? "member") };
}


router.use("/clubs/current", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const MAX_SHEET_BYTES = 2_000_000;

class InputError extends Error {}

/** The text to import: pasted text, or a public Google Sheet fetched from its CSV export. */
async function sourceText(body: { text?: unknown; sheetUrl?: unknown }): Promise<string> {
  if (typeof body.sheetUrl === "string" && body.sheetUrl.trim()) {
    const url = sheetExportUrl(body.sheetUrl.trim());
    if (!url) throw new InputError("That isn't a Google Sheets link. Copy the address from the sheet's page.");
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    } catch {
      throw new InputError("Couldn't reach Google Sheets. Try again in a moment.");
    }
    const text = await response.text();
    if (!response.ok || /^\s*<(?:!doctype|html)/i.test(text)) {
      throw new InputError('Couldn\'t read that sheet. Set sharing to "Anyone with the link can view", or paste the rows instead.');
    }
    if (text.length > MAX_SHEET_BYTES) throw new InputError("That sheet is too large. Import it in smaller parts.");
    return text;
  }
  if (typeof body.text === "string") return body.text;
  throw new InputError("Paste your results, choose a file, or give a Google Sheets link.");
}

function readInput(body: Record<string, unknown>) {
  const dateOrder: DateOrder = body.dateOrder === "mdy" ? "mdy" : "dmy";
  return { dateOrder };
}

router.post("/clubs/current/import/preview", requireAdminSession, async (req, res): Promise<void> => {
  try {
    const parsed = parseHistory(await sourceText(req.body ?? {}), readInput(req.body ?? {}));
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.json({
      preview: await previewImport(adminClubId(res), parsed.nights),
      warnings: parsed.warnings,
      rowsRead: parsed.rowsRead,
      rowsSkipped: parsed.rowsSkipped,
    });
  } catch (error) {
    if (error instanceof InputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/clubs/current/import", requireAdminSession, async (req, res): Promise<void> => {
  try {
    const parsed = parseHistory(await sourceText(req.body ?? {}), readInput(req.body ?? {}));
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const session = res.locals.adminSession as { memberName?: string | null };
    const result = await commitImport(adminClubId(res), session.memberName ?? null, parsed.nights, "import");
    await recordAdminAction(
      "history_imported",
      `Imported ${result.imported} night(s); ${result.duplicates} already recorded were skipped.`,
      req,
    );
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof InputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.delete("/clubs/current/import/:batchId", requireAdminSession, async (req, res): Promise<void> => {
  const batchId = String(req.params.batchId ?? "");
  if (!/^[0-9a-f-]{36}$/.test(batchId)) {
    res.status(400).json({ error: "Invalid import." });
    return;
  }
  const removed = await undoImport(adminClubId(res), batchId);
  await recordAdminAction("history_import_undone", `Undid an import (${removed} night(s) removed).`, req);
  res.json({ removed });
});

/** What to do with a gap in tonight's ledger. Applied when the ledger closes; the host or an admin. */
router.put("/clubs/current/ledger/resolution", requireMemberSession, async (req, res): Promise<void> => {
  const resolution = parseResolution(req.body);
  if (!resolution) {
    res.status(400).json({ error: "Choose how to balance the ledger." });
    return;
  }
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  try {
    const result = await setLedgerResolution(memberClubId(res), resolution, actor);
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    await recordAdminAction("ledger_balanced", `Chose "${resolution.mode}" for a ledger out by ${(result.cents / 100).toFixed(2)} (${result.direction}).`, req);
    res.json({ mode: resolution.mode, direction: result.direction, cents: result.cents });
  } catch (error) {
    if (error instanceof LedgerPermissionError) {
      res.status(403).json({ error: error.message });
      return;
    }
    throw error;
  }
});

/** The club's bad beat jackpot so far: surplus from balanced nights, minus payouts. */
router.get("/clubs/current/jackpot", requireMemberSession, async (_req, res): Promise<void> => {
  const admin = isClubAdmin(res.locals.memberSession?.clubRole ?? "member");
  res.json(await clubJackpot(memberClubId(res), { admin }));
});

/** Runs a jackpot change, turning an input problem into a 400 and recording it for the audit log. */
async function jackpotChange(req: Request, res: ExpressResponse, detail: string, change: () => Promise<unknown | null>): Promise<void> {
  try {
    const result = await change();
    if (result === null) {
      res.status(404).json({ error: "That entry no longer exists." });
      return;
    }
    await recordAdminAction("jackpot_changed", detail, req);
    res.json(result);
  } catch (error) {
    if (error instanceof JackpotInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
}

const entryId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** Admin: add money to the pot directly, with an optional note. */
router.post("/clubs/current/jackpot/deposits", requireAdminSession, async (req, res): Promise<void> => {
  await jackpotChange(req, res, "Added money to the jackpot.", () => addJackpotDeposit(adminClubId(res), res.locals.adminSession?.memberName ?? res.locals.memberSession?.memberName ?? "admin", req.body ?? {}));
});

router.delete("/clubs/current/jackpot/deposits/:id", requireAdminSession, async (req, res): Promise<void> => {
  const id = entryId(req.params.id);
  if (id === null) return void res.status(400).json({ error: "Invalid entry." });
  await jackpotChange(req, res, `Removed jackpot deposit #${id}.`, () => deleteJackpotDeposit(adminClubId(res), id));
});

/** Admin: change a payout's player or amount. */
router.patch("/clubs/current/jackpot/payouts/:id", requireAdminSession, async (req, res): Promise<void> => {
  const id = entryId(req.params.id);
  if (id === null) return void res.status(400).json({ error: "Invalid entry." });
  await jackpotChange(req, res, `Edited jackpot payout #${id}.`, () => updateJackpotPayout(adminClubId(res), id, req.body ?? {}));
});

router.delete("/clubs/current/jackpot/payouts/:id", requireAdminSession, async (req, res): Promise<void> => {
  const id = entryId(req.params.id);
  if (id === null) return void res.status(400).json({ error: "Invalid entry." });
  await jackpotChange(req, res, `Removed jackpot payout #${id}.`, async () => ((await deleteJackpotPayout(adminClubId(res), id)) ? await clubJackpot(adminClubId(res), { admin: true }) : null));
});

/** Admin: set how much of a night's surplus is in the pot (0 takes it out). */
router.put("/clubs/current/nights/:id/jackpot", requireAdminSession, async (req, res): Promise<void> => {
  const id = entryId(req.params.id);
  if (id === null) return void res.status(400).json({ error: "Invalid night." });
  await jackpotChange(req, res, `Changed the jackpot surplus of night #${id}.`, () => setNightJackpot(adminClubId(res), id, (req.body ?? {}).amount));
});

/** Host or admin: pay some of the jackpot to one player. The running total goes down by that amount. */
router.post("/clubs/current/jackpot/payouts", requireMemberSession, async (req, res): Promise<void> => {
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const role = await liveSessionRole(actor, memberClubId(res));
  if (!canManageNight(actor, role.hostName ?? "")) {
    res.status(403).json({ error: "Only the host or an admin can record a jackpot payout." });
    return;
  }
  try {
    const view = await recordJackpotPayout(memberClubId(res), actor.name, req.body ?? {}, { admin: actor.isAdmin });
    await recordAdminAction("jackpot_paid", `Paid ${view.payouts[0] ? `${view.payouts[0].amount.toFixed(2)} to ${view.payouts[0].name}` : "a jackpot payout"}. ${view.total.toFixed(2)} remains.`, req);
    res.status(201).json(view);
  } catch (error) {
    if (error instanceof JackpotInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

/** What the viewer still owes or is owed, and how settled each recent night is. */
router.get("/clubs/current/settle-up", requireMemberSession, async (_req, res): Promise<void> => {
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  res.json(await loadSettleUp(memberClubId(res), actor.name));
});

function nightIdParam(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Who owes and is owed on one night, and who has settled. */
router.get("/clubs/current/nights/:id/settlement", requireMemberSession, async (req, res): Promise<void> => {
  const actor = ledgerActor(res);
  const id = nightIdParam(String(req.params.id));
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const settlement = id === null ? null : await getNightSettlement(memberClubId(res), id, actor);
  if (!settlement) {
    res.status(404).json({ error: "That night has no settle-up." });
    return;
  }
  res.json(settlement);
});

/** Ticks or unticks a player as settled: { name, settled } for one person, { all: true, settled } for everyone. */
router.put("/clubs/current/nights/:id/settlement", requireMemberSession, async (req, res): Promise<void> => {
  const actor = ledgerActor(res);
  const id = nightIdParam(String(req.params.id));
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const body = (req.body ?? {}) as { name?: unknown; all?: unknown; settled?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (typeof body.settled !== "boolean" || (body.all !== true && (!name || name.length > 80))) {
    res.status(400).json({ error: "Choose who to tick off." });
    return;
  }
  try {
    const settlement = id === null
      ? null
      : await changeSettled(memberClubId(res), id, actor, body.all === true ? { all: true, settled: body.settled } : { name, settled: body.settled });
    if (!settlement) {
      res.status(404).json({ error: "That night has no settle-up." });
      return;
    }
    res.json(settlement);
  } catch (error) {
    if (error instanceof LedgerPermissionError) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message.includes("nothing to settle")) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/clubs/current/sessions", requireAdminSession, async (_req, res): Promise<void> => {
  res.json({ sessions: await listClubNights(adminClubId(res)) });
});

/** Which Games cards an admin can edit or delete, and whether this person can reopen the latest night. */
router.get("/clubs/current/game-tools", requireMemberSession, async (_req, res): Promise<void> => {
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  res.json(await loadGameTools(memberClubId(res), actor));
});

/** Replaces the players and date of a hand-entered or imported night. Admin only. */
router.patch("/clubs/current/sessions/:id", async (req, res): Promise<void> => {
  if (!(await requireClubAdmin(req, res))) return;
  const id = nightId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid night." });
    return;
  }
  const night = readNightBody(req.body ?? {});
  if ("error" in night) {
    res.status(400).json({ error: night.error });
    return;
  }
  const outcome = await updateNight(adminClubId(res), id, {
    date: night.date,
    players: night.players.map((player) => ({
      name: player.name,
      buyInCents: Math.round(player.buyIn * 100),
      cashOutCents: Math.round(player.cashOut * 100),
    })),
  });
  if (outcome === "missing") {
    res.status(404).json({ error: "That night no longer exists." });
    return;
  }
  if (outcome === "live") {
    res.status(409).json({ error: "This night came from the live ledger. Reopen it to change the entries." });
    return;
  }
  await recordAdminAction("night_edited", `Edited recorded night #${id}.`, req);
  res.json({ id, date: night.date, players: night.players.length });
});

router.delete("/clubs/current/sessions/:id", async (req, res): Promise<void> => {
  if (!(await requireClubAdmin(req, res))) return;
  const id = nightId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid night." });
    return;
  }
  const outcome = await deleteNight(adminClubId(res), id);
  if (outcome === "missing") {
    res.status(404).json({ error: "That night no longer exists." });
    return;
  }
  if (outcome === "jackpot") {
    res.status(409).json({
      error: "This night added money to the jackpot that has already been paid out. Deleting it would leave the pot short.",
    });
    return;
  }
  await recordAdminAction("night_deleted", `Deleted recorded night #${id}.`, req);
  res.status(204).end();
});

/** Records a tournament: who finished where, entries, knockouts and optionally payouts. The host or an admin. */
router.post("/clubs/current/tournaments", requireMemberSession, async (req, res): Promise<void> => {
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const role = await liveSessionRole(actor, memberClubId(res));
  if (!canManageNight(actor, role.hostName ?? "")) {
    res.status(403).json({ error: "Only the host or an admin can record a tournament." });
    return;
  }
  const checked = validateTournament(req.body, "new");
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const id = await recordTournament(memberClubId(res), actor.name, checked.value);
  const event = buildTournamentEvent(checked.value);
  await recordAdminAction("night_recorded", `Recorded tournament "${event.title}" (${event.players} players).`, req);
  res.status(201).json({
    id,
    players: event.players,
    totalCollected: event.totalCollected,
    mainPrizePool: event.mainPrizePool,
    // "OK" when what was paid out matches what was collected; otherwise says by how much it differs.
    dataCheck: event.dataCheck,
  });
});

router.get("/clubs/current/tournaments", requireAdminSession, async (_req, res): Promise<void> => {
  res.json({ tournaments: await listTournaments(adminClubId(res)) });
});

const NOTES_IMAGES_PER_CLUB_PER_DAY = 20;
const notesImageUse = new Map<number, { day: string; count: number }>();

/** Counts one use for the club today; false once the daily cap is reached. Per server instance, like the other rate limits. */
function takeNotesImageUse(clubId: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = notesImageUse.get(clubId);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= NOTES_IMAGES_PER_CLUB_PER_DAY) return false;
  notesImageUse.set(clubId, { day, count: count + 1 });
  return true;
}

/** Reads a screenshot of notes into text lines. The site then fills the form from them, and nothing is saved here. */
router.post("/clubs/current/sessions/notes-image", requireMemberSession, async (req, res): Promise<void> => {
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  // Reading a picture costs money, so only the host of the open night (or an admin) can ask for it.
  const role = await liveSessionRole(actor, memberClubId(res));
  if (role.status !== "open" || !role.canManage) {
    res.status(403).json({ error: "Only the host of the open night or an admin can read notes into it." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "Reading screenshots isn't switched on for this site. Paste the text instead." });
    return;
  }
  const checked = validateNotesImage(req.body);
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  if (!takeNotesImageUse(memberClubId(res))) {
    res.status(429).json({ error: "Your club has used its screenshot reads for today. Paste the text instead, or try tomorrow." });
    return;
  }
  try {
    res.json({ text: await readNightFromImage(checked.value) });
  } catch (error) {
    if (error instanceof NotesImageError) {
      res.status(422).json({ error: error.message });
      return;
    }
    req.log?.error({ err: error instanceof Anthropic.APIError ? { status: error.status, message: error.message } : error }, "notes image read failed");
    res.status(502).json({ error: "Couldn't read that picture right now. Paste the text instead." });
  }
});

/** Record a finished night from notes: date, players, an optional note and how to settle any gap. Admin only. */
router.post("/clubs/current/nights", requireAdminSession, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const night = readNightBody(body);
  if ("error" in night) {
    res.status(400).json({ error: night.error });
    return;
  }
  const notes = cleanNightNote(body.notes);
  if (notes === undefined) {
    res.status(400).json({ error: "Keep the note under 2,000 characters." });
    return;
  }
  const resolution = body.resolution === undefined || body.resolution === null ? null : parseResolution(body.resolution);
  if (body.resolution && !resolution) {
    res.status(400).json({ error: "Choose how to settle the difference." });
    return;
  }
  const result = await recordManualNight(adminClubId(res), {
    date: night.date,
    notes,
    resolution,
    createdBy: res.locals.adminSession?.memberName ?? res.locals.memberSession?.memberName ?? "admin",
    players: night.players.map((player) => ({ name: player.name, buyInCents: Math.round(player.buyIn * 100), cashOutCents: Math.round(player.cashOut * 100) })),
  });
  if ("error" in result) {
    res.status(409).json({ error: result.error });
    return;
  }
  await recordAdminAction("night_recorded", `Recorded a night from notes (#${result.id}, ${result.players} players).`, req);
  res.status(201).json(result);
});

/** Notes for every night, by game number (the numbering the Games cards use). Visible to members. */
router.get("/clubs/current/night-notes", requireMemberSession, async (_req, res): Promise<void> => {
  const clubId = memberClubId(res);
  const [byId, numbers] = await Promise.all([listNightNotes(clubId), recordedSessionNumbers(clubId)]);
  const notes: Record<number, string> = {};
  for (const [id, note] of Object.entries(byId)) {
    const number = numbers.get(Number(id));
    if (number !== undefined) notes[number] = note;
  }
  res.json({ notes });
});

router.put("/clubs/current/nights/:id/notes", requireAdminSession, async (req, res): Promise<void> => {
  const id = nightId(req.params.id);
  const note = cleanNightNote((req.body ?? {}).notes);
  if (id === null) {
    res.status(400).json({ error: "Invalid night." });
    return;
  }
  if (note === undefined) {
    res.status(400).json({ error: "Keep the note under 2,000 characters." });
    return;
  }
  if (!(await setNightNote(adminClubId(res), id, note))) {
    res.status(404).json({ error: "That night no longer exists." });
    return;
  }
  await recordAdminAction("night_note_changed", `Changed the note on night #${id}.`, req);
  res.json({ id, notes: note });
});

const AI_READS_PER_CLUB_PER_DAY = 60;
const aiReadUse = new Map<number, { day: string; count: number }>();
function takeAiRead(clubId: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const entry = aiReadUse.get(clubId);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= AI_READS_PER_CLUB_PER_DAY) return false;
  aiReadUse.set(clubId, { day, count: count + 1 });
  return true;
}

/** Whether the AI reader is set up, for the Record tab. Members only learn on or off. */
router.get("/clubs/current/ai", requireAdminSession, async (_req, res): Promise<void> => {
  res.json(await getClubAiStatus(adminClubId(res)));
});

router.put("/clubs/current/ai", requireAdminSession, async (req, res): Promise<void> => {
  const result = await updateClubAi(adminClubId(res), (req.body ?? {}) as Record<string, unknown>);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  await recordAdminAction("ai_settings_updated", `Updated the AI reader (model ${result.model}, key ${result.keySet ? "set" : "not set"}).`, req);
  res.json(result);
});

/** Reads pasted notes or a photo into lines with the club's own OpenRouter key. Nothing is saved. */
router.post("/clubs/current/record/parse", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const config = await getClubAiConfig(clubId);
  if (!config) {
    res.status(503).json({ error: "The AI reader isn't set up. An admin can add an OpenRouter key in club settings, or you can use the plain reader." });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.slice(0, MAX_NOTES_CHARS + 1) : "";
  if (text.length > MAX_NOTES_CHARS) {
    res.status(400).json({ error: "Those notes are too long. Paste one night at a time." });
    return;
  }
  let image;
  if (body.image) {
    const checked = validateNotesImage(body.image);
    if ("error" in checked) {
      res.status(400).json({ error: checked.error });
      return;
    }
    image = checked.value;
  }
  if (!text.trim() && !image) {
    res.status(400).json({ error: "Paste some notes or choose a picture." });
    return;
  }
  if (!takeAiRead(clubId)) {
    res.status(429).json({ error: "Your club has used its AI reads for today. Use the plain reader, or try tomorrow." });
    return;
  }
  try {
    res.json({ text: await readNightWithAi({ text, image }, config) });
  } catch (error) {
    if (error instanceof AiNotesError) {
      res.status(422).json({ error: error.message });
      return;
    }
    req.log?.error({ err: error }, "AI notes read failed");
    res.status(502).json({ error: "The AI reader couldn't answer right now. Use the plain reader instead." });
  }
});

/** The Tournament Log and Tournament Results tabs, pasted or chosen as CSV files. */
function tournamentTabs(body: Record<string, unknown>) {
  const { logText, resultsText } = body;
  if (typeof logText !== "string" || typeof resultsText !== "string") {
    throw new InputError("Paste or choose both the Tournament Log and the Tournament Results.");
  }
  if (logText.length > MAX_SHEET_BYTES || resultsText.length > MAX_SHEET_BYTES) throw new InputError("Those tabs are too large. Import them in smaller parts.");
  const parsed = parseTournamentImport(logText, resultsText);
  if (parsed.error) throw new InputError(parsed.error);
  return parsed;
}

router.post("/clubs/current/tournaments/import/preview", requireAdminSession, async (req, res): Promise<void> => {
  try {
    const parsed = tournamentTabs(req.body ?? {});
    res.json({ preview: await previewTournamentImport(adminClubId(res), parsed.tournaments), warnings: parsed.warnings });
  } catch (error) {
    if (error instanceof InputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/clubs/current/tournaments/import", requireAdminSession, async (req, res): Promise<void> => {
  try {
    const parsed = tournamentTabs(req.body ?? {});
    const session = res.locals.adminSession as { memberName?: string | null };
    const result = await commitTournamentImport(adminClubId(res), session.memberName ?? null, parsed.tournaments);
    await recordAdminAction(
      "history_imported",
      `Imported ${result.imported} tournament(s); ${result.duplicates} already recorded were skipped.`,
      req,
    );
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof InputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/clubs/current/tournaments/:id", async (req, res): Promise<void> => {
  if (!(await requireClubAdmin(req, res))) return;
  const id = nightId(req.params.id);
  const tournament = id === null ? null : await getTournament(adminClubId(res), id);
  if (!tournament) {
    res.status(404).json({ error: "That tournament no longer exists." });
    return;
  }
  res.json(tournament);
});

router.patch("/clubs/current/tournaments/:id", async (req, res): Promise<void> => {
  if (!(await requireClubAdmin(req, res))) return;
  const id = nightId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid tournament." });
    return;
  }
  const checked = validateTournament(req.body, `club-${id}`);
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  if (!(await updateTournament(adminClubId(res), id, checked.value))) {
    res.status(404).json({ error: "That tournament no longer exists." });
    return;
  }
  const event = buildTournamentEvent(checked.value);
  await recordAdminAction("tournament_edited", `Edited tournament "${event.title}".`, req);
  res.json({
    id,
    players: event.players,
    totalCollected: event.totalCollected,
    mainPrizePool: event.mainPrizePool,
    dataCheck: event.dataCheck,
  });
});

router.delete("/clubs/current/tournaments/:id", async (req, res): Promise<void> => {
  if (!(await requireClubAdmin(req, res))) return;
  const id = nightId(req.params.id);
  if (id === null || !(await deleteTournament(adminClubId(res), id))) {
    res.status(404).json({ error: "That tournament no longer exists." });
    return;
  }
  await recordAdminAction("tournament_deleted", `Deleted tournament #${id}.`, req);
  res.status(204).end();
});

function sendCsv(res: ExpressResponse, filename: string, body: string): void {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

router.get("/clubs/current/export.csv", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const settings = await getClubSettings(clubId);
  const [nights, payouts] = await Promise.all([
    loadNightsForExport(clubId),
    loadJackpotPayoutsForExport(clubId, settings.timezone),
  ]);
  await recordAdminAction("results_exported", `Downloaded the results CSV (${nights.length} nights, ${payouts.length} jackpot payouts).`, req);
  sendCsv(res, `${settings.slug}-results.csv`, nightsToCsv(nights, payouts));
});

/** Tournament Log or Tournament Results, in the shape the tournament CSV import reads. */
async function sendTournamentSheet(req: Request, res: ExpressResponse, sheet: "log" | "results"): Promise<void> {
  const clubId = adminClubId(res);
  const [inputs, settings] = await Promise.all([loadTournamentInputs(clubId), getClubSettings(clubId)]);
  const csv = tournamentsToCsv(inputs);
  const filename = sheet === "log" ? `${settings.slug}-tournament-log.csv` : `${settings.slug}-tournament-results.csv`;
  await recordAdminAction("tournaments_exported", `Downloaded the tournament ${sheet} CSV (${inputs.length} tournaments).`, req);
  sendCsv(res, filename, sheet === "log" ? csv.log : csv.results);
}

router.get("/clubs/current/tournaments/export/log.csv", requireAdminSession, async (req, res): Promise<void> => {
  await sendTournamentSheet(req, res, "log");
});

router.get("/clubs/current/tournaments/export/results.csv", requireAdminSession, async (req, res): Promise<void> => {
  await sendTournamentSheet(req, res, "results");
});

export default router;
