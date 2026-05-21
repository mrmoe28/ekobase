export const RECORDING_TYPES = ["speakerphone_call", "meeting", "voice_note", "site_visit", "other"] as const;
export const CONSENT_STATUSES = ["confirmed", "skipped", "unknown", "not_required"] as const;
export const PROCESSING_STATUSES = ["uploaded", "queued", "transcribing", "summarizing", "completed", "failed"] as const;

export type RecordingType = (typeof RECORDING_TYPES)[number];
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

export function isRecordingType(value: unknown): value is RecordingType {
  return typeof value === "string" && RECORDING_TYPES.includes(value as RecordingType);
}

export function isConsentStatus(value: unknown): value is ConsentStatus {
  return typeof value === "string" && CONSENT_STATUSES.includes(value as ConsentStatus);
}

export function audioExtension(mimeType: string | null): string {
  switch (mimeType) {
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    default:
      return "bin";
  }
}
