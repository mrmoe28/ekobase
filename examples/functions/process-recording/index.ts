import { badRequest, bearerToken, json, requireObjectBody, serverError, stringValue, unauthorized } from "../_shared/http.ts";
import { serviceClient } from "../_shared/ekobaseClient.ts";
import { extractActionItems, summarizeTranscript, transcribeAudio } from "../_shared/aiProvider.ts";

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const serviceKey = process.env.EKOBASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return serverError("Service role key not configured");

  const callerToken = bearerToken(req.headers);
  if (!callerToken || callerToken !== serviceKey) {
    return unauthorized("Service role required");
  }

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const recordingId = stringValue(body.recording_id);
  if (!recordingId) return badRequest("recording_id is required");

  const client = serviceClient();
  let jobId: string | null = null;

  try {
    const { data: recording, error: recordingError } = await client
      .from("recordings")
      .select("*")
      .eq("id", recordingId)
      .single();

    if (recordingError || !recording) {
      return badRequest("Recording not found");
    }

    const { data: job } = await client
      .from("processing_jobs")
      .select("*")
      .eq("recording_id", recordingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    jobId = job?.id ?? null;

    if (jobId) {
      await client
        .from("processing_jobs")
        .update({ status: "transcribing", attempts: (job.attempts ?? 0) + 1, started_at: new Date().toISOString() })
        .eq("id", jobId);
    }

    await client.from("recordings").update({ status: "transcribing", error_message: null }).eq("id", recordingId);

    const file = await client.storage.from(recording.storage_bucket).download(recording.storage_path);
    if (file.error || !file.data) {
      throw new Error(file.error?.message ?? "Failed to download recording audio");
    }

    const audio = await file.data.arrayBuffer();
    const transcript = await transcribeAudio({
      audio,
      mimeType: recording.mime_type,
      fileName: recording.storage_path,
    });

    await client.from("transcripts").upsert({
      recording_id: recordingId,
      user_id: recording.user_id,
      raw_text: transcript.rawText,
      cleaned_text: transcript.cleanedText,
      language: transcript.language,
      provider: transcript.provider,
      confidence: transcript.confidence,
      segments: transcript.segments,
    }, { onConflict: "recording_id" });

    if (jobId) {
      await client.from("processing_jobs").update({ status: "summarizing" }).eq("id", jobId);
    }
    await client.from("recordings").update({ status: "summarizing" }).eq("id", recordingId);

    const summary = await summarizeTranscript({ transcript: transcript.cleanedText || transcript.rawText });

    await client.from("summaries").upsert({
      recording_id: recordingId,
      user_id: recording.user_id,
      short_summary: summary.shortSummary,
      detailed_summary: summary.detailedSummary,
      customer_issue: summary.customerIssue,
      key_points: summary.keyPoints,
      equipment_mentioned: summary.equipmentMentioned,
      promises_made: summary.promisesMade,
      follow_up_needed: summary.followUpNeeded,
    }, { onConflict: "recording_id" });

    const actionItems = await extractActionItems({
      transcript: transcript.cleanedText || transcript.rawText,
      summary,
    });

    if (actionItems.length > 0) {
      await client.from("action_items").insert(
        actionItems.map((item) => ({
          recording_id: recordingId,
          user_id: recording.user_id,
          title: item.title,
          description: item.description,
          due_at: item.dueAt,
          priority: item.priority,
          status: "open",
          source: "ai",
        })),
      );
    }

    await client.from("recordings").update({ status: "completed", error_message: null }).eq("id", recordingId);

    if (jobId) {
      await client
        .from("processing_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString(), error_message: null })
        .eq("id", jobId);
    }

    return json(200, { recording_id: recordingId, status: "completed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";

    await client.from("recordings").update({ status: "failed", error_message: message }).eq("id", recordingId);

    if (jobId) {
      await client
        .from("processing_jobs")
        .update({ status: "failed", completed_at: new Date().toISOString(), error_message: message })
        .eq("id", jobId);
    }

    return serverError("Failed to process recording", message);
  }
}
