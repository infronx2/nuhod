"""Nuhoud Pose Server v3 — first-person metric tracking.

Every position is sent in centimetres relative to the midpoint between the
patient's eyes, using the game's axes: [forward, right, up]. "forward" points
from the patient toward the screen, "right" is the patient's own right.
"""
import asyncio
import json
import math
import time

import cv2
import mediapipe as mp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

# ── Configuration ─────────────────────────────────────────────────────────
CAMERA_INDEX = 0
CAMERA_MIRRORED = False      # True if the webcam driver already mirrors the image
POSE_MODEL_COMPLEXITY = 1    # 2 is slightly more precise but drops to ~12 fps on CPU, which makes the hands lag
DEPTH_SCALE = 1.0            # monocular depth is compressed on some webcams; raise to deepen forward reach
VISIBILITY_MIN = 0.5
HAND_LOST_RESET_S = 0.4
CAMERA_LOST_S = 1.0          # no frame for this long: report "camera": false to the game
CAMERA_STATUS_EVERY_S = 0.5  # how often to repeat that report (it also keeps the game's link alive)
CAMERA_REOPEN_EVERY_S = 3.0  # how often to try reopening a camera that delivers nothing

mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands
PL = mp_pose.PoseLandmark

pose = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=POSE_MODEL_COMPLEXITY,
    smooth_landmarks=True,
    enable_segmentation=False,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6,
)
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    model_complexity=1,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.5,
)

cap = None


# ── Filtering ─────────────────────────────────────────────────────────────
class OneEuroFilter:
    def __init__(self, freq=30.0, min_cutoff=1.0, beta=0.007, d_cutoff=1.0):
        self.freq = freq
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    def _alpha(self, cutoff):
        tau = 1.0 / (2.0 * math.pi * cutoff)
        te = 1.0 / self.freq
        return 1.0 / (1.0 + tau / te)

    def __call__(self, x, t):
        if self.x_prev is None:
            self.x_prev = x
            self.t_prev = t
            return x
        dt = t - self.t_prev
        if dt <= 0:
            dt = 1.0 / self.freq
        self.freq = 1.0 / dt
        self.t_prev = t

        a_d = self._alpha(self.d_cutoff)
        dx = (x - self.x_prev) * self.freq
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        a = self._alpha(self.min_cutoff + self.beta * abs(dx_hat))
        x_hat = a * x + (1 - a) * self.x_prev

        self.x_prev = x_hat
        self.dx_prev = dx_hat
        return x_hat


class PointsFilter:
    """One Euro filter per coordinate for a list of 3D points."""

    def __init__(self, min_cutoff, beta):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.filters = []

    def reset(self):
        self.filters = []

    def __call__(self, points, t):
        if len(self.filters) != len(points):
            self.filters = [[OneEuroFilter(min_cutoff=self.min_cutoff, beta=self.beta) for _ in range(3)]
                            for _ in points]
        return [tuple(f[i](p[i], t) for i in range(3)) for f, p in zip(self.filters, points)]


# Units are metres; beta is tuned so a 1 m/s reach raises the cutoff to ~5 Hz.
pose_world_filter = PointsFilter(min_cutoff=1.2, beta=4.0)
hand_world_filters = {"right": PointsFilter(1.5, 3.0), "left": PointsFilter(1.5, 3.0)}
hand_last_seen = {"right": 0.0, "left": 0.0}
angle_filters = {}
image_wrist_filters = {"x": OneEuroFilter(min_cutoff=1.5, beta=0.5), "y": OneEuroFilter(min_cutoff=1.5, beta=0.5)}


def filt_angle(key, value, t):
    if key not in angle_filters:
        angle_filters[key] = OneEuroFilter(min_cutoff=1.0, beta=0.02)
    return angle_filters[key](value, t)


# ── Vector math ───────────────────────────────────────────────────────────
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def scale(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def norm(a): return math.sqrt(dot(a, a))
def mid(a, b): return scale(add(a, b), 0.5)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def normalize(a):
    n = norm(a)
    return (0.0, 0.0, 0.0) if n < 1e-9 else scale(a, 1.0 / n)


def orthonormal(v, ref):
    """Component of v perpendicular to unit vector ref, normalised."""
    return normalize(sub(v, scale(ref, dot(v, ref))))


def angle_deg(a, b):
    na, nb = norm(a), norm(b)
    if na * nb < 1e-9:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, dot(a, b) / (na * nb)))))


def to_game(p, depth_scale=1.0):
    """MediaPipe world metres (x image-right, y down, z away from camera)
    -> game centimetres (forward, patient-right, up) for an un-mirrored webcam."""
    return (-p[2] * 100.0 * depth_scale, -p[0] * 100.0, -p[1] * 100.0)


def r1(v): return round(v, 1)
def rv(v, nd=2): return [round(c, nd) for c in v]


# ── Arms ──────────────────────────────────────────────────────────────────
ARM_IDS = {
    "right": (PL.RIGHT_SHOULDER.value, PL.RIGHT_ELBOW.value, PL.RIGHT_WRIST.value),
    "left": (PL.LEFT_SHOULDER.value, PL.LEFT_ELBOW.value, PL.LEFT_WRIST.value),
}
segment_len = {"right": [None, None], "left": [None, None]}


def stable_length(side, idx, measured):
    cur = segment_len[side][idx]
    cur = measured if cur is None else cur + (measured - cur) * 0.02
    segment_len[side][idx] = cur
    return cur


def body_frame(G, vis):
    lsh, rsh = G[PL.LEFT_SHOULDER.value], G[PL.RIGHT_SHOULDER.value]
    mid_sh = mid(lsh, rsh)
    if vis[PL.LEFT_HIP.value] > VISIBILITY_MIN and vis[PL.RIGHT_HIP.value] > VISIBILITY_MIN:
        down = normalize(sub(mid(G[PL.LEFT_HIP.value], G[PL.RIGHT_HIP.value]), mid_sh))
    else:
        down = (0.0, 0.0, -1.0)
    lat_r = orthonormal(sub(rsh, lsh), down)
    fwd = normalize(cross(down, lat_r))
    return down, lat_r, fwd


def extract_arms(world_pts, vis, t):
    G = [to_game(p, DEPTH_SCALE) for p in world_pts]
    eyes = mid(G[PL.LEFT_EYE.value], G[PL.RIGHT_EYE.value])
    down, lat_r, fwd = body_frame(G, vis)

    arms = {}
    for side, (s_id, e_id, w_id) in ARM_IDS.items():
        tracked = min(vis[s_id], vis[e_id], vis[w_id]) > VISIBILITY_MIN
        upper = sub(G[e_id], G[s_id])
        fore = sub(G[w_id], G[e_id])
        u_dir, f_dir = normalize(upper), normalize(fore)
        l_upper = stable_length(side, 0, norm(upper))
        l_fore = stable_length(side, 1, norm(fore))

        shoulder = sub(G[s_id], eyes)
        elbow = add(shoulder, scale(u_dir, l_upper))
        wrist = add(elbow, scale(f_dir, l_fore))

        lat = lat_r if side == "right" else scale(lat_r, -1.0)
        elevation = math.degrees(math.acos(max(-1.0, min(1.0, dot(u_dir, down)))))
        flexion = math.degrees(math.atan2(dot(u_dir, fwd), dot(u_dir, down)))
        abduction = math.degrees(math.atan2(dot(u_dir, lat), dot(u_dir, down)))
        elbow_angle = angle_deg(scale(u_dir, -1.0), f_dir)

        arms[side] = {
            "tracked": tracked,
            "shoulder": rv(shoulder),
            "elbow": rv(elbow),
            "wrist": rv(wrist),
            "upper_arm_cm": r1(l_upper),
            "forearm_cm": r1(l_fore),
            "shoulder_elevation": r1(filt_angle(side + "_elev", elevation, t)),
            "shoulder_flexion": r1(filt_angle(side + "_flex", flexion, t)),
            "shoulder_abduction": r1(filt_angle(side + "_abd", abduction, t)),
            "elbow_angle": r1(filt_angle(side + "_elbow", elbow_angle, t)),
        }
    return arms


# ── Hands ─────────────────────────────────────────────────────────────────
FINGER_JOINTS = {
    "thumb": (1, 2, 3, 4),
    "index": (5, 6, 7, 8),
    "middle": (9, 10, 11, 12),
    "ring": (13, 14, 15, 16),
    "pinky": (17, 18, 19, 20),
}


def finger_curls(H):
    """Flexion per joint in degrees: 0 = straight, 90 = right-angle bend."""
    curls = {}
    for name, (a, b, c, tip) in FINGER_JOINTS.items():
        curls[name] = {
            "mcp": r1(max(0.0, 180.0 - angle_deg(sub(H[0], H[a]), sub(H[b], H[a])))),
            "pip": r1(max(0.0, 180.0 - angle_deg(sub(H[a], H[b]), sub(H[c], H[b])))),
            "dip": r1(max(0.0, 180.0 - angle_deg(sub(H[b], H[c]), sub(H[tip], H[c])))),
        }
    return curls


def detect_gesture(H):
    def dist(i, j): return norm(sub(H[i], H[j]))

    fingers = {
        "thumb": dist(4, 17) > dist(3, 17),
        "index": dist(8, 0) > dist(6, 0),
        "middle": dist(12, 0) > dist(10, 0),
        "ring": dist(16, 0) > dist(14, 0),
        "pinky": dist(20, 0) > dist(18, 0),
    }
    count = sum(fingers.values())
    pinch_cm = dist(4, 8)
    pinching = pinch_cm < 3.5

    if count >= 4 and not pinching:
        gesture = "open"
    elif count <= 1 and not fingers["index"]:
        gesture = "fist"
    elif pinching:
        gesture = "pinch"
    elif fingers["index"] and fingers["middle"] and not fingers["ring"] and not fingers["pinky"]:
        gesture = "peace"
    elif fingers["index"] and not fingers["middle"] and not fingers["ring"]:
        gesture = "point"
    else:
        gesture = "partial"
    return gesture, count, pinching, pinch_cm, fingers


def hand_frame(H, side):
    """Finger direction (wrist -> middle knuckle) and palm normal (out of the palm)."""
    finger_dir = normalize(sub(H[9], H[0]))
    thumb_side = normalize(sub(H[5], H[17]))
    palm = cross(finger_dir, thumb_side) if side == "right" else cross(thumb_side, finger_dir)
    return finger_dir, orthonormal(palm, finger_dir)


def assign_hand_sides(hand_results, pose_image):
    """Match each detected hand to the patient's left/right arm by wrist proximity."""
    detections = []
    for i, img_lm in enumerate(hand_results.multi_hand_landmarks):
        wx, wy = img_lm.landmark[0].x, img_lm.landmark[0].y
        if pose_image is not None:
            rw = pose_image[PL.RIGHT_WRIST.value]
            lw = pose_image[PL.LEFT_WRIST.value]
            d_r = math.hypot(wx - rw.x, wy - rw.y)
            d_l = math.hypot(wx - lw.x, wy - lw.y)
            side, margin = ("right", d_l - d_r) if d_r <= d_l else ("left", d_r - d_l)
        else:
            # MediaPipe labels assume a mirrored selfie image; our feed is not mirrored.
            label = hand_results.multi_handedness[i].classification[0].label
            side, margin = ("right" if label == "Left" else "left"), 0.0
        detections.append((i, side, margin))

    if len(detections) == 2 and detections[0][1] == detections[1][1]:
        weaker = 0 if detections[0][2] < detections[1][2] else 1
        i, side, margin = detections[weaker]
        detections[weaker] = (i, "left" if side == "right" else "right", margin)
    return {side: i for i, side, _ in detections}


def extract_hands(hand_results, pose_image, t):
    out = {"right": {"tracked": False}, "left": {"tracked": False}}
    image_landmarks = {}
    if hand_results.multi_hand_landmarks and hand_results.multi_hand_world_landmarks:
        for side, i in assign_hand_sides(hand_results, pose_image).items():
            world = [(p.x, p.y, p.z) for p in hand_results.multi_hand_world_landmarks[i].landmark]
            world = hand_world_filters[side](world, t)
            H = [to_game(p) for p in world]

            finger_dir, palm = hand_frame(H, side)
            gesture, count, pinching, pinch_cm, fingers = detect_gesture(H)
            out[side] = {
                "tracked": True,
                "dir": rv(finger_dir, 3),
                "normal": rv(palm, 3),
                "curls": finger_curls(H),
                "gesture": gesture,
                "fingers_extended": count,
                "fingers": fingers,
                "is_pinching": pinching,
                "pinch_cm": r1(pinch_cm),
            }
            hand_last_seen[side] = t
            image_landmarks[side] = hand_results.multi_hand_landmarks[i].landmark

    for side in ("right", "left"):
        if not out[side]["tracked"] and t - hand_last_seen[side] > HAND_LOST_RESET_S:
            hand_world_filters[side].reset()
    return out, image_landmarks


# ── Frame processing ──────────────────────────────────────────────────────
def extract_data(frame_rgb, t):
    result = {"v": 3, "body": False, "arms": {}, "hands": {}}

    pose_results = pose.process(frame_rgb)
    pose_image = None
    if pose_results.pose_world_landmarks and pose_results.pose_landmarks:
        pose_image = pose_results.pose_landmarks.landmark
        raw_world = [(p.x, p.y, p.z) for p in pose_results.pose_world_landmarks.landmark]
        vis = [p.visibility for p in pose_results.pose_world_landmarks.landmark]
        world = pose_world_filter(raw_world, t)
        result["body"] = True
        result["arms"] = extract_arms(world, vis, t)

    hand_results = hands.process(frame_rgb)
    result["hands"], image_hands = extract_hands(hand_results, pose_image, t)

    add_legacy_fields(result, pose_image, image_hands, t)
    return result


def add_legacy_fields(result, pose_image, image_hands, t):
    """Flat v2 fields kept for existing consumers (the web dashboard reads elbow_angle)."""
    arms, hands_out = result["arms"], result["hands"]
    primary = "right" if arms.get("right", {}).get("tracked") or not arms.get("left", {}).get("tracked") else "left"
    arm = arms.get(primary)
    if arm:
        result["shoulder_angle"] = arm["shoulder_elevation"]
        result["shoulder_abduction"] = arm["shoulder_abduction"]
        result["elbow_angle"] = arm["elbow_angle"]
    if pose_image is not None:
        w = pose_image[ARM_IDS[primary][2]]
        result["wrist_x"] = round(image_wrist_filters["x"](w.x, t), 4)
        result["wrist_y"] = round(image_wrist_filters["y"](w.y, t), 4)

    hand_side = primary if hands_out[primary]["tracked"] else ("left" if primary == "right" else "right")
    hand = hands_out[hand_side]
    result["hand_detected"] = hand["tracked"]
    if hand["tracked"]:
        lm = image_hands[hand_side]
        result["hand_x"] = round(lm[0].x, 4)
        result["hand_y"] = round(lm[0].y, 4)
        result["gesture"] = hand["gesture"]
        result["fingers_extended"] = hand["fingers_extended"]
        result["is_pinching"] = hand["is_pinching"]
        result["finger_curls"] = hand["curls"]
        result["hand_landmarks"] = [{"x": round(p.x, 4), "y": round(p.y, 4), "z": round(p.z, 4)} for p in lm]


# ── Camera / WebSocket ────────────────────────────────────────────────────
def get_camera():
    global cap
    if cap is None or not cap.isOpened():
        cap = cv2.VideoCapture(CAMERA_INDEX)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


def reopen_camera():
    global cap
    if cap is not None:
        cap.release()
    cap = None
    return get_camera()


@app.websocket("/ws/track")
async def ws_track(websocket: WebSocket):
    await websocket.accept()
    camera = get_camera()
    print("[Nuhoud] Client connected — first-person metric tracking active")
    frame_count = 0
    start_time = time.time()
    last_frame_t = time.time()
    last_status_t = 0.0
    last_reopen_t = time.time()

    try:
        while True:
            ret, frame = camera.read()
            if not ret:
                # A phone camera that drops (app closed, Wi-Fi gap) delivers nothing. Tell the game,
                # so the patient sees why the hands stopped, and keep trying to reopen the camera.
                now = time.time()
                if now - last_frame_t > CAMERA_LOST_S:
                    if now - last_status_t > CAMERA_STATUS_EVERY_S:
                        last_status_t = now
                        await websocket.send_text(json.dumps(
                            {"v": 3, "camera": False, "body": False, "arms": {}, "hands": {}, "fps": 0.0}))
                    if now - last_reopen_t > CAMERA_REOPEN_EVERY_S:
                        last_reopen_t = now
                        print("[Nuhoud] Camera delivers no frames — reopening it")
                        camera = reopen_camera()
                await asyncio.sleep(0.01)
                continue
            last_frame_t = time.time()
            if CAMERA_MIRRORED:
                frame = cv2.flip(frame, 1)

            t = time.time()
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            data = extract_data(rgb, t)

            frame_count += 1
            data["camera"] = True
            data["frame"] = frame_count
            data["fps"] = round(frame_count / max(1e-6, t - start_time), 1)
            await websocket.send_text(json.dumps(data))
            await asyncio.sleep(0.001)
    except (WebSocketDisconnect, RuntimeError, ConnectionError):
        # The game closed or dropped the connection; it reconnects on its own.
        elapsed = time.time() - start_time
        print(f"[Nuhoud] Client disconnected — {frame_count} frames, avg {frame_count / max(elapsed, 1e-6):.1f} fps")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": 3,
        "tracking": ["pose_world", "hands_world_x2"],
        "units": "cm relative to eye midpoint, axes [forward, right, up]",
        "camera_mirrored": CAMERA_MIRRORED,
        "pose_model_complexity": POSE_MODEL_COMPLEXITY,
    }


if __name__ == "__main__":
    import uvicorn
    print("[Nuhoud] Pose Server v3 — first-person metric tracking")
    print(f"[Nuhoud] Pose complexity {POSE_MODEL_COMPLEXITY} | 2 hands | mirrored={CAMERA_MIRRORED}")
    print("[Nuhoud] Starting on ws://127.0.0.1:8001/ws/track")
    uvicorn.run(app, host="127.0.0.1", port=8001)
