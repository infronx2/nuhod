"""
Nuhoud Medical Rehab Platform — Edge AI Pose Server.

Streams biomechanical joint angles from the default webcam (Iriun)
to connected clients over WebSocket at /ws/track.
"""

from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

import cv2
import mediapipe as mp
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("nuhoud.pose-server")

mp_pose = mp.solutions.pose

CAMERA_INDEX = 0
HOST = "0.0.0.0"
PORT = 8001
FRAME_INTERVAL_S = 1.0 / 30.0

# Compensation thresholds (normalized image space / degrees).
TRUNK_LEAN_THRESHOLD_DEG = 15.0
SHOULDER_SHRUG_Y_DELTA = 0.06  # left vs right shoulder elevation
SHOULDER_TO_EAR_SHRUG = 0.04  # shoulder approaching ear height

EMPTY_PAYLOAD: dict[str, Any] = {
    "tracking_success": False,
    "elbow_angle": 0.0,
    "shoulder_angle": 0.0,
    "wrist_x": 0.0,
    "wrist_y": 0.0,
    "trunk_lean_deg": 0.0,
    "compensation_detected": False,
}


def _lm_xy(landmark: Any) -> np.ndarray:
    return np.array([landmark.x, landmark.y], dtype=np.float64)


def angle_at_vertex(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Interior angle ABC in degrees (vertex at b)."""
    ba = a - b
    bc = c - b
    na = np.linalg.norm(ba)
    nc = np.linalg.norm(bc)
    if na < 1e-8 or nc < 1e-8:
        return 0.0
    cosine = float(np.dot(ba, bc) / (na * nc))
    cosine = max(-1.0, min(1.0, cosine))
    return float(math.degrees(math.acos(cosine)))


def trunk_lean_degrees(hip: np.ndarray, shoulder: np.ndarray) -> float:
    """
    Absolute lean of the trunk vs vertical, in degrees.

    Image y increases downward, so an upright torso is (dx≈0, dy_up>0)
    where dy_up = hip.y - shoulder.y.
    """
    dx = float(shoulder[0] - hip[0])
    dy_up = float(hip[1] - shoulder[1])
    return abs(float(math.degrees(math.atan2(dx, dy_up))))


def shoulder_shrug_detected(landmarks: Any) -> bool:
    """True if a shrug / scapular hike is present on the tracked side."""
    lm = mp_pose.PoseLandmark
    right_shoulder = landmarks[lm.RIGHT_SHOULDER]
    left_shoulder = landmarks[lm.LEFT_SHOULDER]
    right_ear = landmarks[lm.RIGHT_EAR]
    left_ear = landmarks[lm.LEFT_EAR]

    asymmetric = abs(right_shoulder.y - left_shoulder.y) > SHOULDER_SHRUG_Y_DELTA
    right_near_ear = (right_ear.y - right_shoulder.y) < SHOULDER_TO_EAR_SHRUG
    left_near_ear = (left_ear.y - left_shoulder.y) < SHOULDER_TO_EAR_SHRUG
    return bool(asymmetric or right_near_ear or left_near_ear)


def landmarks_visible(landmarks: Any, indices: list[Any], min_visibility: float = 0.5) -> bool:
    return all(landmarks[i].visibility >= min_visibility for i in indices)


def compute_pose_payload(landmarks: Any) -> dict[str, Any]:
    lm = mp_pose.PoseLandmark
    required = [lm.RIGHT_HIP, lm.RIGHT_SHOULDER, lm.RIGHT_ELBOW, lm.RIGHT_WRIST]
    if not landmarks_visible(landmarks, required):
        return dict(EMPTY_PAYLOAD)

    hip = _lm_xy(landmarks[lm.RIGHT_HIP])
    shoulder = _lm_xy(landmarks[lm.RIGHT_SHOULDER])
    elbow = _lm_xy(landmarks[lm.RIGHT_ELBOW])
    wrist = _lm_xy(landmarks[lm.RIGHT_WRIST])

    elbow_angle = round(angle_at_vertex(shoulder, elbow, wrist), 2)
    shoulder_angle = round(angle_at_vertex(hip, shoulder, elbow), 2)
    trunk_lean = round(trunk_lean_degrees(hip, shoulder), 2)
    shrugged = shoulder_shrug_detected(landmarks)
    compensation = shrugged or trunk_lean > TRUNK_LEAN_THRESHOLD_DEG

    wrist_x = float(np.clip(wrist[0], 0.0, 1.0))
    wrist_y = float(np.clip(wrist[1], 0.0, 1.0))

    return {
        "tracking_success": True,
        "elbow_angle": elbow_angle,
        "shoulder_angle": shoulder_angle,
        "wrist_x": round(wrist_x, 4),
        "wrist_y": round(wrist_y, 4),
        "trunk_lean_deg": trunk_lean,
        "compensation_detected": compensation,
    }


class PoseTracker:
    """Owns the webcam + MediaPipe session and fans out JSON to WebSocket clients."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._latest: dict[str, Any] = dict(EMPTY_PAYLOAD)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)
            if self._task is None or self._task.done():
                self._task = asyncio.create_task(self._run_loop(), name="pose-capture")
        logger.info("Client connected (%d active)", len(self._clients))

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)
            remaining = len(self._clients)
        logger.info("Client disconnected (%d active)", remaining)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        async with self._lock:
            clients = list(self._clients)
        stale: list[WebSocket] = []
        for ws in clients:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._clients.discard(ws)

    async def _run_loop(self) -> None:
        cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(CAMERA_INDEX)
        if not cap.isOpened():
            logger.error("Unable to open webcam index %s (Iriun / default camera)", CAMERA_INDEX)
            await self._broadcast(dict(EMPTY_PAYLOAD))
            return

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

        pose = mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            smooth_landmarks=True,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        logger.info("Pose capture loop started on camera %s", CAMERA_INDEX)
        try:
            while True:
                async with self._lock:
                    if not self._clients:
                        break

                ok, frame = await asyncio.to_thread(cap.read)
                if not ok or frame is None:
                    self._latest = dict(EMPTY_PAYLOAD)
                    await self._broadcast(self._latest)
                    await asyncio.sleep(FRAME_INTERVAL_S)
                    continue

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                rgb.flags.writeable = False
                results = pose.process(rgb)

                if results.pose_landmarks:
                    self._latest = compute_pose_payload(results.pose_landmarks.landmark)
                else:
                    self._latest = dict(EMPTY_PAYLOAD)

                await self._broadcast(self._latest)
                await asyncio.sleep(FRAME_INTERVAL_S)
        except asyncio.CancelledError:
            logger.info("Pose capture loop cancelled")
            raise
        finally:
            pose.close()
            cap.release()
            logger.info("Pose capture loop stopped")


app = FastAPI(title="Nuhoud Edge AI Pose Server", version="1.0.0")
tracker = PoseTracker()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "nuhoud-pose-server"}


@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket) -> None:
    await tracker.connect(websocket)
    try:
        while True:
            # Keep the socket alive; pose frames are pushed by PoseTracker.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error on /ws/track")
    finally:
        await tracker.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
