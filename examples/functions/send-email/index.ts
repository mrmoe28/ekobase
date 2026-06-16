import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
let nodemailer: any
try {
  nodemailer = require("nodemailer")
} catch {
  nodemailer = null
}

const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD
const SENDGRID_KEY = process.env.SENDGRID_API_KEY
const FROM_EMAIL = process.env.FROM_EMAIL || GMAIL_USER

async function sendViaSendGrid(to: string, subject: string, html: string, fromName: string, cc?: string) {
  if (!SENDGRID_KEY) throw new Error("SENDGRID_API_KEY not set")
  const body: any = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: FROM_EMAIL, name: fromName },
    subject,
    content: [{ type: "text/html", value: html }],
  }
  if (cc) body.personalizations[0].cc = [{ email: cc }]
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${SENDGRID_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${await res.text()}`)
}

async function sendViaGmail(to: string, subject: string, html: string, fromName: string, cc?: string) {
  if (!nodemailer) throw new Error("nodemailer not installed — skipping Gmail SMTP fallback")
  if (!GMAIL_USER || !GMAIL_PASS) throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD not set")
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  })
  await transporter.sendMail({
    from: `"${fromName}" <${GMAIL_USER}>`,
    to, cc: cc || undefined, subject, html,
  })
}

export async function handler(req: { body: any }) {
  const { to, subject, html, from_name, cc } = (req.body || {}) as any
  if (!to || !subject || !html) {
    return { error: "to, subject, and html are required" }
  }
  const fromName = from_name || "EKO Solar Pros"
  try {
    await sendViaSendGrid(to, subject, html, fromName, cc)
    console.log(`Email sent via SendGrid to ${to}`)
  } catch (e) {
    console.warn("SendGrid unavailable, using Gmail SMTP:", (e as Error).message)
    await sendViaGmail(to, subject, html, fromName, cc)
    console.log(`Email sent via Gmail SMTP to ${to}`)
  }
  return { success: true }
}
