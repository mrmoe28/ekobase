import { badRequest, json, notFound, requireObjectBody, stringValue, unauthorized } from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const recordingId = stringValue(body.recording_id);
  if (!recordingId) return badRequest("recording_id is required");

  const { data: recording, error: recordingError } = await auth.client
    .from("recordings")
    .select("*")
    .eq("id", recordingId)
    .single();

  if (recordingError || !recording) return notFound("Recording not found");

  const [transcript, summary, actionItems, tags, consentLogs] = await Promise.all([
    auth.client.from("transcripts").select("*").eq("recording_id", recordingId).maybeSingle(),
    auth.client.from("summaries").select("*").eq("recording_id", recordingId).maybeSingle(),
    auth.client.from("action_items").select("*").eq("recording_id", recordingId).order("created_at"),
    auth.client
      .from("recording_tags")
      .select("created_at, conversation_tags(id, name, color)")
      .eq("recording_id", recordingId),
    auth.client.from("consent_logs").select("*").eq("recording_id", recordingId).order("created_at", { ascending: false }),
  ]);

  return json(200, {
    recording,
    transcript: transcript.data,
    summary: summary.data,
    action_items: actionItems.data ?? [],
    tags: tags.data ?? [],
    consent_logs: consentLogs.data ?? [],
  });
}
