import { badRequest, json, notFound, requireObjectBody, serverError, stringValue, unauthorized } from "../_shared/http.ts";
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
    .select("id, user_id")
    .eq("id", recordingId)
    .single();

  if (recordingError || !recording) return notFound("Recording not found");

  const { data: job, error: jobError } = await auth.client
    .from("processing_jobs")
    .insert({
      recording_id: recordingId,
      user_id: auth.user.id,
      job_type: "full_processing",
      status: "queued",
    })
    .select("*")
    .single();

  if (jobError) return serverError("Failed to create processing job", jobError.message);

  const { error: updateError } = await auth.client
    .from("recordings")
    .update({ status: "queued", error_message: null })
    .eq("id", recordingId);

  if (updateError) return serverError("Failed to queue recording", updateError.message);

  const invokeBase = process.env.EKOBASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.EKOBASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (invokeBase && serviceKey) {
    void fetch(`${invokeBase}/functions/v1/process-recording`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recording_id: recordingId }),
    }).catch((err) => {
      console.error("process-recording inline invoke failed:", err);
    });
  } else {
    console.warn("Skipping inline process-recording invoke: EKOBASE_URL or service role key missing");
  }

  return json(200, { recording_id: recordingId, job });
}
