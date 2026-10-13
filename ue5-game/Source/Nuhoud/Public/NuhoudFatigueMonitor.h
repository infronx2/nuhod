// ============================================================================
// NuhoudFatigueMonitor.h
// ============================================================================
// Smart Fatigue & Auto-Pause System — clinical safety monitor.
//
// Tracks two metrics:
//   1. Reaction Time: time between consecutive reps. If it slows by >30%
//      compared to the baseline (average of the first 5 reps), fatigue
//      is likely.
//   2. Angle Drop: if the max elbow angle drops below 70% of the patient's
//      baseline max for a sustained period (15 seconds), the patient is
//      losing strength.
//
// When fatigue is detected:
//   - The GameMode triggers a Smart Auto-Pause.
//   - A 3D UI message appears: "You seem tired, take a 30-second break."
//   - After 30 seconds, the game auto-resumes (or the patient can resume
//     manually via a button).
//
// If the patient presses "Pain Stop":
//   - The session is immediately aborted.
//   - is_aborted = true is added to the session JSON payload.
//   - The session data is sent to the backend immediately.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "NuhoudFatigueMonitor.generated.h"

// Forward declarations
class ANuhoudGameMode;

// ---------------------------------------------------------------------------
// Fatigue State
// ---------------------------------------------------------------------------

UENUM(BlueprintType)
enum class ENuhoudFatigueState : uint8
{
    Normal      UMETA(DisplayName = "Normal — patient is performing well"),
    Warning     UMETA(DisplayName = "Warning — reaction time slowing"),
    Fatigued    UMETA(DisplayName = "Fatigued — auto-pause triggered"),
    Recovering  UMETA(DisplayName = "Recovering — 30s break in progress"),
};

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when the fatigue state changes. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FOnFatigueStateChanged,
    ENuhoudFatigueState, NewState
);

/** Fired when a smart auto-pause is triggered (show the rest UI). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FOnSmartAutoPause,
    float, RestDurationSeconds
);

// ---------------------------------------------------------------------------
// Fatigue Monitor
// ---------------------------------------------------------------------------

/**
 * NuhoudFatigueMonitor — a UActorComponent-style helper that the GameMode
 * owns. It receives tracking data each frame and rep events, and fires
 * delegates when fatigue is detected.
 *
 * The monitor is intentionally conservative — it only triggers a pause
 * when BOTH metrics indicate fatigue (not just one), to avoid false
 * positives.
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API UNuhoudFatigueMonitor : public UObject
{
    GENERATED_BODY()

public:
    UNuhoudFatigueMonitor();

    // -----------------------------------------------------------------------
    // Data Input — called by the GameMode
    // -----------------------------------------------------------------------

    /**
     * Called every frame with the latest tracking data.
     * @param ElbowAngle  Current elbow angle (0-180°).
     * @param bTrackingSuccess  Whether tracking is active.
     */
    void ProcessFrame(float ElbowAngle, bool bTrackingSuccess);

    /**
     * Called when a rep is completed (hit or miss).
     * Records the timestamp for reaction-time calculation.
     */
    void OnRepCompleted();

    /** Reset the monitor for a new session. */
    void Reset();

    /** Tick — called by the GameMode's Tick. */
    void Tick(float DeltaSeconds);

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /** Reaction-time slowdown threshold (30% = 0.3). If the current avg
     *  reaction time exceeds baseline * (1 + this), fatigue is likely. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Fatigue|Config")
    float ReactionTimeSlowdownThreshold = 0.3f;

    /** Angle drop threshold (70% = 0.7). If the current max angle drops
     *  below baseline max * this, fatigue is likely. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Fatigue|Config")
    float AngleDropThreshold = 0.7f;

    /** Sustained angle drop duration (seconds). The angle must stay below
     *  the threshold for this long before triggering fatigue. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Fatigue|Config")
    float SustainedDropDuration = 15.0f;

    /** Rest duration when auto-pause is triggered (seconds). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Fatigue|Config")
    float RestDuration = 30.0f;

    /** Number of reps to establish the baseline (first N reps). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Fatigue|Config")
    int32 BaselineRepCount = 5;

    // -----------------------------------------------------------------------
    // Delegates
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Fatigue|Events")
    FOnFatigueStateChanged OnFatigueStateChanged;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Fatigue|Events")
    FOnSmartAutoPause OnSmartAutoPause;

    // -----------------------------------------------------------------------
    // State (read-only for Blueprint)
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    ENuhoudFatigueState CurrentState = ENuhoudFatigueState::Normal;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float BaselineReactionTime = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float CurrentReactionTime = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float BaselineMaxAngle = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float CurrentMaxAngle = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float SustainedDropTimer = 0.0f;

    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Fatigue|State")
    float RestTimer = 0.0f;

private:
    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** Timestamps of the last N reps (for reaction-time calculation). */
    TArray<double> RepTimestamps;

    /** Max angle observed in the last 10 seconds (rolling window). */
    TArray<TPair<double, float>> AngleHistory;

    /** Is the baseline established? */
    bool bBaselineEstablished = false;

    /** Is reaction time slowed? */
    bool bReactionTimeSlowed = false;

    /** Is angle dropped? */
    bool bAngleDropped = false;

    /** Last frame's tracking success (to handle gaps). */
    bool bLastTrackingSuccess = false;

    /** Time of the last frame. */
    double LastFrameTime = 0.0;

    /** Set the fatigue state and broadcast. */
    void SetState(ENuhoudFatigueState NewState);

    /** Evaluate fatigue conditions. Called from Tick. */
    void EvaluateFatigue();

    /** Compute the average reaction time from recent reps. */
    float ComputeAverageReactionTime() const;

    /** Compute the max angle in the last N seconds. */
    float ComputeRecentMaxAngle(double WindowSeconds = 10.0) const;

    /** Establish the baseline from the first N reps. */
    void TryEstablishBaseline();
};
