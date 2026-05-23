import { badRequest, forbidden, json, notFound, requireObjectBody, serverError, stringValue, unauthorized } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/ekobaseClient.ts";
import { summarizeTranscript } from "../_shared/aiProvider.ts";

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const recordingId = stringValue(body.recording_id);
  if (!recordingId) return badRequest("recording_id is required");

  const client = serviceClient();

  const { data: recording, error: recordingError } = await client
    .from("recordings")
    .select("id, user_id")
    .eq("id", recordingId)
    .single();
  if (recordingError || !recording) return notFound("Recording not found");
  if (recording.user_id !== auth.user.id) return forbidden("Recording belongs to another user");

  const { data: transcript, error: transcriptError } = await client
    .from("transcripts")
    .select("raw_text, cleaned_text")
    .eq("recording_id", recordingId)
    .maybeSingle();
  if (transcriptError) return serverError("Failed to load transcript", transcriptError.message);
  if (!transcript) return badRequest("No transcript exists for this recording yet — run process-recording first");

  const transcriptText = transcript.cleaned_text || transcript.raw_text || "";
  if (!transcriptText.trim()) return badRequest("Transcript is empty");

  let summary;
  try {
    summary = await summarizeTranscript({ transcript: transcriptText });
  } catch (err) {
    return serverError("Summarization failed", (err as Error).message);
  }

  const { error: upsertError } = await client.from("summaries").upsert({
    recording_id: recordingId,
    user_id: recording.user_id,
    domain: summary.domain,
    short_summary: summary.shortSummary,
    detailed_summary: summary.detailedSummary,
    customer_issue: summary.customerIssue,
    key_points: summary.keyPoints,
    equipment_mentioned: summary.equipmentMentioned,
    promises_made: summary.promisesMade,
    follow_up_needed: summary.followUpNeeded,
    strategy_use_case: summary.strategyUseCase,
    strategy_applications: summary.strategyApplications,
  }, { onConflict: "recording_id" });
  if (upsertError) return serverError("Failed to save summary", upsertError.message);

  return json(200, {
    recording_id: recordingId,
    domain: summary.domain,
    summary: {
      short_summary: summary.shortSummary,
      detailed_summary: summary.detailedSummary,
      customer_issue: summary.customerIssue,
      key_points: summary.keyPoints,
      equipment_mentioned: summary.equipmentMentioned,
      promises_made: summary.promisesMade,
      follow_up_needed: summary.followUpNeeded,
      strategy_use_case: summary.strategyUseCase,
      strategy_applications: summary.strategyApplications,
    },
  });
}
