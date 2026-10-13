# Nuhoud UE5 — Deployment Guide

## Project Structure

```
Nuhoud/
├── Source/Nuhoud/
│   ├── Nuhoud.Build.cs           # Module config (WebSocket, HTTP, JSON, OpenXR)
│   ├── Public/
│   │   ├── NuhoudGameMode.h       # Session lifecycle + dynamic difficulty
│   │   ├── NuhoudPlayerController.h  # WebSocket client + JSON parser
│   │   ├── NuhoudPawns.h          # VR Pawn + Flat Pawn (elbow_angle → hand/cursor)
│   │   └── NuhoudTargetActor.h   # Interactive 3D target (glowing orb)
│   └── Private/
│       ├── NuhoudGameMode.cpp
│       ├── NuhoudPlayerController.cpp
│       ├── NuhoudPawns.cpp
│       └── NuhoudTargetActor.cpp
```

## 1. Setup in UE5 Editor

1. Create a new **C++ Blank Project** named `Nuhoud`.
2. Copy the `Source/Nuhoud/` folder from this directory into the project.
3. Enable plugins:
   - **WebSocket** (Built-in → Enabled by default)
   - **OpenXR** (for VR mode)
   - **Pixel Streaming** (optional, for web deployment)
4. Close the editor, right-click the `.uproject` file → **Generate Visual Studio project files**.
5. Open the `.sln` file and **Build** (Development Editor).
6. Reopen the UE5 editor — the Nuhoud classes will appear in the Content Browser under C++ Classes.

## 2. Blueprint Setup

### GameMode Blueprint
1. Create a Blueprint child of `NuhoudGameMode` (right-click → Blueprint Class → search `NuhoudGameMode`).
2. Set `WebSocketURL` = `ws://localhost:8001/ws/track`
3. Set `BackendURL` = `http://localhost:3000/api/v2/sessions`
4. Set `PatientId`, `PlanId`, `TargetAngle`, `Limb` from game config or login.
5. In the Level Settings → GameMode Override → select this Blueprint.

### Pawn Setup
1. For VR: Create a Blueprint child of `NuhoudVRPawn`.
   - Set `MaxReach` (e.g., 100cm)
   - Set `ShoulderOffset` to match the player's seated position
   - Add a skeletal mesh for the arm (optional — for IK animation)
2. For Flat: Create a Blueprint child of `NuhoudFlatPawn`.
   - Set `MinY` / `MaxY` to control the cursor's vertical range
   - Add an emissive material to the CursorMesh for the "glowing orb" look

### Target Actor
1. Create a Blueprint child of `NuhoudTargetActor`.
2. Add a glowing material (emissive = teal or amber).
3. In the `OnHit` event, add:
   - Particle effect (explosion/burst)
   - Audio (success sound)
   - Scale-down animation (Timeline → SetActorScale3D → Destroy)

## 3. Android APK Deployment

### Project Settings → Android
1. **Rendering:** Set to **Mobile Forward Renderer** (ES3.1)
   - Project Settings → Engine → Rendering → Mobile → Forward Shading = true
   - Project Settings → Engine → Rendering → Max Texture Size = 2048
2. **Orientation:** Landscape (mandatory for UE5 mobile)
3. **Minimum SDK:** Android 8.0 (API 26) — required for OpenXR on Quest
4. **Target SDK:** Android 12 (API 31)

### Build Steps
```bash
# In the UE5 editor:
# 1. File → Package Project → Android → Android (ASTC)
# 2. Choose an output directory
# 3. Wait for the build to complete
# 4. The .apk will be in the output directory

# Command line alternative:
# <UE5_Path>/Engine/Build/BatchFiles/RunUAT.sh BuildAndroid -project=Nuhoud.uproject
```

### Quest / VR Notes
- For Meta Quest 2/3: enable **OpenXR** plugin, set **VR Plugin** to OpenXR
- Set `bIsVRMode` detection works automatically via `GEngine->XRSystem->IsActive()`
- Package as **Android (ASTC)** → install via ADB: `adb install Nuhoud-arm64.apk`

## 4. Pixel Streaming (Web Deployment)

Pixel Streaming runs the game on a server GPU and streams the video to a browser via WebRTC. Patients don't need to install anything — they open a URL.

### Setup
1. Enable the **Pixel Streaming** plugin in the .uproject file:
   ```json
   "Plugins": [
     { "Name": "PixelStreaming", "Enabled": true }
   ]
   ```

2. Launch the game with Pixel Streaming enabled:
   ```bash
   # Start the SignalingServer (Node.js, included with UE5)
   cd Engine/Source/Programs/PixelStreaming/WebServers/SignalingWebServer
   platform_scripts/server/start.sh

   # Launch the game in Pixel Streaming mode
   ./Nuhoud.sh -AudioMixer -RenderOffScreen -PixelStreamingIP=127.0.0.1 -PixelStreamingPort=8888
   ```

3. The patient opens `http://<server-ip>/` in a browser → the game streams to them.

### Architecture
```
Patient's Browser ←──WebRTC──→ SignalingServer ←──→ Nuhoud Game (GPU Server)
     ↓                               ↑
  HTML5 + JS              ←──WebSocket──→ Python Pose Server (:8001)
```

## 5. Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                     UE5 Game (Nuhoud)                         │
│                                                              │
│  ┌─────────────────┐    WebSocket     ┌──────────────────┐   │
│  │ PlayerController │ ←─ws://:8001──→ │  Python Server    │   │
│  │  (JSON parser)   │                │  (MediaPipe Pose)  │   │
│  └───────┬─────────┘                └──────────────────┘   │
│          │ elbow_angle (0-180°)                             │
│  ┌───────▼─────────┐                                        │
│  │     Pawn         │  VR: hand IK  Flat: cursor Y          │
│  │  (VR or Flat)    │                                        │
│  └───────┬─────────┘                                        │
│          │ hand position                                     │
│  ┌───────▼─────────┐    spawns      ┌──────────────────┐   │
│  │    GameMode      │ ───────────→ │  Target Actor     │   │
│  │  (difficulty,    │              │  (glowing orb)    │   │
│  │   session log)   │ ←─hit────── └──────────────────┘   │
│  └───────┬─────────┘                                        │
│          │ POST /api/v2/sessions                            │
│  ┌───────▼─────────┐                                        │
│  │  HTTP Module     │ ────→ Nuhoud Backend (Next.js)       │
│  │  (JSON payload)  │        → AI Coach analyzes           │
│  └─────────────────┘        → Doctor dashboard              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 6. The Dynamic Difficulty Algorithm (Challenge Point Framework)

```
START → Level 1 (Easy: 60°, 15cm targets, 80cm distance)

LOOP each rep:
  IF clean rep (no compensation):
    ConsecutiveCorrectReps++
    ConsecutiveCompErrors = 0

  IF compensated rep:
    ConsecutiveCompErrors++
    ConsecutiveCorrectReps = 0

  IF ConsecutiveCorrectReps >= 10:
    Level UP → next level (harder)
    ConsecutiveCorrectReps = 0

  IF ConsecutiveCompErrors >= 3:
    Level DOWN → previous level (easier)
    ConsecutiveCompErrors = 0

Levels:
  1: 60° angle, 80cm, 15cm radius, static, 1 target
  2: 90° angle, 120cm, 12cm radius, static, 1 target
  3: 120° angle, 160cm, 10cm radius, 10cm/s, 2 targets
  4: 140° angle, 200cm, 8cm radius, 20cm/s, 2 targets
  5: 150° angle, 250cm, 6cm radius, 30cm/s, 3 targets
```
