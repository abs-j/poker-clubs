import { Router, type IRouter } from "express";
import { adminClubId, memberClubId, requireAdminSession, requireMemberSession, type AuthSession } from "../lib/auth";
import { isClubAdmin } from "../lib/club-access";
import { LedgerPermissionError, type LedgerActor } from "../lib/ledger-permissions";
import { recordAdminAction } from "../lib/admin-audit";
import { commitTournamentImport, deleteTournament, listTournaments, previewTournamentImport, recordTournament } from "../lib/club-tournaments";
import { parseTournamentImport } from "../lib/tournament-import";
import Anthropic from "@anthropic-ai/sdk";
import { NotesImageError, readNightFromImage, validateNotesImage } from "../lib/notes-image";
import { buildTournamentEvent, validateTournament } from "../lib/tournament-native";
import { clubJackpot, commitImport, deleteNight, listClubNights, loadNightsForExport, previewImport, setLedgerResolution, undoImport } from "../lib/club-sessions";
import { parseResolution } from "../lib/night-balance";
import { nightsToCsv } from "../lib/export-csv";
import { getClubSettings } from "../lib/club-settings";
import {
  parseDate,
  parseHistory,
  parseMoney,
  sheetExportUrl,
  type DateOrder,
  type ParsedNight,
} from "../lib/import-parse";

const router: IRouter = Router();

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

/** The club's bad beat jackpot so far: surplus from balanced nights. */
router.get("/clubs/current/jackpot", requireMemberSession, async (_req, res): Promise<void> => {
  res.json(await clubJackpot(memberClubId(res)));
});

router.get("/clubs/current/sessions", requireAdminSession, async (_req, res): Promise<void> => {
  res.json({ sessions: await listClubNights(adminClubId(res)) });
});

router.delete("/clubs/current/sessions/:id", requireAdminSession, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid night." });
    return;
  }
  const outcome = await deleteNight(adminClubId(res), id);
  if (outcome === "missing") {
    res.status(404).json({ error: "That night no longer exists." });
    return;
  }
  if (outcome === "live") {
    res.status(409).json({ error: "This night came from the live ledger. Delete it from Ledger history on the Admin page (/admin)." });
    return;
  }
  await recordAdminAction("night_deleted", `Deleted recorded night #${id}.`, req);
  res.status(204).end();
});

/** Records a tournament: who finished where, entries, knockouts and optionally payouts. */
router.post("/clubs/current/tournaments", requireAdminSession, async (req, res): Promise<void> => {
  const checked = validateTournament(req.body, "new");
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  const session = res.locals.adminSession as { memberName?: string | null };
  const id = await recordTournament(adminClubId(res), session.memberName ?? null, checked.value);
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
router.post("/clubs/current/sessions/notes-image", requireAdminSession, async (req, res): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({ error: "Reading screenshots isn't switched on for this site. Paste the text instead." });
    return;
  }
  const checked = validateNotesImage(req.body);
  if ("error" in checked) {
    res.status(400).json({ error: checked.error });
    return;
  }
  if (!takeNotesImageUse(adminClubId(res))) {
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

router.get("/clubs/current/tournaments", requireAdminSession, async (_req, res): Promise<void> => {
  res.json({ tournaments: await listTournaments(adminClubId(res)) });
});

router.delete("/clubs/current/tournaments/:id", requireAdminSession, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || !(await deleteTournament(adminClubId(res), id))) {
    res.status(404).json({ error: "That tournament no longer exists." });
    return;
  }
  await recordAdminAction("tournament_deleted", `Deleted tournament #${id}.`, req);
  res.status(204).end();
});

router.get("/clubs/current/export.csv", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const [nights, settings] = await Promise.all([loadNightsForExport(clubId), getClubSettings(clubId)]);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${settings.slug}-results.csv"`);
  await recordAdminAction("results_exported", `Downloaded the results CSV (${nights.length} nights).`, req);
  res.send(nightsToCsv(nights));
});

/** Records one night by hand: { date: "YYYY-MM-DD", players: [{ name, buyIn, cashOut }] }. */
router.post("/clubs/current/sessions", requireAdminSession, async (req, res): Promise<void> => {
  const date = typeof req.body?.date === "string" ? parseDate(req.body.date) : null;
  if (!date) {
    res.status(400).json({ error: "Choose the date of the night." });
    return;
  }
  const rows: unknown[] = Array.isArray(req.body?.players) ? req.body.players : [];
  const night: ParsedNight = { date, players: [] };
  const seen = new Set<string>();
  for (const row of rows) {
    const entry = row as { name?: unknown; buyIn?: unknown; cashOut?: unknown };
    const name = typeof entry.name === "string" ? entry.name.trim().replace(/\s+/g, " ") : "";
    if (!name) continue;
    const buyIn = parseMoney(String(entry.buyIn ?? ""));
    const cashOut = parseMoney(String(entry.cashOut ?? ""));
    if (name.length > 40 || buyIn === null || cashOut === null || buyIn < 0 || cashOut < 0) {
      res.status(400).json({ error: `Check the amounts for ${name || "a player"}.` });
      return;
    }
    if (seen.has(name.toLowerCase())) {
      res.status(400).json({ error: `${name} is listed twice.` });
      return;
    }
    seen.add(name.toLowerCase());
    if (buyIn > 0 || cashOut > 0) night.players.push({ name, buyIn, cashOut });
  }
  if (night.players.length < 2) {
    res.status(400).json({ error: "Add at least two players with a buy-in or cash-out." });
    return;
  }
  if (night.players.length > 100) {
    res.status(400).json({ error: "That's more than 100 players for one night." });
    return;
  }
  const session = res.locals.adminSession as { memberName?: string | null };
  const result = await commitImport(adminClubId(res), session.memberName ?? null, [night], "manual");
  if (result.imported === 0) {
    res.status(409).json({ error: "That exact night is already recorded." });
    return;
  }
  const buy = night.players.reduce((sum, p) => sum + p.buyIn, 0);
  const cash = night.players.reduce((sum, p) => sum + p.cashOut, 0);
  res.status(201).json({ ...result, balanced: Math.abs(buy - cash) <= 0.5, difference: Math.round((cash - buy) * 100) / 100 });
});

export default router;
