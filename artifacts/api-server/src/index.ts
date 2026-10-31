import app from "./app";
import { logger } from "./lib/logger";
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

// Refuse to start against a database that has not been set up (see lib/schema-check.ts).
assertSchemaReady()
  .then(() => {
    logger.info("Database ready");
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Could not start: the database is not ready");
    process.exit(1);
  });
