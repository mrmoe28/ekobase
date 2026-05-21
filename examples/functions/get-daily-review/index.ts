import { badRequest, dateOnly, json, requireObjectBody, unauthorized } from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";

function tzStartOfDayUtc(date: string, tz: string): { startUtc: string; endUtc: string } {
  // date is "YYYY-MM-DD". Compute the [start, end) window for that calendar day
  // in timezone `tz`, expressed as UTC ISO strings.
  const utcMidnight = new Date(`${date}T00:00:00.000Z`);
  const tzString = utcMidnight.toLocaleString("en-US", { timeZone: tz, hour12: false });
  const utcString = utcMidnight.toLocaleString("en-US", { timeZone: "UTC", hour12: false });
  const offsetMs = new Date(utcString).getTime() - new Date(tzString).getTime();
  const startUtc = new Date(utcMidnight.getTime() + offsetMs).toISOString();
  const endUtc = new Date(new Date(startUtc).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { startUtc, endUtc };
}

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const date = dateOnly(body.date);
  if (!date) return badRequest("date is required in YYYY-MM-DD format");

  const rawTz = typeof body.timezone === "string" ? body.timezone.trim() : "";
  const tz = rawTz.length > 0 ? rawTz : "UTC";
  if (tz !== "UTC") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch (_err) {
      return badRequest("Invalid timezone");
    }
  }

  const { startUtc: start, endUtc: end } = tzStartOfDayUtc(date, tz);

  const { data: recordings, error } = await auth.client
    .from("recordings")
    .select("*, summaries(*), action_items(*)")
    .gte("recorded_at", start)
    .lt("recorded_at", end)
    .order("recorded_at", { ascending: true });

  if (error) return badRequest(error.message);

  const actionItems = (recordings ?? []).flatMap((recording: any) => recording.action_items ?? []);
  const followUps = (recordings ?? []).filter((recording: any) =>
    (recording.summaries ?? []).some((summary: any) => summary.follow_up_needed),
  );

  return json(200, {
    date,
    timezone: tz,
    overview: {
      short_summary: "Daily overview placeholder. Connect a summary provider to generate this from the day's recordings.",
      recording_count: recordings?.length ?? 0,
      action_item_count: actionItems.length,
      follow_up_needed_count: followUps.length,
    },
    recordings: recordings ?? [],
    action_items: actionItems,
    follow_up_needed: followUps,
  });
}
