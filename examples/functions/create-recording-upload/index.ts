import {
  badRequest,
  json,
  requireObjectBody,
  serverError,
  stringValue,
  numberValue,
  unauthorized,
} from "../_shared/http.ts";
import { requireUser } from "../_shared/ekobaseClient.ts";
import { audioExtension, isConsentStatus, isRecordingType } from "../_shared/recordings.ts";

export async function handler(req: any) {
  if (req.method !== "POST") return badRequest("POST required");

  const auth = await requireUser(req);
  if (!auth.user || !auth.client) return unauthorized(auth.error ?? undefined);

  const body = requireObjectBody(req.body);
  if (!body) return badRequest("JSON body required");

  const title = stringValue(body.title);
  const recordingType = stringValue(body.recording_type);
  const consentStatus = stringValue(body.consent_status);
  const mimeType = stringValue(body.mime_type);
  const fileSizeBytes = numberValue(body.file_size_bytes);
  const durationSeconds = numberValue(body.duration_seconds);
  const recordedAt = stringValue(body.recorded_at);

  if (!isRecordingType(recordingType)) return badRequest("Invalid recording_type");
  if (!isConsentStatus(consentStatus)) return badRequest("Invalid consent_status");

  const recordingId = crypto.randomUUID();
  const bucket = "recordings";
  const path = `${auth.user.id}/${recordingId}/original_audio.${audioExtension(mimeType)}`;

  const { data, error } = await auth.client
    .from("recordings")
    .insert({
      id: recordingId,
      user_id: auth.user.id,
      title,
      recording_type: recordingType,
      consent_status: consentStatus,
      storage_bucket: bucket,
      storage_path: path,
      mime_type: mimeType,
      duration_seconds: durationSeconds,
      file_size_bytes: fileSizeBytes,
      status: "uploaded",
      recorded_at: recordedAt,
    })
    .select("id, storage_bucket, storage_path")
    .single();

  if (error) return serverError("Failed to create recording", error.message);

  const { error: consentError } = await auth.client.from("consent_logs").insert({
    recording_id: recordingId,
    user_id: auth.user.id,
    consent_status: consentStatus,
  });

  if (consentError) {
    console.error("consent_logs insert failed:", consentError);
  }

  const signedUpload = await auth.client.storage.from(bucket).createSignedUploadUrl(path);

  return json(201, {
    recording_id: data.id,
    bucket: data.storage_bucket,
    path: data.storage_path,
    signed_upload_url: signedUpload.data?.signedUrl ?? null,
    signed_upload_token: signedUpload.data?.token ?? null,
    client_upload_flow:
      signedUpload.error ? "Upload to the private recordings bucket at the returned path using the authenticated client." : null,
    ...(consentError ? { consent_log_warning: consentError.message } : {}),
  });
}
