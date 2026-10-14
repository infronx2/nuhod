# Nuhoud majlis game (UE 5.5)

Source mirror of the Unreal project (`D:\gamez\Nuhoud` on the dev machine). The `Content/` folder
(map, materials, MannyXR hands) is not in git; copy it from the dev machine to build a full project.

| Path | What |
| --- | --- |
| `Source/Nuhoud` | C++ game module: first-person seated patient, rigged hands, majlis tasks, cloud sync |
| `Config/` | Project settings (default map `/Game/Nuhoud/Maps/NuhoudMajlis`) |
| `pose_server.py` | Pose server v3: phone/webcam -> MediaPipe -> WebSocket `ws://127.0.0.1:8001/ws/track` |

## Run

```
pip install -r requirements.txt
python pose_server.py
```

Build: `Engine\Build\BatchFiles\Build.bat NuhoudEditor Win64 Development -project=<path>\Nuhoud.uproject` (editor closed).

## Tracking

At start the game uses a connected OpenXR headset (head from the headset, hands from its hand
tracking, camera as fallback per hand); otherwise the camera through the pose server. The pose
server link reconnects 3 times (1, 2, 4 s); after that the patient presses **R**.

Command-line options: `-NuhoudCameraOnly` (ignore a connected headset), `-NuhoudBackend=<url>/api/v2`,
`-NuhoudPoseServer=ws://host:port/ws/track`.

## Sessions

A finished session (Esc, pain stop, or closing the game) is written to `Saved/LocalSessions/` and then
sent to `POST /api/v2/sessions` with the patient's JWT. The file is deleted only after the server
stores it; otherwise it is retried (10 s, 30 s, then every 60 s) and sent at the next sign-in of the
same patient. `clientSessionId` makes a re-sent session return the stored row instead of a duplicate,
and `sessionDate` keeps the time the session was played.
