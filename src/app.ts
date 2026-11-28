import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { buildOpenApi } from "./docs/openapi.js";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { adminRouter } from "./routes/admin/index.js";
import { authRouter } from "./routes/auth.js";
import { checkoutRouter, webhookRouter } from "./routes/checkout.js";
import { publicRouter } from "./routes/public.js";
import { sharedRouter } from "./routes/shared.js";
import { studentRouter } from "./routes/student.js";
import { tutorRouter } from "./routes/tutor.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  // API documentation – mounted before the strict helmet CSP because Swagger UI needs inline scripts
  if (config.ENABLE_DOCS !== "false") {
    const docs = express.Router();
    docs.use(helmet({ contentSecurityPolicy: false }));
    docs.get("/openapi.json", (req, res) => res.json(buildOpenApi(config.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}/api/v1`)));
    docs.use("/docs", swaggerUi.serve, (req: express.Request, res: express.Response, next: express.NextFunction) =>
      swaggerUi.setup(buildOpenApi(config.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}/api/v1`), {
        customSiteTitle: "Internkul LMS API", swaggerOptions: { persistAuthorization: true, tagsSorter: "alpha", docExpansion: "none" } })(req, res, next));
    app.use("/api/v1", docs);
  }
  app.use(helmet());
  const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: false, maxAge: 600 }));

  // Razorpay webhook needs the raw body → mounted BEFORE the JSON parser
  app.use("/api/v1/checkout/webhook", webhookRouter);
  app.use(express.json({ limit: "2mb" }));

  if (config.NODE_ENV !== "test") {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on("finish", () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`));
      next();
    });
  }

  const v1 = express.Router();
  v1.use("/auth", authRouter);
  v1.use("/checkout", checkoutRouter);
  v1.use("/admin", adminRouter);
  v1.use("/tutor", tutorRouter);
  v1.use("/student", studentRouter);
  v1.use("/", sharedRouter);   // /notifications, /documents/:id/download, /certificates/:id/pdf
  v1.use("/", publicRouter);   // /tracks, /domains, /batches, /credentials/verify, /inquiries/*
  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
