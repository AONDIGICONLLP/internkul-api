import { createApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`\n  Internkul LMS API  →  http://localhost:${config.PORT}/api/v1   (${config.NODE_ENV}, payments: ${config.PAYMENT_DRIVER})\n`);
});
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
