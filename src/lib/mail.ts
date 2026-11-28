import nodemailer from "nodemailer";
import { config } from "../config.js";

const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE === "true",
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<div style="font-family:Inter,Arial,sans-serif;background:#F8FAFC;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;padding:28px">
    <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#172033">internkul</p>
    <h2 style="margin:16px 0 8px;font-size:18px;color:#172033">${esc(title)}</h2>
    <div style="font-size:14px;line-height:1.6;color:#475569">${bodyHtml}</div>
    ${cta ? `<p style="margin:24px 0 0"><a href="${cta.url}" style="background:#3157D5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:600;font-size:14px">${esc(cta.label)}</a></p>` : ""}
  </div></div>`;
}

/** Fire-and-forget safe: never throws into request handlers. Logs to console when SMTP isn't configured. */
export async function sendMail(to: string, subject: string, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const html = layout(title, bodyHtml, cta);
  if (!transporter) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n          ${bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    return;
  }
  try { await transporter.sendMail({ from: config.SMTP_FROM, to, subject, html }); }
  catch (e) { console.error("[mail] send failed", (e as Error).message); }
}
export const appUrl = (p = "") => config.APP_URL.replace(/\/+$/, "") + p;
export { esc };
