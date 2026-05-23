import { badRequest, dateOnly, json, requireObjectBody, serverError, unauthorized } from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

type SummaryRow = {
  recording_id: string;
  short_summary: string | null;
  detailed_summary: string | null;
  key_points: unknown;
  equipment_mentioned: unknown;
  promises_made: unknown;
  strategy_use_case: string | null;
  strategy_applications: unknown;
  follow_up_needed: boolean | null;
};

type RecordingRow = {
  id: string;
  title: string | null;
  recording_type: string | null;
  recorded_at: string | null;
  status: string | null;
};

type ActionItemRow = {
  recording_id: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
};

function stripJsonFences(text: string): string {
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "");
    if (trimmed.endsWith("```")) trimmed = trimmed.slice(0, -3);
  }
  return trimmed.trim();
}

function asStringArray(value: unknown, max?: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
    if (max !== undefined && out.length >= max) break;
  }
  return out;
}

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const rawIds = Array.isArray((body as Record<string, unknown>).recording_ids)
    ? ((body as Record<string, unknown>).recording_ids as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      )
    : null;
  const fromDate = dateOnly(body.from);
  const toDate = dateOnly(body.to);
  const useIds = rawIds && rawIds.length > 0;
  if (!useIds && (!fromDate || !toDate)) {
    return badRequest("either recording_ids[] or from+to dates are required");
  }

  let recordingsQuery = auth.client
    .from("recordings")
    .select("id, title, recording_type, recorded_at, status")
    .order("recorded_at", { ascending: true });
  if (useIds) {
    recordingsQuery = recordingsQuery.in("id", rawIds!);
  } else {
    const startUtc = `${fromDate!}T00:00:00.000Z`;
    const endDate = new Date(`${toDate!}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    recordingsQuery = recordingsQuery.gte("recorded_at", startUtc).lt("recorded_at", endDate.toISOString());
  }
  const { data: recordings, error: recordingsErr } = await recordingsQuery;
  if (recordingsErr) return serverError("Failed to load recordings", recordingsErr.message);

  const recordingsList = (recordings ?? []) as RecordingRow[];
  if (recordingsList.length === 0) {
    return json(200, {
      from: fromDate,
      to: toDate,
      recording_ids: useIds ? rawIds : null,
      recording_count: 0,
      rollup: {
        headline: useIds ? "None of the selected recordings were found." : "Nothing recorded in this window yet.",
        themes: [],
        recurring_promises: [],
        weekly_plays: [],
        observations: [],
      },
      recordings: [],
    });
  }

  const recordingIds = recordingsList.map((r) => r.id);

  const [summariesRes, actionsRes] = await Promise.all([
    auth.client.from("summaries").select("*").in("recording_id", recordingIds),
    auth.client.from("action_items").select("recording_id, title, description, priority, status").in("recording_id", recordingIds),
  ]);

  if (summariesRes.error) return serverError("Failed to load summaries", summariesRes.error.message);
  if (actionsRes.error) return serverError("Failed to load action_items", actionsRes.error.message);

  const summaries = (summariesRes.data ?? []) as SummaryRow[];
  const actionItems = (actionsRes.data ?? []) as ActionItemRow[];

  // Compact input for Claude. Cap each transcript-summary blob so we stay well
  // within the model context even for week-long rollups.
  const compact = recordingsList.map((r) => {
    const s = summaries.find((row) => row.recording_id === r.id);
    const actions = actionItems.filter((a) => a.recording_id === r.id);
    return {
      title: r.title ?? "(no title)",
      type: r.recording_type ?? "other",
      recorded_at: r.recorded_at,
      short: s?.short_summary ?? "",
      detail: s?.detailed_summary ?? "",
      key_points: asStringArray(s?.key_points, 4),
      promises: asStringArray(s?.promises_made, 4),
      strategy_use_case: s?.strategy_use_case ?? null,
      strategy_applications: asStringArray(s?.strategy_applications, 4),
      actions: actions.map((a) => ({ title: a.title, priority: a.priority, status: a.status })),
    };
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return serverError("ANTHROPIC_API_KEY is not set");

  const save = (body as Record<string, unknown>).save === true;

  const system = [
    "You produce strategic rollups across multiple business recordings (calls, meetings, voice notes, site visits) over a date range.",
    "Look across all the entries and identify the patterns that matter for the listener's day-to-day work going forward.",
    "Return ONLY a JSON object — no prose, no markdown fences.",
  ].join(" ");

  const scopeLine = useIds
    ? `Selected ${recordingsList.length} recording(s) by id.`
    : `Date range: ${fromDate} to ${toDate} (${recordingsList.length} recordings).`;
  const baseFields = [
    "- headline: string (1 punchy sentence — the most important takeaway across all recordings)",
    "- themes: string[] (3-6 recurring themes or topics that surfaced across multiple recordings)",
    "- recurring_promises: string[] (commitments that appear in more than one recording, or that the listener kept echoing back)",
    "- weekly_plays: string[] (3-5 concrete imperative actions for the upcoming week, derived from patterns across recordings — not just from any single one)",
    "- observations: string[] (2-4 sharp observations about what is shifting, working, or breaking — what would be lost if this rollup didn't exist)",
  ];
  const saveFields = save
    ? [
        "- title: string (4-8 words — a concrete, scannable title for this rollup, like a doc title not a sentence)",
        "- category: string (one of: customer_relations, equipment_issues, sales_pipeline, team_ops, compliance, field_work, other — pick the single best fit)",
      ]
    : [];
  const user = [
    scopeLine,
    "",
    "Return a single JSON object with exactly these fields:",
    ...baseFields,
    ...saveFields,
    "",
    "Recordings (compact):",
    JSON.stringify(compact),
  ].join("\n");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return serverError(`Anthropic API error (${res.status})`, errText);
  }

  const payload = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const block = (payload.content ?? []).find((b) => b.type === "text" && typeof b.text === "string");
  if (!block || !block.text) return serverError("Claude returned no text content");

  let rollup: Record<string, unknown>;
  try {
    rollup = JSON.parse(stripJsonFences(block.text)) as Record<string, unknown>;
  } catch (err) {
    return serverError("Failed to parse rollup JSON", (err as Error).message);
  }

  const ALLOWED_CATEGORIES = new Set([
    "customer_relations",
    "equipment_issues",
    "sales_pipeline",
    "team_ops",
    "compliance",
    "field_work",
    "other",
  ]);

  const headline = typeof rollup.headline === "string" ? rollup.headline : "";
  const themes = asStringArray(rollup.themes, 6);
  const recurringPromises = asStringArray(rollup.recurring_promises, 6);
  const weeklyPlays = asStringArray(rollup.weekly_plays, 5);
  const observations = asStringArray(rollup.observations, 4);
  const suggestedTitle = typeof rollup.title === "string" ? rollup.title.trim().slice(0, 200) : "";
  const rawCategory = typeof rollup.category === "string" ? rollup.category.trim().toLowerCase() : "";
  const category = ALLOWED_CATEGORIES.has(rawCategory) ? rawCategory : "other";

  let savedId: string | null = null;
  if (save) {
    const { data: inserted, error: insertErr } = await auth.client
      .from("strategy_rollups")
      .insert({
        user_id: auth.user.id,
        title: suggestedTitle || null,
        category,
        scope_type: useIds ? "recording_ids" : "date_range",
        scope_from: useIds ? null : fromDate,
        scope_to: useIds ? null : toDate,
        recording_ids: useIds ? rawIds : null,
        recording_count: recordingsList.length,
        headline,
        themes,
        recurring_promises: recurringPromises,
        weekly_plays: weeklyPlays,
        observations,
      })
      .select("id")
      .single();
    if (insertErr) return serverError("Failed to save rollup", insertErr.message);
    savedId = inserted?.id ?? null;
  }

  return json(200, {
    from: fromDate,
    to: toDate,
    recording_count: recordingsList.length,
    saved_rollup_id: savedId,
    rollup: {
      headline,
      themes,
      recurring_promises: recurringPromises,
      weekly_plays: weeklyPlays,
      observations,
      ...(save ? { title: suggestedTitle || null, category } : {}),
    },
    recordings: recordingsList.map((r) => ({ id: r.id, title: r.title, recorded_at: r.recorded_at, status: r.status })),
  });
}
