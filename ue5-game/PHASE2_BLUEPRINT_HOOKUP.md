# Nuhoud UE5 — Phase 2 Blueprint Hookup Guide

## Overview

This guide explains exactly how to link the C++ delegates and components
from Phase 2 to Blueprint assets (Niagara, SoundCues, UMG Widgets, Post-Process
materials) inside the Unreal Engine 5 Editor.

---

## 1. Audio System (NuhoudAudioManager)

### Step 1: Create the Blueprint
1. In the Content Browser, right-click → **Blueprint Class** → search `NuhoudAudioManager`.
2. Name it `BP_NuhoudAudioManager`.
3. Open it → **Class Defaults** panel.

### Step 2: Assign sound assets
In the Defaults panel, assign these (create/import the sounds first):
```
Success Hit Sound      → a soft chime WAV (e.g., 880Hz sine, 0.3s, fade-out)
Compensation Error Sound → a mild buzz WAV (e.g., 220Hz sawtooth, 0.2s, low volume)
Level Up Sound         → ascending chime sequence (C5 → E5 → G5, 0.5s)
Session Complete Sound → a pleasant 2-note completion melody
Ambient Music          → a SoundCue with Looping enabled (calm ambient pad)
```

### Step 3: Spawn the AudioManager from the GameMode
In `BP_NuhoudGameMode`:
1. Open the Blueprint → **Event Graph**.
2. In `StartSession()`:
   ```
   → Spawn Actor from Class (BP_NuhoudAudioManager)
   → Store the reference in a variable "AudioManager"
   → Call AudioManager → StartAmbientMusic()
   ```
3. In `EndSession()`:
   ```
   → AudioManager → StopAmbientMusic()
   → AudioManager → PlaySessionComplete()
   ```

### Step 4: Wire the delegates
In the Event Graph, bind these GameMode delegates:

**OnRepScored (for hit sounds):**
```
Event OnRepScored (wasCorrect, newScore)
→ Branch (wasCorrect == true)
  → TRUE: AudioManager → PlaySuccessHit(GetPlayerPawnLocation)
  → FALSE: AudioManager → PlayCompensationError(GetPlayerPawnLocation)
```

**OnDifficultyChanged (for level-up audio + tempo):**
```
Event OnDifficultyChanged (newLevel)
→ AudioManager → PlayLevelUp()
→ AudioManager → SetAmbientTempo(newLevel as int32)
→ HUD → ShowLevelUpFlash()
```

---

## 2. HUD System (NuhoudHUD)

### Step 1: Create the UMG Widget Blueprint
1. Content Browser → right-click → **User Interface** → **Widget Blueprint**.
2. Parent class: search `NuhoudHUD`.
3. Name it `WBP_NuhoudHUD`.
4. Open the Designer tab.

### Step 2: Design the widget layout
```
┌─────────────────────────────────────────────┐
│                  Score: 420                   │   ← TextBlock "ScoreText"
├─────────────────────────────────────────────┤
│  Streak: 5 🔥     Level 3                    │   ← TextBlock "StreakText" + "LevelText"
│  ████████████░░░░░░░ (12/10 to next level)   │   ← ProgressBar "LevelProgressBar"
├─────────────────────────────────────────────┤
│  [ ⛔ إيقاف — Pain Stop ]                     │   ← Button "PainStopButton"
└─────────────────────────────────────────────┘
```

**Critical:** The widget names in the Designer must EXACTLY match the
C++ `BindWidget` property names:
- `ScoreText` (TextBlock)
- `StreakText` (TextBlock)
- `LevelText` (TextBlock)
- `LevelProgressBar` (ProgressBar)
- `PainStopButton` (Button)
- `CompensationOverlay` (Image — set to fill the screen, red color, initially hidden)
- `LevelUpFlash` (Image — set to fill the screen, gold gradient, initially hidden)

### Step 3: Add UMG animations (for the flash effects)
1. In the **Animations** panel (bottom of the Designer), click **+ New Animation**.
2. Name it `LevelUpFlash_Anim`:
   - Keyframe 0.0s: LevelUpFlash → Opacity = 1.0, Visibility = Visible
   - Keyframe 0.5s: LevelUpFlash → Opacity = 0.0
   - Keyframe 0.6s: LevelUpFlash → Visibility = Hidden
3. Name another `CompensationFlash_Anim`:
   - Keyframe 0.0s: CompensationOverlay → Opacity = 0.8
   - Keyframe 0.3s: CompensationOverlay → Opacity = 0.0
   - Keyframe 0.4s: CompensationOverlay → Visibility = Hidden

### Step 4: Override ShowLevelUpFlash in Blueprint
In `WBP_NuhoudHUD` → **Graph** → **Functions** → **Override** → `ShowLevelUpFlash`:
```
ShowLevelUpFlash()
→ Play Animation (LevelUpFlash_Anim)
```

### Step 5: Attach the HUD to the Pawn
In `BP_NuhoudVRPawn` (or `BP_NuhoudFlatPawn`):
1. Add a **Widget Component** (child of RootComponent).
2. Set the widget class to `WBP_NuhoudHUD`.
3. Position it 150cm in front of the camera at eye height.
4. Set **Space** = **World** (for VR) or **Screen** (for flat).

### Step 6: Update the HUD from the GameMode
In `BP_NuhoudGameMode` → **Tick**:
```
Every frame:
→ Get the HUD reference (from the Pawn's Widget Component)
→ HUD → UpdateAll(Score, Streak, LevelIndex, ConsecutiveCorrectReps, 10)
```

In `BP_NuhoudGameMode` → `OnRepScored`:
```
If compensation was detected:
→ HUD → ShowCompensationWarning(true)
→ (delay 0.5s) → HUD → ShowCompensationWarning(false)
```

---

## 3. Target Actor (NuhoudTargetActor)

### Step 1: Create the target Blueprint
1. Right-click → **Blueprint Class** → search `NuhoudTargetActor`.
2. Name it `BP_NuhoudTarget`.

### Step 2: Assign assets
In the Defaults panel:
```
Destroy VFX   → Niagara System "NS_TargetBurst" (glowing orb explosion)
Hit Sound     → a short "tick" sound (for multi-hit targets)
Destroy Sound → a satisfying "pop" sound (for target destruction)
Max Health    → 1 (for Level 1-2), 2 (for Level 3-4), 3 (for Level 5)
```

### Step 3: Create the glow material
1. Content Browser → right-click → **Material** → name it `M_TargetGlow`.
2. Open the Material Editor.
3. Add nodes:
   ```
   Scalar Parameter "GlowIntensity" (default 0.3)
   → Multiply by 5.0
   → Connect to Emissive Color

   Vector Parameter "GlowColor" (default teal #14b8a6)
   → Multiply by Emissive
   → Connect to Base Color
   ```
4. Set **Blend Mode** = **Opaque**, **Shading Model** = **Unlit** (for pure glow).
5. Set **Material Domain** = **Surface**, **Blendable** = **True**.

### Step 4: Assign the glow material
In `BP_NuhoudTarget` → **Defaults** → assign `M_TargetGlow` to the TargetMesh material slot.

### Step 5: Wire the glow update
In `BP_NuhoudGameMode` → **Tick** (or in the Pawn's Tick):
```
For each active target:
→ Target → UpdateGlowFromAngle(CurrentElbowAngle, Target.RequiredAngle)
```

---

## 4. Post-Process Materials (Compensation + Level-Up Flashes)

### Step 1: Create the compensation red-edge material
1. Content Browser → right-click → **Material** → name it `PP_Compensation`.
2. Set **Material Domain** = **Post Process**.
3. Open the Material Editor:
   ```
   SceneTexture:PostProcessInput0
   → Lerp with a red color (1, 0.1, 0.1) based on a radial mask
   → Radial mask: distance from center → if > 0.8, blend to red
   → Multiply intensity by Scalar Parameter "FlashIntensity" (0-1)
   ```
4. In the game, create a **Post Process Volume** that covers the play area.
5. Add `PP_Compensation` to the volume's **Weighted Blendables** array.
6. Set its weight to 0.0 initially.
7. On compensation detection:
   ```
   → Set the material parameter "FlashIntensity" to 1.0
   → (Timeline 0.5s) → fade to 0.0
   ```

### Step 2: Create the level-up golden flash material
1. Create another Post Process material `PP_LevelUp`.
2. Material graph:
   ```
   SceneTexture:PostProcessInput0
   → Lerp with a golden tint (1.0, 0.85, 0.3) 
   → Intensity controlled by Scalar Parameter "FlashIntensity"
   → Add a subtle bloom effect
   ```
3. Add to the same Post Process Volume's **Weighted Blendables**.
4. On level-up:
   ```
   → Set "FlashIntensity" to 1.0
   → (Timeline 1.0s) → fade to 0.0
   → Also trigger HUD → ShowLevelUpFlash()
   → Also trigger AudioManager → PlayLevelUp()
   ```

---

## 5. Niagara Particle System (Target Burst)

### Step 1: Create the Niagara system
1. Content Browser → right-click → **FX** → **Niagara System** → **Empty**.
2. Name it `NS_TargetBurst`.
3. Open the Niagara editor.
4. Add emitters:
   ```
   Emitter 1: "Glowing Orbs"
   - Shape: Sphere
   - Spawn Rate: 200 (burst mode, 0.5s duration)
   - Lifetime: 1.0-2.0s
   - Color: Teal (#14b8a6) → fade to transparent
   - Size: 5cm → 0cm (shrink as they fade)
   - Velocity: Random 100-300 cm/s outward
   
   Emitter 2: "Shockwave Ring"
   - Shape: Ring
   - Spawn: 1 particle
   - Lifetime: 0.3s
   - Size: 0 → 100cm (expand outward)
   - Color: White → transparent
   ```

### Step 2: Assign to the target Blueprint
In `BP_NuhoudTarget` → **Defaults** → `DestroyVFX` → assign `NS_TargetBurst`.

---

## 6. Spline-Based Target Movement

### Step 1: Create a Spline Actor
1. Right-click → **Blueprint Class** → **Actor** → name it `BP_TargetPath`.
2. Add a **Spline Component**.
3. Place it in the level and shape the spline curve (e.g., a figure-8 or wave).

### Step 2: Assign the spline to targets
In `BP_NuhoudGameMode` → `SpawnTarget()`:
```
→ Get a reference to BP_TargetPath in the level
→ Spawn BP_NuhoudTarget at the spline start
→ Target → SetSplinePath(BP_TargetPath.SplineComponent)
```

The target will now follow the spline curve smoothly instead of linear bouncing.

---

## Summary: Complete Delegate Wiring Map

```
GameMode Delegate          → Target System           → Blueprint Action
────────────────────────────────────────────────────────────────────────
OnRepScored (correct)       → AudioManager            → PlaySuccessHit(Location)
OnRepScored (compensated)   → AudioManager            → PlayCompensationError(Location)
                           → HUD                     → ShowCompensationWarning(true)
                           → Post-Process PP_Compensation → FlashIntensity = 1.0
OnDifficultyChanged (up)    → AudioManager            → PlayLevelUp()
                           → AudioManager            → SetAmbientTempo(newLevel)
                           → HUD                     → ShowLevelUpFlash()
                           → Post-Process PP_LevelUp → FlashIntensity = 1.0
OnTargetDestroyed          → (no extra wiring — the   → Niagara burst plays automatically
                             target's TakeDamage      → via PlayDestroyVFX()
                             handles VFX + sound)
OnSessionStateChanged(Ended)→ AudioManager            → StopAmbientMusic()
                           → AudioManager            → PlaySessionComplete()
Tick (every frame)         → HUD                     → UpdateAll(Score, Streak, Level, Reps)
                           → Active targets          → UpdateGlowFromAngle(Angle, TargetAngle)
```

All C++ classes expose `BlueprintCallable` / `BlueprintAssignable` / `BlueprintReadWrite`
properties so the Blueprint can access everything without modifying C++.
