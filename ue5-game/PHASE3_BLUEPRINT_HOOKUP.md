# Nuhoud UE5 — Phase 3 Blueprint Hookup & Configuration Guide

## Overview

Phase 3 adds: authentication, smart fatigue monitoring, ROM heatmap,
OpenXR hand tracking, and mobile/Pixel Streaming optimization.

---

## 1. Authentication (NuhoudGameInstance + NuhoudLoginScreen)

### Step 1: Set the GameInstance class
1. Project Settings → Maps & Modes → Game Instance → set to `NuhoudGameInstance`.
2. This persists the JWT token across level transitions and app restarts.

### Step 2: Create the Login Screen
1. Create a Widget Blueprint (WBP_NuhoudLogin, parent = `NuhoudLoginScreen`).
2. Add these widgets (names MUST match the BindWidget properties):
   ```
   EmailTextBox     → UEditableTextBox (placeholder: "you@nuhood.health")
   PasswordTextBox  → UEditableTextBox (is password = true)
   LoginButton      → UButton (text: "تسجيل الدخول / Sign in")
   ErrorText        → UTextBlock (initially hidden)
   LoadingSpinner   → UThrobber (initially hidden)
   ```
3. Design: a clean card with the Nuhoud logo at the top, centered.

### Step 3: Show the Login Screen at Game Start
In the Level Blueprint → **On BeginPlay**:
```
→ Create Widget (WBP_NuhoudLogin)
→ Add to Viewport
→ Bind OnLoginSuccess → Remove from Parent + Open Level "RehabLevel"
→ Bind OnLoginFailed → (error is shown automatically by the widget)
```

### Step 4: Attach the JWT to Session POST
In `BP_NuhoudGameMode` → `EndSession()`:
```
→ Get Game Instance → Cast to NuhoudGameInstance
→ Get Auth Token → set on the GameMode's AuthToken property
→ SendSessionToBackend() (already reads AuthToken for the Bearer header)
```

---

## 2. Smart Fatigue & Auto-Pause (NuhoudFatigueMonitor)

### Step 1: Add the FatigueMonitor to the GameMode
In `BP_NuhoudGameMode` → **BeginPlay**:
```
→ Construct Object from Class (NuhoudFatigueMonitor)
→ Store in a variable "FatigueMonitor"
→ FatigueMonitor → Reset()
```

### Step 2: Feed data each frame
In `BP_NuhoudGameMode` → **Tick**:
```
→ FatigueMonitor → ProcessFrame(CurrentElbowAngle, bTrackingSuccess)
→ FatigueMonitor → Tick(DeltaSeconds)
```

### Step 3: Feed rep events
In `BP_NuhoudGameMode` → **OnTargetHit** (after scoring):
```
→ FatigueMonitor → OnRepCompleted()
```

### Step 4: Bind the auto-pause delegate
```
Event OnSmartAutoPause (RestDurationSeconds)
→ PauseSession()
→ Show "Rest UI" widget (3D, floating in front of player)
→ Set text: "يبدو أنك متعب، خذ استراحة 30 ثانية / You seem tired, take a 30-second break."
→ (Timer 30s) → ResumeSession() + Hide "Rest UI"
```

### Step 5: Bind the fatigue state change delegate
```
Event OnFatigueStateChanged (NewState)
→ If NewState == Warning:
  → HUD → Show subtle amber border
→ If NewState == Normal:
  → HUD → Clear amber border
```

### Step 6: Pain Stop with is_aborted
In `BP_NuhoudHUD` → **OnPainStopClicked**:
```
→ Get GameMode → Set bIsAborted = true
→ Get GameMode → EndSession()
```
The GameMode's `BuildSessionJsonPayload()` adds `"is_aborted": true` when `bIsAborted` is set.

---

## 3. ROM Heatmap (NuhoudROMHeatmap)

### Step 1: Create the widget
1. Create WBP_ROMHeatmap (parent = `NuhoudROMHeatmap`).
2. Add:
   ```
   HeatmapCanvas → UCanvasPanel (anchors: fill, 300px wide × 150px tall)
   AvgAngleText  → UTextBlock (top-left: "Avg: 90°")
   TrendText     → UTextBlock (top-right: "↑ Improving")
   ```

### Step 2: Implement RefreshHeatmap in Blueprint
Override `RefreshHeatmap` (BlueprintImplementableEvent) in WBP_ROMHeatmap:
```
RefreshHeatmap()
→ Clear children from HeatmapCanvas
→ For each entry in RepEntries (loop 0..N-1):
  → Create a Border widget (the heatmap bar)
  → Height = (entry.MaxAngle / GlobalMaxAngle) * CanvasHeight
  → Width = CanvasWidth / 10
  → X = i * (CanvasWidth / 10)
  → Y = CanvasHeight - Height (bottom-aligned)
  → Color = entry.bClean ? Teal : Amber
  → Add to HeatmapCanvas as a child
```

### Step 3: Wire it to the GameMode
In `BP_NuhoudGameMode` → **OnTargetHit**:
```
→ ROMHeatmapWidget → AddRep(SessionLog.MaxAngle, !bCompensation)
```

### Step 4: Attach the widget to the VR Pawn
Add a WidgetComponent to BP_NuhoudVRPawn:
- Widget class: WBP_ROMHeatmap
- Position: 100cm in front, 30cm below eye level (so it doesn't block the HUD)
- Space: World (VR) or Screen (flat)

---

## 4. OpenXR Hand Tracking (NuhoudOpenXRHandTracking)

### Step 1: Add the component to the VR Pawn
1. Open `BP_NuhoudVRPawn`.
2. Add component: `NuhoudOpenXRHandTracking`.
3. In the Details panel:
   ```
   RightHandMesh         → the right hand SkeletalMeshComponent
   LeftHandMesh          → the left hand SkeletalMeshComponent
   RightMotionController → the right MotionControllerComponent
   LeftMotionController  → the left MotionControllerComponent
   MaxReach              → 100.0
   ShoulderOffset        → (0, 30, -20)
   bRightArmAffected     → true (or false for left-side patients)
   ```

### Step 2: Feed the elbow angle each frame
In `BP_NuhoudVRPawn` → **Tick**:
```
→ Get PlayerController → CurrentElbowAngle
→ OpenXRHandTracking → UpdateElbowAngle(CurrentElbowAngle)
```

### Step 3: Enable the OpenXR plugin
1. Edit → Plugins → search "OpenXR" → enable.
2. Project Settings → Engine → Input → Motion Controllers → enable OpenXR.
3. Set the hand tracking mesh: a simple skeletal mesh (or use the Meta Quest hand mesh).

### Step 4: Set up IK on the skeletal mesh
1. In the hand skeletal mesh's AnimBP:
   - Add a "Two Bone IK" node on the right arm.
   - Set the IK target to be driven by a named bone or a parameter.
   - The C++ component sets the hand position; the IK solver bends the elbow accordingly.

---

## 5. Mobile Optimization (Android CVars + Device Profiles)

### Step 1: Console Variables (DefaultEngine.ini)
Add these to `Config/DefaultEngine.ini`:

```ini
[SystemSettings]
; Mobile Forward Renderer (required for Android)
r.ForwardShading=1
r.MobileForwardShading=1

; Disable ray tracing (not supported on mobile)
r.RayTracing=False
r.RayTracing.EnableInEditor=False

; Shadow quality (low for mobile)
r.ShadowQuality=0
r.Shadow.CSM.MaxCascades=1
r.Shadow.MaxResolution=1024
r.Shadow.DistanceScale=0.5

; Texture streaming
r.Streaming.PoolSize=256
r.Streaming.LimitPoolSizeToVRAM=1
r.MaxTextureMipCount=10

; Anti-aliasing (FXAA for mobile — no MSAA to save bandwidth)
r.AntiAliasingMethod=1
r.PostProcessAAQuality=2

; Bloom (low quality)
r.BloomQuality=1

; Motion blur (disable for performance + accessibility)
r.MotionBlurQuality=0

; Niagara (mobile)
r.Niagara.GridMeshRendererEnabled=0

; LOD distances (lower = more aggressive culling)
r.SkeletalMeshLODBias=1
r.StaticMeshLODBias=1

; View distance
r.ViewDistanceScale=0.8
r.SkeletalMeshLODRadiusFactor=0.25

; VSync (disabled for lower latency)
r.VSync=0

; Pixel Streaming (if running on web)
r.PixelStreaming.WebRTC.MaxFps=60
r.PixelStreaming.WebRTC.StartBitrate=8000
r.PixelStreaming.WebRTC.MinBitrate=2000
r.PixelStreaming.WebRTC.MaxBitrate=20000
```

### Step 2: Device Profile (Android)
In `Config/DefaultDeviceProfiles.ini`:

```ini
[Android DeviceProfile]
+DeviceProfileTypeAndFlags=Android,Android_SM8350,0
+DeviceProfileTypeAndFlags=Android,Android_SM8550,0

[Android_Low DeviceProfile]
; For low-end devices (older phones)
+ConsoleVariables=r.ShadowQuality=0
+ConsoleVariables=r.PostProcessAAQuality=0
+ConsoleVariables=r.BloomQuality=0
+ConsoleVariables=r.Streaming.PoolSize=128
+ConsoleVariables=r.ViewDistanceScale=0.5

[Android_High DeviceProfile]
; For high-end devices (Snapdragon 8+, Quest 3)
+ConsoleVariables=r.ShadowQuality=1
+ConsoleVariables=r.PostProcessAAQuality=2
+ConsoleVariables=r.BloomQuality=1
+ConsoleVariables=r.Streaming.PoolSize=512
+ConsoleVariables=r.ViewDistanceScale=0.9
```

### Step 3: Project Settings → Android
```
Texture Format: ETC2 + ASTC (for Quest compatibility)
Minimum SDK: 26 (Android 8.0 — required for OpenXR)
Target SDK: 31 (Android 12)
Architecture: arm64-v8a (64-bit only)
Orientation: Landscape
Mobile HDR: false (use LDR for mobile — saves bandwidth)
Mobile MSAA: 0 (no MSAA — use FXAA instead)
```

### Step 4: Pixel Streaming URL Parameters
When running via Pixel Streaming, the browser URL can pass parameters:
```
http://hospital-server/?BackendURL=https://api.nuhoud.health/api/v2&WebSocketURL=ws://pose-server:8001/ws/track&PatientId=xyz123
```
The GameInstance reads these via `ReadPixelStreamingParams()` and overrides the defaults.

### Step 5: Pixel Streaming Quality CVars
For web streaming (server-side, in the launch command):
```bash
./Nuhoud.sh -RenderOffScreen -PixelStreamingIP=0.0.0.0 -PixelStreamingPort=8888 \
  -r.PixelStreaming.WebRTC.MaxFps=60 \
  -r.PixelStreaming.WebRTC.StartBitrate=10000 \
  -r.PixelStreaming.WebRTC.DisableAudio=0
```

---

## Summary: Phase 3 Delegate Wiring Map

```
System              Delegate/Event             → Blueprint Action
────────────────────────────────────────────────────────────────────────
LoginScreen         OnLoginSuccess             → Remove widget + Open RehabLevel
LoginScreen         OnLoginFailed              → Show error text
GameInstance        OnLoginStateChanged        → Update UI (login/logout state)
FatigueMonitor      OnSmartAutoPause(duration) → PauseSession + Show Rest UI + Timer 30s
FatigueMonitor      OnFatigueStateChanged      → HUD border color (amber/red/green)
GameMode            OnRepScored                → ROMHeatmap.AddRep(MaxAngle, bClean)
HUD PainStop        OnPainStopClicked           → GameMode.bIsAborted=true + EndSession
HandTracking        (Tick)                     → UpdateElbowAngle(CurrentElbowAngle)
GameMode EndSession  (HTTP POST)               → Read AuthToken from GameInstance → Bearer header
```

## File Summary (Phase 3)

| File | Lines | Purpose |
|---|---|---|
| NuhoudGameInstance.h | 161 | Persistent auth state, config, runtime mode |
| NuhoudGameInstance.cpp | 160 | Save/Load, runtime detection, Pixel Streaming params |
| NuhoudLoginScreen.h | 97 | UMG login widget (email, password, JWT capture) |
| NuhoudLoginScreen.cpp | 142 | HTTP POST /api/v2/auth/login, JSON parse, token storage |
| NuhoudFatigueMonitor.h | 152 | Smart fatigue + auto-pause system |
| NuhoudFatigueMonitor.cpp | 175 | Reaction time + angle drop tracking, auto-pause logic |
| NuhoudROMHeatmap.h | 91 | Real-time ROM visualization widget |
| NuhoudROMHeatmap.cpp | 110 | Rep tracking, average + trend calculation |
| NuhoudOpenXRHandTracking.h | 110 | OpenXR hand tracking + IK mapping |
| NuhoudOpenXRHandTracking.cpp | 175 | FK/OpenXR/controller mode switching, controller disable |
| PHASE3_BLUEPRINT_HOOKUP.md | ~250 | This guide |
```
