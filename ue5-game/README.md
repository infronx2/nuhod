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

## Launcher

`launcher/start-nuhoud.ps1` starts the pose server (unless it is already running) and the game, and
stops that pose server when the game closes. Run `launcher/register-protocol.ps1` once per Windows
user so the website's **Start session** button (a `nuhoud://start` link) runs it. Edit the paths at
the top of `start-nuhoud.ps1` if the game or the engine live elsewhere.

## The doctor's plan

After sign-in the game loads the patient's active plan (`GET /api/v2/patients/{id}/plans`):
`targetAngle` centres the hook elevation, `dailyRepGoal` ends the session after that many completed
tasks, and `targetLimb` picks the hand that gets the tasks and is measured (the other hand is hidden).
Without a plan the game uses a 45° target, no task limit and both hands.

## Tracking

At start the game uses a connected OpenXR headset (head from the headset, hands from its hand
tracking, camera as fallback per hand); otherwise the camera through the pose server. The pose
server link reconnects 3 times (1, 2, 4 s); after that the patient presses **R**.

Command-line options: `-NuhoudCameraOnly` (ignore a connected headset), `-NuhoudBackend=<url>/api/v2`,
`-NuhoudPoseServer=ws://host:port/ws/track`.

## Mu'in's voice

Between tasks the game plays short recorded Omani-Arabic lines from Mu'in (`ANuhoudVoice`): a
welcome, each task's instruction (always in the first round, then now and then), praise, a word
of encouragement when a task takes long, the daily goal, a pain stop and the session end. The
lines are WAV files in `Content/Nuhoud/Voice/<event>_<n>.wav`, generated once from
`tools/voice/lines.json`; nothing is generated while playing, so the voice costs nothing per session.

```
pip install edge-tts
python tools/voice/make_voice.py            # ar-OM-AbdullahNeural; --voice ar-OM-AyshaNeural for a female voice
```

The WAV files are not in git (like the rest of `Content/`). Without them the game is silent.
`-NuhoudNoVoice` turns the voice off.

## Sessions

A finished session (Esc, pain stop, or closing the game) is written to `Saved/LocalSessions/` and then
sent to `POST /api/v2/sessions` with the patient's JWT. The file is deleted only after the server
stores it; otherwise it is retried (10 s, 30 s, then every 60 s) and sent at the next sign-in of the
same patient. `clientSessionId` makes a re-sent session return the stored row instead of a duplicate,
and `sessionDate` keeps the time the session was played.
