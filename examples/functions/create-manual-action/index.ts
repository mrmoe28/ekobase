import { badRequest, json, notFound, requireObjectBody, serverError, stringValue, unauthorized } from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const recordingId = stringValue(body.recording_id);
  const title = stringValue(body.title);
  const description = stringValue(body.description);
  const priority = stringValue(body.priority) ?? "normal";
  const dueAt = stringValue(body.due_at);

  if (!recordingId) return badRequest("recording_id is required");
  if (!title) return badRequest("title is required");
  if (!PRIORITIES.has(priority)) return badRequest("Invalid priority");

  const { data: recording, error: recordingError } = await auth.client
    .from("recordings")
    .select("id")
    .eq("id", recordingId)
    .single();

  if (recordingError || !recording) return notFound("Recording not found");

  const { data: actionItem, error: actionError } = await auth.client
    .from("action_items")
    .insert({
      recording_id: recordingId,
      user_id: auth.user.id,
      title,
      description,
      due_at: dueAt,
      priority,
      status: "open",
      source: "manual",
    })
    .select("*")
    .single();

  if (actionError) return serverError("Failed to create manual action", actionError.message);

  return json(201, { action_item: actionItem });
}
