import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { toNodeHandler } from "better-auth/node";
import router from "./routes";
import { identity } from "./lib/identity";
import { logger } from "./lib/logger";
import { trustedOrigin } from "./lib/origins";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The API only answers JSON, so the strictest content policy is safe. Frame and sniffing protection come with it.
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
// Credentialed cross-origin access only for our own addresses. Requests with no Origin (same-origin, curl) pass.
app.use(cors({ origin: (origin, callback) => callback(null, !origin || trustedOrigin(origin)), credentials: true }));
app.use(cookieParser());
// Better Auth reads the raw body itself, so it is mounted before the JSON parser.
app.all("/api/identity/*splat", toNodeHandler(identity));
// Pasted spreadsheet history can run to a few hundred KB.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
