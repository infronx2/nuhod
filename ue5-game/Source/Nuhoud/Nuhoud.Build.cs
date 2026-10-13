// ============================================================================
// Nuhoud.Build.cs
// ============================================================================
// Module configuration for the Nuhoud game module.
// This tells UE5 which modules to link and which classes to compile.
// ============================================================================

using UnrealBuildTool;

public class Nuhoud : ModuleRules
{
    public Nuhoud(ReadOnlyTargetRules Target) : base(Target)
    {
        // ── Engine modules ──────────────────────────────────────────────
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "GameFramework",
            "NavigationSystem",
            // Phase 2 additions:
            "UMG",            // Required for UWidget-based HUD
            "Slate",          // Required for UMG rendering
            "SlateCore",      // Required for UMG rendering
            "Niagara",        // Required for particle VFX on target destruction
            "Audio",          // Required for spatial audio playback
            "Spline",         // Required for spline-based target movement
            "MovieScene",     // Required for UMG animations (level-up flash)
            "TimeManagement", // Required for Timeline/UMG animation playback
        });

        // ── WebSocket module (built-in) ─────────────────────────────────
        // Required for the PlayerController's WebSocket connection to the
        // Python pose-tracking server.
        PublicDependencyModuleNames.Add("WebSockets");

        // ── HTTP module (built-in) ──────────────────────────────────────
        // Required for the GameMode to POST session data to /api/v2/sessions.
        PublicDependencyModuleNames.Add("HTTP");

        // ── JSON module (built-in) ──────────────────────────────────────
        // Required for parsing WebSocket messages and building HTTP payloads.
        PublicDependencyModuleNames.Add("Json");
        PublicDependencyModuleNames.Add("JsonUtilities");

        // ── VR / OpenXR module ──────────────────────────────────────────
        // Required for VR mode (stereo rendering, headset tracking, motion
        // controllers). Only link if building with the OpenXR plugin enabled.
        PublicDependencyModuleNames.Add("HeadMountedDisplay");

        // ── Mobile / Android deployment ─────────────────────────────────
        // When packaging for Android, add these:
        if (Target.Platform == UnrealTargetPlatform.Android)
        {
            // The Mobile Forward Renderer is the default for Android.
            // No extra module needed — just set the renderer in Project Settings.
            // But we add the AndroidVR module for Gear VR / Oculus Quest support:
            // PublicDependencyModuleNames.Add("AndroidVR");
        }

        // ── Pixel Streaming (optional) ──────────────────────────────────
        // If you want to stream the game to a web browser, enable the
        // Pixel Streaming plugin in the .uproject file and add:
        // PublicDependencyModuleNames.Add("PixelStreaming");

        // ── Optimization ───────────────────────────────────────────────
        bUseRTTI = false;
        bUseExceptions = false;

        // ── Whitelist ───────────────────────────────────────────────────
        // Ensure all .cpp/.h files in the module are compiled.
        PrivatePCHHeaderFile = "Public/NuhoudGameMode.h";
    }
}
