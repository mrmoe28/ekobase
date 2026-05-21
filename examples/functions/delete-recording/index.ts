import { badRequest, json, notFound, requireObjectBody, serverError, stringValue, unauthorized } from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/ekobaseClient.ts";

// Deletes a recording owned by the caller plus its audio file. The cascade FK
// on recording_id handles transcripts, summaries, action_items, recording_tags,
// processing_jobs, and consent_logs. The audio file in the recordings bucket
// needs an explicit DELETE on the storage service.

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const recordingId = stringValue(body.recording_id);
  if (!recordingId) return badRequest("recording_id is required");

  // Read the row first so we know the storage path (and to confirm ownership).
  const { data: recording, error: readErr } = await auth.client
    .from("recordings")
    .select("id, user_id, storage_bucket, storage_path")
    .eq("id", recordingId)
    .single();
  if (readErr || !recording) return notFound("Recording not found");
  if (recording.user_id !== auth.user.id) return unauthorized("Not your recording");

  // Best-effort: delete the audio file via the service-role storage client so
  // the storage service doesn't reject the call on its own RLS path. Failures
  // are logged but don't block the row delete — orphaned files are a small
  // amount of disk; orphaned rows are user-visible junk.
  const svc = serviceClient();
  if (recording.storage_bucket && recording.storage_path) {
    const { error: fileErr } = await svc.storage
      .from(recording.storage_bucket)
      .remove([recording.storage_path]);
    if (fileErr) {
      console.warn("delete-recording: storage cleanup failed", {
        recording_id: recordingId,
        path: recording.storage_path,
        error: fileErr.message,
      });
    }
  }

  const { error: deleteErr } = await auth.client
    .from("recordings")
    .delete()
    .eq("id", recordingId);
  if (deleteErr) return serverError("Failed to delete recording", deleteErr.message);

  return json(200, { recording_id: recordingId, deleted: true });
}
