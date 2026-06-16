type FnRequest = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: unknown;
};

import { createClient } from "@supabase/supabase-js";
// TODO: install jspdf in functions-runner package.json
// import { jsPDF } from "jspdf";

export async function handler(req: FnRequest) {
  const url = new URL("http://localhost" + (req.headers["x-forwarded-uri"] as string || "/"));
  const paymentId = url.searchParams.get("id");

  if (!paymentId) {
    return { statusCode: 400, body: "Missing payment id" };
  }

  const supabase = createClient(
    process.env["SUPABASE_URL"] || "",
    process.env["SUPABASE_SERVICE_ROLE_KEY"] || ""
  );

  // Load payment
  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (!payment) {
    return { statusCode: 404, body: "Receipt not found" };
  }

  // Load invoice
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", payment.invoice_id)
    .single();

  if (!invoice) {
    return { statusCode: 404, body: "Invoice not found" };
  }

  // Load company info
  const { data: profiles } = await supabase
    .from("profiles")
    .select("company_name, company_email, company_phone, logo_path")
    .limit(1);

  const company = profiles?.[0] || {};
  const companyName = company.company_name || "EKO SOLAR LLC";

  // Load job info
  let jobLabel = invoice.description?.slice(0, 80) || "Invoice";
  if (invoice.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("client, type")
      .eq("id", invoice.job_id)
      .single();
    if (job) jobLabel = `${job.client} \u2014 ${job.type}`;
  }

  const amountCents = payment.amount_cents;
  const amount = (amountCents / 100).toFixed(2);
  const invoiceTotal = (invoice.amount_cents / 100).toFixed(2);
  const totalPaid = (invoice.paid_amount_cents / 100).toFixed(2);
  const balanceVal = ((invoice.amount_cents - invoice.paid_amount_cents) / 100);
  const balance = balanceVal.toFixed(2);
  const paidDate = new Date(payment.created_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const isDeposit = payment.is_deposit;

  // Generate PDF server-side
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  let y = 25;

  // Header bar
  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, w, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, 25, 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("PAYMENT RECEIPT", 25, 30);
  y = 55;

  // Checkmark
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(22);
  doc.text("\u2713", w / 2 - 3, y);
  y += 10;

  // Payment confirmed
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Payment Confirmed", w / 2, y, { align: "center" });
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(150, 150, 150);
  doc.text(paidDate, w / 2, y, { align: "center" });
  y += 15;

  // Details box
  const boxHeight = isDeposit ? 75 : 68;
  doc.setDrawColor(230, 230, 230);
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(20, y, w - 40, boxHeight, 3, 3, "FD");
  y += 10;

  // Detail rows helper
  function row(label: string, value: string, color?: string) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(10);
    doc.text(label, 28, y);
    if (color === "green") doc.setTextColor(16, 185, 129);
    else if (color === "red") doc.setTextColor(239, 68, 68);
    else doc.setTextColor(26, 26, 46);
    doc.setFont("helvetica", "bold");
    doc.text(value, w - 28, y, { align: "right" });
    y += 8;
  }

  row("Description", jobLabel);
  row("Amount Paid", `$${amount}`, "green");
  if (isDeposit) row("Payment Type", "Deposit");
  row("Method", payment.method === "square" ? "Card (Square)" : payment.method === "cashapp" ? "Cash App" : payment.method);

  // Divider
  y += 2;
  doc.setDrawColor(220, 220, 220);
  doc.line(28, y, w - 28, y);
  y += 6;

  row("Invoice Total", `$${invoiceTotal}`);
  row("Total Paid", `$${totalPaid}`);
  row("Balance Remaining", `$${balance}`, balanceVal <= 0 ? "green" : "red");

  y += 10;

  // Paid in full badge
  if (balanceVal <= 0) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(20, y, w - 40, 14, 3, 3, "FD");
    doc.setTextColor(5, 150, 105);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(isDeposit ? "DEPOSIT PAID IN FULL" : "PAID IN FULL", w / 2, y + 9, { align: "center" });
    y += 22;
  }

  // Footer
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("This is your official payment receipt.", w / 2, y, { align: "center" });
  y += 6;
  doc.text(`Generated ${new Date().toLocaleString()}`, w / 2, y, { align: "center" });

  // Output PDF as binary
  const pdfBytes = doc.output("arraybuffer");
  const fileName = `receipt-${companyName.replace(/[^a-zA-Z0-9]/g, "-")}-$${amount}.pdf`;

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
