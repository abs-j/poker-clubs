import app from "./app";
import { logger } from "./lib/logger";
import { startLiveActivitySheetSync } from "./lib/live-activity";
import { getDefaultClubId, legacyEnabled } from "./lib/club-context";
import { assertSchemaReady } from "./lib/schema-check";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Make sure the original club exists and owns the existing rows before taking requests.
// Needs `pnpm --filter @workspace/db run push` to have added the club columns first.
assertSchemaReady()
  .then(() => getDefaultClubId())
  .then((clubId) => {
    logger.info({ legacy: legacyEnabled(), clubId }, "Database ready");
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      // The sheet mirror belongs to the original club, so it only runs in legacy mode.
      if (legacyEnabled()) startLiveActivitySheetSync();
    });
  })
  .catch((err) => {
    logger.error({ err }, "Could not start: the database is not ready");
    process.exit(1);
  });
