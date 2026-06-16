import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.2";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("id");

  if (!invoiceId) {
    return new Response("Missing invoice id", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  );

  // Load invoice
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return new Response("Invoice not found", { status: 404 });
  }

  // Load line items
  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order");

  // Load company info
  const { data: profiles } = await supabase
    .from("profiles")
    .select("company_name, company_email, company_phone, company_address, logo_path, full_name, cashapp_cashtag")
    .limit(1);

  const company = profiles?.[0] || {};
  const companyName = company.company_name || "EKO SOLAR LLC";
  const companyEmail = company.company_email || "";
  const companyPhone = company.company_phone || "";
  const companyAddress = company.company_address || "";
  const ownerName = company.full_name || "";
  const logoPath = company.logo_path || "";
  const cashtagRaw = company.cashapp_cashtag || "";
  const cashtag = cashtagRaw ? cashtagRaw.replace(/^\$+/, "") : "";

  // Fetch logo as base64 if available
  let logoDataUrl: string | null = null;
  if (logoPath) {
    try {
      const { data: urlData } = supabase.storage.from("company-logos").getPublicUrl(logoPath);
      const res = await fetch(urlData.publicUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        const contentType = res.headers.get("content-type") || "image/png";
        logoDataUrl = `data:${contentType};base64,${base64}`;
      }
    } catch { /* skip logo if fetch fails */ }
  }

  // Load job info
  let jobAddress = "";
  let jobScheduledDate = "";
  if (invoice.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("client, type, address, scheduled_date")
      .eq("id", invoice.job_id)
      .single();
    if (job) {
      jobAddress = job.address || "";
      jobScheduledDate = job.scheduled_date || "";
    }
  }

  const items = (lineItems || []).map((li: any) => ({
    category: li.category || "",
    description: li.description || "",
    quantity: Number(li.quantity) || 1,
    unitPriceCents: li.unit_price_cents || 0,
  }));

  const subtotalCents = items.reduce((sum: number, i: any) => sum + i.quantity * i.unitPriceCents, 0);
  const totalCents = invoice.amount_cents || subtotalCents;
  const paidCents = invoice.paid_amount_cents || 0;
  const balanceCents = totalCents - paidCents;
  const depositCents = invoice.deposit_cents || 0;
  const recipientName = invoice.recipient_name || "";
  const recipientEmail = invoice.recipient_email || "";
  const description = invoice.description || "";
  const invoiceDate = new Date(invoice.created_at).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  // Generate PDF server-side
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  let y = 20;

  // Header bar — taller to fit contact info
  const headerH = 44;
  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, w, headerH, "F");

  // Logo on the left
  let textStartX = 20;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", 16, 6, 16, 16);
      textStartX = 36;
    } catch { /* skip if image format unsupported */ }
  }

  // Company name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(companyName, textStartX, 14);

  // Contact info under company name
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(200, 200, 200);
  let hy = 20;
  if (ownerName) { doc.text(ownerName, textStartX, hy); hy += 4; }
  if (companyEmail) { doc.text(companyEmail, textStartX, hy); hy += 4; }
  if (companyPhone) { doc.text(companyPhone, textStartX, hy); hy += 4; }
  if (companyAddress) { doc.text(companyAddress, textStartX, hy); hy += 4; }

  // INVOICE label on the right
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(10);
  doc.text("INVOICE", w - 20, 14, { align: "right" });

  y = headerH + 10;

  // Bill To section
  doc.setTextColor(160, 160, 160);
  doc.setFontSize(9);
  doc.text("BILL TO", 20, y);
  y += 6;
  doc.setTextColor(26, 26, 46);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(recipientName, 20, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(recipientEmail, 20, y);
  y += 5;
  if (jobAddress) {
    doc.text(jobAddress, 20, y);
    y += 5;
  }

  // Date on right side (aligned with Bill To)
  const dateY = y;
  doc.setTextColor(160, 160, 160);
  doc.setFontSize(9);
  doc.text(`Date: ${invoiceDate}`, w - 20, dateY, { align: "right" });
  if (jobScheduledDate) {
    doc.text(`Booking: ${jobScheduledDate}`, w - 20, dateY + 6, { align: "right" });
  }

  // Description
  y += 4;
  if (description) {
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(9);
    doc.text(description.slice(0, 80), 20, y, { maxWidth: w - 40 });
    y += 8;
  }

  // Table header
  y += 2;
  doc.setFillColor(245, 245, 250);
  doc.rect(16, y - 4, w - 32, 8, "F");
  doc.setTextColor(160, 160, 160);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("ITEM", 20, y);
  doc.text("QTY", w - 80, y, { align: "right" });
  doc.text("PRICE", w - 50, y, { align: "right" });
  doc.text("TOTAL", w - 20, y, { align: "right" });
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  // Item rows
  for (const i of items) {
    const itemLabel = `${i.category}: ${i.description}`.substring(0, 50);
    const lineTotal = (i.quantity * i.unitPriceCents / 100).toFixed(2);
    doc.setTextColor(26, 26, 46);
    doc.text(itemLabel, 20, y);
    doc.setTextColor(100, 100, 100);
    doc.text(String(i.quantity), w - 80, y, { align: "right" });
    doc.text(`$${(i.unitPriceCents / 100).toFixed(2)}`, w - 50, y, { align: "right" });
    doc.setTextColor(26, 26, 46);
    doc.setFont("helvetica", "bold");
    doc.text(`$${lineTotal}`, w - 20, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 7;
  }

  // Totals
  y += 4;
  doc.setDrawColor(230, 230, 230);
  doc.line(20, y, w - 20, y);
  y += 8;
  doc.setTextColor(160, 160, 160);
  doc.setFontSize(9);
  doc.text("Subtotal", 20, y);
  doc.setTextColor(26, 26, 46);
  doc.setFont("helvetica", "bold");
  doc.text(`$${(subtotalCents / 100).toFixed(2)}`, w - 20, y, { align: "right" });
  y += 7;
  doc.setFont("helvetica", "normal");

  if (depositCents > 0) {
    doc.setTextColor(160, 160, 160);
    doc.text("Deposit", 20, y);
    doc.setTextColor(26, 26, 46);
    doc.setFont("helvetica", "bold");
    doc.text(`$${(depositCents / 100).toFixed(2)}`, w - 20, y, { align: "right" });
    y += 7;
    doc.setFont("helvetica", "normal");
  }

  if (paidCents > 0) {
    doc.setTextColor(160, 160, 160);
    doc.text("Paid", 20, y);
    doc.setTextColor(16, 185, 129);
    doc.setFont("helvetica", "bold");
    doc.text(`-$${(paidCents / 100).toFixed(2)}`, w - 20, y, { align: "right" });
    y += 7;
    doc.setFont("helvetica", "normal");
  }

  // Balance due
  y += 2;
  doc.setDrawColor(230, 230, 230);
  doc.line(20, y, w - 20, y);
  y += 8;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(26, 26, 46);
  doc.text("Balance Due", 20, y);
  if (balanceCents > 0) {
    doc.setTextColor(239, 68, 68);
  } else {
    doc.setTextColor(16, 185, 129);
  }
  doc.text(`$${(balanceCents / 100).toFixed(2)}`, w - 20, y, { align: "right" });

  // Paid in full badge
  if (balanceCents <= 0) {
    y += 14;
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(20, y, w - 40, 14, 3, 3, "FD");
    doc.setTextColor(5, 150, 105);
    doc.setFontSize(12);
    doc.text("PAID IN FULL", w / 2, y + 9, { align: "center" });
    y += 22;
  }

  // Cash App pay option (only when balance remains and a cashtag is configured)
  if (cashtag && balanceCents > 0) {
    y += 12;
    const noteParam = encodeURIComponent((description || `${companyName} invoice`).slice(0, 80));
    const cashUrl = `https://cash.app/$${cashtag}/${(balanceCents / 100).toFixed(2)}?note=${noteParam}`;
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(20, y, w - 40, 16, 3, 3, "FD");
    doc.setTextColor(22, 101, 52);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Or pay with Cash App:", 26, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(5, 150, 105);
    doc.textWithLink(`$${cashtag}`, 26, y + 13, { url: cashUrl });
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(7);
    doc.text(cashUrl, w - 26, y + 13, { align: "right" });
    y += 20;
  }

  // Footer
  y += 14;
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(`Thank you for your business \u2014 ${companyName}`, w / 2, y, { align: "center" });
  y += 5;
  doc.setTextColor(239, 68, 68);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("NO REFUNDS", w / 2, y, { align: "center" });
  y += 5;
  doc.setTextColor(180, 180, 180);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.text("By paying the deposit you agree to the service as described in this invoice.", w / 2, y, { align: "center" });
  y += 5;
  doc.text(`Generated ${new Date().toLocaleString()}`, w / 2, y, { align: "center" });

  // Output PDF as binary
  const pdfBytes = doc.output("arraybuffer");
  const fileName = `invoice-${companyName.replace(/[^a-zA-Z0-9]/g, "-")}-$${(totalCents / 100).toFixed(2)}.pdf`;

  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
