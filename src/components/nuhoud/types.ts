/**
 * Shared Nuhoud types — match the backend WebSocket protocol exactly.
 * Authoritative spec: mini-services/pose-server/main.py (Task ID 1-4).
 */

export type WsCommand =
  | "KEEP_GOING"
  | "HOLD"
  | "TARGET_HIT"
  | "CORRECT_POSTURE"
  | "NO_POSE";

export type WsErrorCode =
  | "BAD_FRAME"
  | "BAD_JSON"
  | "BAD_TYPE"
  | "INFER_FAIL"
  | "SERVER"
  | "NO_POSE";

export type WsConnectionState = "Disconnected" | "Connecting" | "Connected";

export interface PoseLandmarks {
  shoulder: [number, number] | null;
  elbow: [number, number] | null;
  wrist: [number, number] | null;
}

export interface TrackingMessage {
  type: "tracking";
  elbow_angle: number | null;
  target_angle: number;
  target_reached: boolean;
  compensation_detected: boolean;
  command: WsCommand;
  rep_count: number;
  score: number;
  max_achieved_angle: number;
  compensation_errors: number;
  visibility: number;
  landmarks: PoseLandmarks | null;
  latency_ms: number;
  fps_avg: number;
  timestamp: number;
}

export interface ErrorMessage {
  type: "error";
  code: WsErrorCode;
  message: string;
}

export interface ConfigAckMessage {
  type: "config_ack";
  target_angle: number;
  limb: "right" | "left";
  compensation_threshold: number;
}

export type ServerMessage =
  | TrackingMessage
  | ErrorMessage
  | ConfigAckMessage;

export interface SessionRecord {
  id: string;
  patient_id: string;
  plan_id?: string | null;
  session_date: string;
  duration_seconds: number;
  total_reps: number;
  correct_reps: number;
  max_achieved_angle: number;
  compensation_errors: number;
  gamification_score: number;
}

export interface SessionsResponse {
  count: number;
  sessions: SessionRecord[];
}

export interface StatsResponse {
  count: number;
  total_reps: number;
  total_correct_reps: number;
  total_score: number;
  accuracy_pct?: number;
}

export interface SaveSessionPayload {
  patient_id: string;
  duration_seconds: number;
  total_reps: number;
  correct_reps: number;
  max_achieved_angle: number;
  compensation_errors: number;
  gamification_score: number;
}
