import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { batchOps } from "../batchOps.js";
import { adminCatalog } from "./catalog.js";
import { adminOps } from "./ops.js";
import { adminPeople } from "./people.js";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole("admin"));
adminRouter.use(adminCatalog, adminPeople, adminOps);
adminRouter.use("/batches/:batchId", batchOps);   // sessions, attendance, documents, announcements – admins can act on every batch
