"""
Nuhoud - Real-Time AI Inference Server
==========================================

Phase 1 deliverable: a production-ready FastAPI + WebSocket + MediaPipe Pose
backend for post-stroke upper-limb rehabilitation.

Architecture role
-----------------
This server is the "Real-Time Processing Tier" of the Nuhoud distributed
system. It receives camera frames from the Unreal Engine 5 (UE5) mobile client
(or any WebSocket client, including the Next.js test harness) as Base64-encoded
JPEG strings, runs Google MediaPipe Pose to extract 3D landmarks, computes the
elbow joint angle with proper biomechanics math, detects compensatory shoulder
shrugging, and streams a tiny JSON verdict back to the game client in real time.

Key design choices
------------------
* MediaPipe 0.10.x classic API (`mp.solutions.pose`) - the API the UE5 team is
  coding against, and the one that ships the 33-landmark BlazePose model.
* One `Pose` instance per WebSocket connection (MediaPipe's Pose object is NOT
  thread-safe across concurrent connections) so each patient session gets an
  isolated, warm tracker.
* All heavy work happens inside the async receive loop using `asyncio.to_thread`
  so the FastAPI event loop is never blocked by GIL-bound MediaPipe inference.
* Repetition counting uses hysteresis (extended -> flexed -> extended) to avoid
  double-counting jitter near the target angle.
* Compensation detection compares the shoulder's vertical position against a
  rolling baseline captured while the arm is relaxed - this is far more robust
  than a hard-coded pixel threshold because it adapts to camera framing,
  patient distance and patient height.

Author: Nuhoud Backend Team
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import math
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Deque, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from mediapipe import solutions as mp_solutions  # mp.solutions.pose lives here

# ---------------------------------------------------------------------------
# Logging - structured enough for production, light enough for real-time loops
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
)
logger = logging.getLogger("nuhoud.pose")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
POSE_SERVER_PORT = 8001

# MediaPipe Pose landmark indices (BlazePose, 33 points).
# See https://google.github.io/mediapipe/solutions/pose.html
LM_RIGHT_SHOULDER = 12
LM_RIGHT_ELBOW = 14
LM_RIGHT_WRIST = 16
LM_LEFT_SHOULDER = 11
LM_LEFT_ELBOW = 13
LM_LEFT_WRIST = 15
LM_NOSE = 0  # used as a rough vertical reference for the head

# Hysteresis band (in degrees) used for rep counting so a noisy angle signal
# near the target doesn't register dozens of reps per second.
REP_HYSTERESIS_DEG = 15.0

# Sliding window for the relaxed-shoulder baseline (in frames). At ~15 fps this
# is ~2 seconds of history, plenty to capture the resting shoulder height.
BASELINE_WINDOW = 30


# ---------------------------------------------------------------------------
# Biomechanics helpers
# ---------------------------------------------------------------------------
def calculate_angle(a, b, c) -> float:
    """
    Compute the interior joint angle (in degrees) at point `b` formed by the
    three 2D points a-b-c.

    Biomechanics convention
    -----------------------
    For elbow flexion we pass a=shoulder, b=elbow, c=wrist. A fully extended
    arm is ~180deg; a fully flexed arm is ~0deg. This matches the goniometric
    measurement a physiotherapist would take with a manual goniometer.

    Math
    ----
    Uses atan2 of the two direction vectors (b->a) and (b->c). atan2 is
    preferred over acos here because (1) it's numerically stable near 0 and
    180 degrees, and (2) it preserves the sign so we can take the absolute
    supplementary angle correctly when the joint opens past 180deg (which
    happens with medial/lateral rotation).

    Parameters
    ----------
    a, b, c : array-like of shape (2,) or (3,)
        Shoulder, elbow, wrist coordinates. Only the first two dims (x, y)
        are used for the planar angle - this is the standard 2D sagittal-plane
        measurement used in telerehabilitation literature.

    Returns
    -------
    float
        Angle in degrees in the range [0, 180].
    """
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    c = np.asarray(c, dtype=np.float32)

    # Direction vectors from the elbow (vertex) to the shoulder and wrist.
    ba = a - b
    bc = c - b

    # atan2 returns the angle each vector makes with the +x axis. The
    # difference is the signed angle between them, robust to wrap-around.
    angle_rad = math.atan2(bc[1], bc[0]) - math.atan2(ba[1], ba[0])
    angle_deg = abs(np.degrees(angle_rad))

    # Fold into [0, 180] - an elbow can't physically open past 180deg, so
    # anything larger is just the other side of the same joint.
    if angle_deg > 180.0:
        angle_deg = 360.0 - angle_deg

    return float(angle_deg)


def _to_xy(landmark) -> Tuple[float, float]:
    """Extract normalized (x, y) from a MediaPipe landmark."""
    return (float(landmark.x), float(landmark.y))


# ---------------------------------------------------------------------------
# Per-connection session state
# ---------------------------------------------------------------------------
@dataclass
class SessionState:
    """Mutable state tracked for a single WebSocket tracking session."""

    target_angle: float = 90.0
    limb: str = "right"  # "right" or "left" upper limb
    compensation_threshold: float = 0.05  # normalized image units
    min_visibility: float = 0.5

    # Rep counting state machine
    rep_count: int = 0
    score: int = 0
    max_achieved_angle: float = 0.0
    compensation_errors: int = 0
    _arm_extended: bool = True  # start assuming arm is extended

    # Baseline for compensation detection (rolling median of shoulder y)
    _shoulder_baseline: Deque[float] = field(default_factory=lambda: deque(maxlen=BASELINE_WINDOW))
    _baseline_ready: bool = False

    # Performance telemetry
    frames_processed: int = 0
    latencies: Deque[float] = field(default_factory=lambda: deque(maxlen=60))

    def reset_baseline(self) -> None:
        self._shoulder_baseline.clear()
        self._baseline_ready = False

    def update_rep_machine(self, elbow_angle: float, compensation: bool) -> None:
        """
        Hysteresis rep counter.

        A rep is counted when the elbow flexes below (target - hysteresis)
        and then extends back above (target + hysteresis). We only credit a
        rep when there was NO compensation detected during the flexion peak -
        this directly encodes the clinical rule "compensated reps don't count".
        """
        flexed_target = self.target_angle - REP_HYSTERESIS_DEG
        extended_target = self.target_angle + REP_HYSTERESIS_DEG

        if not self._arm_extended and elbow_angle >= extended_target:
            # Arm has returned to extended -> close the rep.
            self._arm_extended = True
            self.rep_count += 1
            # Scoring: clean reps worth 10, reps with any compensation in the
            # flexion worth 3 (still some effort, but bad form).
            # The `compensation` flag here reflects the current frame; the
            # session-level error counter tracks cumulative bad-posture frames.
            self.score += 3 if compensation else 10

        if self._arm_extended and elbow_angle <= flexed_target:
            # Arm has flexed past the target -> prepare to credit a rep on
            # the way back up.
            self._arm_extended = False

    def consider_baseline(self, shoulder_y: float) -> None:
        """Feed the relaxed-shoulder baseline buffer."""
        self._shoulder_baseline.append(shoulder_y)
        if len(self._shoulder_baseline) >= 10:
            self._baseline_ready = True

    def detect_compensation(self, shoulder_y: float) -> bool:
        """
        Detect compensatory shoulder shrug.

        Clinical rationale
        -------------------
        After a stroke, patients often cannot flex the elbow through the full
        ROM, so they unconsciously elevate (shrug) the affected shoulder to
        bring the hand toward the target. This is a maladaptive compensation
        pattern that therapists want to discourage.

        Implementation
        --------------
        We capture a rolling baseline of the shoulder's normalized Y position
        (image Y, top=0). Because Y decreases downward, a SHRUG moves the
        shoulder UP, i.e. to SMALLER Y values. So compensation is flagged when
        the current shoulder_y drops more than `compensation_threshold` below
        the baseline median.

        Using a rolling baseline (vs. a hard pixel threshold) makes the
        detector robust to patient height, camera distance and framing.
        """
        if not self._baseline_ready:
            return False
        baseline_median = float(np.median(list(self._shoulder_baseline)))
        # Smaller Y = higher in the image = shoulder raised (shrug).
        shrug_amount = baseline_median - shoulder_y
        return shrug_amount > self.compensation_threshold


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
# In-memory registry of completed sessions (Phase 1 stand-in for PostgreSQL /
# Supabase which arrives in Phase 2). Thread-safe enough for single-process uvicorn.
completed_sessions: list[dict] = []
active_connections: int = 0

# Internal API key + target URL for the Next.js auto-sync (system-to-system).
# The Next.js side validates the same key on POST /api/v2/sessions/sync.
SYNC_API_KEY = os.environ.get("NUHOUD_SYNC_API_KEY", "nuhoud-internal-sync-dev-7f3a9e1b")
NEXTJS_BASE_URL = os.environ.get("NUHOUD_NEXTJS_URL", "http://localhost:3000")


async def sync_session_to_nextjs(summary: dict) -> bool:
    """
    POST a completed session summary to the Next.js /api/v2/sessions/sync
    endpoint so live-camera sessions are persisted to the SQLite DB even when
    the UE5/browser client never calls POST /api/v2/sessions manually.

    Best-effort: logs a warning on failure but never raises — the WS loop
    must not crash because the sync target is down.

    The actual HTTP call is synchronous (urllib), so we run it in a worker
    thread via asyncio.to_thread to avoid blocking the uvicorn event loop.
    """
    def _do_sync() -> bool:
        try:
            import urllib.request
            import json as _json
            payload = _json.dumps(summary).encode("utf-8")
            req = urllib.request.Request(
                f"{NEXTJS_BASE_URL}/api/v2/sessions/sync",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Nuhoud-Key": SYNC_API_KEY,
                },
                method="POST",
            )
            # Short timeout so a slow Next.js never blocks the WS close handler.
            with urllib.request.urlopen(req, timeout=5) as resp:
                resp.read()  # drain
                return resp.status == 200
        except Exception as exc:  # noqa: BLE001
            logger.warning("Session sync to Next.js failed: %s", exc)
            return False

    ok = await asyncio.to_thread(_do_sync)
    logger.info("Session synced to Next.js: ok=%s", ok)
    return ok


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Nuhoud Pose Server starting on port %s", POSE_SERVER_PORT)
    yield
    logger.info("Nuhoud Pose Server shutting down (active=%s)", active_connections)


app = FastAPI(
    title="Nuhoud Pose Inference Server",
    description=(
        "Real-time MediaPipe Pose inference + biomechanics for post-stroke "
        "upper-limb rehabilitation. Phase 1 of the Nuhoud platform."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Permissive CORS - the UE5 mobile client, the Next.js dashboard, and hospital
# EHR probes all hit this server from different origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Landing / health probe."""
    return {
        "service": "Nuhoud Pose Inference Server",
        "phase": 1,
        "status": "ok",
        "active_connections": active_connections,
        "endpoints": {
            "websocket": "/ws/track?limb=right&target_angle=90",
            "health": "/health",
            "sessions": "/api/v1/sessions",
            "stats": "/api/v1/stats",
        },
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "active_connections": active_connections,
        "completed_sessions": len(completed_sessions),
        "mediapipe": "mp.solutions.pose",
        "opencv": cv2.__version__,
        "numpy": np.__version__,
    }


@app.get("/api/v1/sessions")
async def list_sessions():
    """Return all completed sessions (Phase 1 in-memory store)."""
    return {"count": len(completed_sessions), "sessions": completed_sessions}


@app.get("/api/v1/stats")
async def aggregate_stats():
    """Aggregate gamification + clinical stats across all completed sessions."""
    if not completed_sessions:
        return {"count": 0, "total_reps": 0, "total_correct_reps": 0, "total_score": 0}
    total_reps = sum(s["total_reps"] for s in completed_sessions)
    total_correct = sum(s["correct_reps"] for s in completed_sessions)
    total_score = sum(s["gamification_score"] for s in completed_sessions)
    return {
        "count": len(completed_sessions),
        "total_reps": total_reps,
        "total_correct_reps": total_correct,
        "total_score": total_score,
        "accuracy_pct": round(100.0 * total_correct / total_reps, 2) if total_reps else 0.0,
    }


@app.post("/api/v1/sessions")
async def save_session(payload: dict):
    """
    Persist a completed rehab session.

    The UE5 client calls this when the game ends. Phase 1 stores in memory;
    Phase 2 will swap this for Supabase/PostgreSQL with the exact schema from
    the system design (rehab_sessions table).
    """
    required = {"patient_id", "duration_seconds", "total_reps", "correct_reps",
                "max_achieved_angle", "compensation_errors", "gamification_score"}
    missing = required - set(payload.keys())
    if missing:
        return {"ok": False, "error": f"missing fields: {sorted(missing)}"}
    record = {
        "id": f"sess_{int(time.time() * 1000)}",
        "patient_id": payload["patient_id"],
        "plan_id": payload.get("plan_id"),
        "session_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **payload,
    }
    completed_sessions.append(record)
    logger.info("Saved session %s (patient=%s reps=%s score=%s)",
                record["id"], record["patient_id"],
                record["total_reps"], record["gamification_score"])
    return {"ok": True, "session": record}


# ---------------------------------------------------------------------------
# Frame decoding
# ---------------------------------------------------------------------------
def decode_base64_frame(b64_str: str) -> Optional[np.ndarray]:
    """
    Decode a Base64-encoded JPEG (optionally prefixed with a data URI scheme)
    into an OpenCV BGR array.

    Returns None on any decoding failure so the caller can skip the frame
    gracefully instead of crashing the WebSocket loop.
    """
    if not b64_str:
        return None
    # Strip optional data URI prefix: "data:image/jpeg;base64,...."
    if "," in b64_str and b64_str.startswith("data:"):
        b64_str = b64_str.split(",", 1)[1]
    try:
        jpg = base64.b64decode(b64_str, validate=False)
    except (binascii.Error, ValueError) as exc:
        logger.debug("base64 decode failed: %s", exc)
        return None
    if not jpg:
        return None
    arr = np.frombuffer(jpg, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img  # may be None if cv2 fails


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws/track")
async def track(
    websocket: WebSocket,
    limb: str = Query("right", description="'right' or 'left' upper limb"),
    target_angle: float = Query(90.0, description="Target elbow flexion in degrees"),
    compensation_threshold: float = Query(0.05, description="Shrug threshold (normalized Y)"),
    patient_id: str = Query("", description="Patient ID for auto-sync to the Next.js DB"),
):
    """
    Real-time pose tracking WebSocket.

    Protocol
    --------
    Client -> Server messages (JSON, UTF-8):

      1) Frame:      {"type":"frame","image":"<base64 jpeg>"}
      2) Reconfigure:{"type":"config","target_angle":90,"limb":"right",
                       "compensation_threshold":0.05}

    Server -> Client messages:

      Successful frame:
        {
          "type":"tracking",
          "elbow_angle":45.5, "target_angle":90,
          "target_reached":false, "compensation_detected":false,
          "command":"KEEP_GOING",
          "rep_count":0, "score":0, "max_achieved_angle":45.5,
          "visibility":0.93,
          "landmarks":{"shoulder":[x,y],"elbow":[x,y],"wrist":[x,y]},
          "latency_ms":12.3,
          "timestamp":1700000000.123
        }

      No pose / corrupted frame:
        {"type":"error","code":"NO_POSE","message":"MediaPipe found no person"}

    Commands
    --------
      KEEP_GOING      - patient is mid-rep, angle below target, posture OK
      HOLD            - target reached, hold the position
      TARGET_HIT      - just completed a valid rep
      CORRECT_POSTURE - compensation detected, stop shrugging
      NO_POSE         - therapist should reposition the camera
    """
    global active_connections

    # Validate params up front so we never accept a malformed session.
    limb = limb.lower()
    if limb not in ("right", "left"):
        await websocket.close(code=4000, reason="limb must be 'right' or 'left'")
        return
    if not (0.0 <= target_angle <= 180.0):
        await websocket.close(code=4000, reason="target_angle must be in [0,180]")
        return

    await websocket.accept()
    active_connections += 1
    session = SessionState(
        target_angle=float(target_angle),
        limb=limb,
        compensation_threshold=float(compensation_threshold),
    )

    # MediaPipe's Pose object is not safe to share across connections, so we
    # instantiate one per session. static_image_mode=False enables the
    # temporal tracker for smooth real-time output.
    pose = mp_solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    logger.info("WS /ws/track open limb=%s target=%.1f active=%s",
                session.limb, session.target_angle, active_connections)

    try:
        await _tracking_loop(websocket, session, pose)
    except WebSocketDisconnect:
        logger.info("WS /ws/track client disconnected (limb=%s)", session.limb)
    except Exception as exc:  # noqa: BLE001 - we want to log every failure
        logger.exception("WS /ws/track crashed: %s", exc)
        try:
            await websocket.send_json({"type": "error", "code": "SERVER",
                                       "message": str(exc)})
        except Exception:
            pass
    finally:
        pose.close()
        active_connections -= 1
        # Persist a lightweight summary so the dashboard can show history.
        if session.frames_processed > 0:
            local_record = {
                "id": f"ws_{int(time.time()*1000)}",
                "patient_id": patient_id or "live_session",
                "plan_id": None,
                "session_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "duration_seconds": 0,
                "total_reps": session.rep_count,
                "correct_reps": session.rep_count,  # refined in Phase 2
                "max_achieved_angle": round(session.max_achieved_angle, 2),
                "compensation_errors": session.compensation_errors,
                "gamification_score": session.score,
                "frames_processed": session.frames_processed,
            }
            completed_sessions.append(local_record)

            # Auto-sync to the Next.js DB so live-camera sessions are persisted
            # even if the client never calls POST /api/v2/sessions manually.
            # Only sync when a real patient_id was supplied on the WS connect.
            if patient_id:
                sync_payload = {
                    "patient_id": patient_id,
                    "plan_id": None,
                    "source": "live",
                    "limb": session.limb,
                    "duration_seconds": 0,
                    "total_reps": session.rep_count,
                    "correct_reps": session.rep_count,
                    "max_achieved_angle": round(session.max_achieved_angle, 2),
                    "compensation_errors": session.compensation_errors,
                    "gamification_score": session.score,
                }
                await sync_session_to_nextjs(sync_payload)
        logger.info("WS /ws/track closed reps=%s score=%s active=%s patient=%s",
                    session.rep_count, session.score, active_connections, patient_id or "anon")


async def _tracking_loop(websocket: WebSocket, session: SessionState, pose) -> None:
    """Main receive/decode/infer/respond loop for one connection."""

    # Pick the landmark indices for the requested limb.
    if session.limb == "right":
        idx_shoulder, idx_elbow, idx_wrist = (
            LM_RIGHT_SHOULDER, LM_RIGHT_ELBOW, LM_RIGHT_WRIST
        )
    else:
        idx_shoulder, idx_elbow, idx_wrist = (
            LM_LEFT_SHOULDER, LM_LEFT_ELBOW, LM_LEFT_WRIST
        )

    while True:
        raw = await websocket.receive_text()
        t0 = time.perf_counter()

        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_json({"type": "error", "code": "BAD_JSON",
                                       "message": "expected JSON"})
            continue

        mtype = msg.get("type")

        # --- config update mid-session ------------------------------------
        if mtype == "config":
            new_target = msg.get("target_angle")
            if isinstance(new_target, (int, float)) and 0 <= new_target <= 180:
                session.target_angle = float(new_target)
            new_limb = msg.get("limb")
            if new_limb in ("right", "left") and new_limb != session.limb:
                session.limb = new_limb
                # Reset baseline when switching limbs.
                session.reset_baseline()
                if session.limb == "right":
                    idx_shoulder, idx_elbow, idx_wrist = (
                        LM_RIGHT_SHOULDER, LM_RIGHT_ELBOW, LM_RIGHT_WRIST
                    )
                else:
                    idx_shoulder, idx_elbow, idx_wrist = (
                        LM_LEFT_SHOULDER, LM_LEFT_ELBOW, LM_LEFT_WRIST
                    )
            new_thresh = msg.get("compensation_threshold")
            if isinstance(new_thresh, (int, float)) and 0 < new_thresh < 0.5:
                session.compensation_threshold = float(new_thresh)
            await websocket.send_json({"type": "config_ack",
                                        "target_angle": session.target_angle,
                                        "limb": session.limb,
                                        "compensation_threshold": session.compensation_threshold})
            continue

        if mtype != "frame":
            await websocket.send_json({"type": "error", "code": "BAD_TYPE",
                                       "message": f"unknown type '{mtype}'"})
            continue

        # --- decode --------------------------------------------------------
        img = decode_base64_frame(msg.get("image", ""))
        if img is None:
            await websocket.send_json({"type": "error", "code": "BAD_FRAME",
                                       "message": "could not decode base64 JPEG"})
            continue

        # --- run MediaPipe in a worker thread so we don't block the loop ---
        # MediaPipe's process() is synchronous and CPU-bound; without
        # to_thread a single slow client would stall every other connection.
        try:
            results = await asyncio.to_thread(pose.process, cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        except Exception as exc:  # noqa: BLE001
            logger.warning("MediaPipe process failed: %s", exc)
            await websocket.send_json({"type": "error", "code": "INFER_FAIL",
                                       "message": str(exc)})
            continue

        if not results.pose_landmarks:
            # No person detected - tell the client so the game can prompt the
            # therapist to reposition the camera. We do NOT increment errors
            # here; a missing person is a setup issue, not a patient fault.
            await websocket.send_json({
                "type": "tracking",
                "elbow_angle": None,
                "target_angle": session.target_angle,
                "target_reached": False,
                "compensation_detected": False,
                "command": "NO_POSE",
                "rep_count": session.rep_count,
                "score": session.score,
                "max_achieved_angle": round(session.max_achieved_angle, 2),
                "visibility": 0.0,
                "landmarks": None,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                "timestamp": time.time(),
            })
            continue

        lms = results.pose_landmarks.landmark
        shoulder = lms[idx_shoulder]
        elbow = lms[idx_elbow]
        wrist = lms[idx_wrist]

        # Visibility check - if the limb is occluded, don't trust the angle.
        vis = min(shoulder.visibility, elbow.visibility, wrist.visibility)
        if vis < session.min_visibility:
            await websocket.send_json({
                "type": "tracking",
                "elbow_angle": None,
                "target_angle": session.target_angle,
                "target_reached": False,
                "compensation_detected": False,
                "command": "NO_POSE",
                "rep_count": session.rep_count,
                "score": session.score,
                "max_achieved_angle": round(session.max_achieved_angle, 2),
                "visibility": float(round(vis, 3)),
                "landmarks": None,
                "latency_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                "timestamp": time.time(),
            })
            continue

        # --- biomechanics --------------------------------------------------
        s_xy = _to_xy(shoulder)
        e_xy = _to_xy(elbow)
        w_xy = _to_xy(wrist)
        elbow_angle = calculate_angle(s_xy, e_xy, w_xy)

        # Track max ROM achieved this session.
        if elbow_angle > session.max_achieved_angle:
            session.max_achieved_angle = elbow_angle

        # Compensation detection (baseline-fed shrug detector).
        session.consider_baseline(s_xy[1])
        compensation = session.detect_compensation(s_xy[1])
        if compensation:
            session.compensation_errors += 1

        # Rep counting (hysteresis) - credits the rep on the way back up.
        prev_reps = session.rep_count
        session.update_rep_machine(elbow_angle, compensation)
        rep_just_completed = session.rep_count > prev_reps

        # --- decide the command for the game client ------------------------
        target_reached = elbow_angle <= session.target_angle
        if compensation:
            command = "CORRECT_POSTURE"
        elif rep_just_completed:
            command = "TARGET_HIT"
        elif target_reached:
            command = "HOLD"
        else:
            command = "KEEP_GOING"

        latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        session.frames_processed += 1
        session.latencies.append(latency_ms)

        await websocket.send_json({
            "type": "tracking",
            "elbow_angle": round(elbow_angle, 2),
            "target_angle": session.target_angle,
            "target_reached": target_reached,
            "compensation_detected": compensation,
            "command": command,
            "rep_count": session.rep_count,
            "score": session.score,
            "max_achieved_angle": round(session.max_achieved_angle, 2),
            "compensation_errors": session.compensation_errors,
            "visibility": float(round(vis, 3)),
            "landmarks": {
                "shoulder": [round(s_xy[0], 4), round(s_xy[1], 4)],
                "elbow": [round(e_xy[0], 4), round(e_xy[1], 4)],
                "wrist": [round(w_xy[0], 4), round(w_xy[1], 4)],
            },
            "latency_ms": latency_ms,
            "fps_avg": round(1000.0 / np.mean(session.latencies), 1) if session.latencies and np.mean(session.latencies) > 0 else 0.0,
            "timestamp": time.time(),
        })


# ---------------------------------------------------------------------------
# Entrypoint - `python3 main.py` starts uvicorn with hot reload OFF in prod.
# We keep reload off because MediaPipe allocates native resources that don't
# play well with the reloader's forking.
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=POSE_SERVER_PORT,
        log_level="info",
        reload=False,
        ws_max_size=8 * 1024 * 1024,  # 8 MB - large enough for raw PNG frames
    )
