// ============================================================================
// NuhoudGameMode.h
// ============================================================================
// Nuhoud — Medical Rehabilitation Game for Post-Stroke Patients
// GameMode: session lifecycle, dynamic difficulty, and session logging.
//
// Architecture:
//   - The GameMode owns the session state (reps, score, difficulty level).
//   - The PlayerController feeds it real-time elbow_angle data from the
//     Python WebSocket server.
//   - When a target is hit, the GameMode evaluates success/failure and
//     adjusts difficulty per the Challenge Point Framework.
//   - On session end, the GameMode compiles a JSON payload and POSTs it
//     to the Nuhoud backend (POST /api/v2/sessions) so the AI Agent on
//     the doctor's dashboard can analyze the patient's progress.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "NuhoudGameMode.generated.h"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Difficulty level — the Challenge Point Framework uses 5 levels.
 * Each level changes: target distance, target size, required elbow angle,
 * and target movement speed.
 */
UENUM(BlueprintType)
enum class ENuhoudDifficulty : uint8
{
    Level1_Easy       UMETA(DisplayName = "Level 1 — Easy"),
    Level2_Medium     UMETA(DisplayName = "Level 2 — Medium"),
    Level3_Hard       UMETA(DisplayName = "Level 3 — Hard"),
    Level4_Expert     UMETA(DisplayName = "Level 4 — Expert"),
    Level5_Master     UMETA(DisplayName = "Level 5 — Master"),
};

/**
 * Session state machine.
 */
UENUM(BlueprintType)
enum class ENuhoudSessionState : uint8
{
    Idle        UMETA(DisplayName = "Idle — waiting to start"),
    Tracking    UMETA(DisplayName = "Tracking — game in progress"),
    Paused      UMETA(DisplayName = "Paused"),
    Ended       UMETA(DisplayName = "Ended — sending session data"),
};

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * Real-time session log — maintained in memory during gameplay.
 * This is the data that gets POSTed to /api/v2/sessions on session end.
 */
USTRUCT(BlueprintType)
struct FNuhoudSessionLog
{
    GENERATED_BODY()

    /** Total reps attempted (including failed ones). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    int32 TotalReps = 0;

    /** Reps that hit the target WITHOUT compensation. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    int32 CorrectReps = 0;

    /** Maximum elbow angle achieved this session (degrees). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    float MaxAngle = 0.0f;

    /** Total compensation errors detected. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    int32 CompensationErrors = 0;

    /** Gamification score (10 per clean rep, 3 per compensated rep). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    int32 Score = 0;

    /** Highest difficulty level reached. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    ENuhoudDifficulty DynamicLevelReached = ENuhoudDifficulty::Level1_Easy;

    /** Session duration in seconds. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    float SessionDuration = 0.0f;

    /** Per-frame elbow angle samples for session replay (capped at 5000). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    TArray<float> AngleTimeline;

    /** Which limb was exercised. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    FString Limb = TEXT("right");

    /** Data source — "live" for real camera, "demo" for simulator. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Session")
    FString Source = TEXT("live");
};

/**
 * Difficulty parameters for the current level. The GameMode adjusts these
 * when the Challenge Point Framework decides to increase/decrease difficulty.
 */
USTRUCT(BlueprintType)
struct FNuhoudDifficultyParams
{
    GENERATED_BODY()

    /** Minimum elbow angle (degrees) required to hit a target. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    float RequiredAngle = 60.0f;

    /** Target spawn distance from the player (cm in UE5 units). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    float TargetDistance = 80.0f;

    /** Target radius (cm). Smaller = harder. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    float TargetRadius = 15.0f;

    /** Target movement speed (cm/s). 0 = static. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    float TargetMoveSpeed = 0.0f;

    /** Number of targets active simultaneously. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    int32 ConcurrentTargets = 1;

    /** Time limit per rep (seconds). 0 = no limit. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Difficulty")
    float TimePerRep = 0.0f;
};

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when the difficulty level changes. UI and spawners listen to this. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnDifficultyChanged, ENuhoudDifficulty, NewLevel);

/** Fired when the session state changes (e.g., Tracking → Ended). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSessionStateChanged, ENuhoudSessionState, NewState);

/** Fired when a rep is scored (for UI feedback, audio, particles). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnRepScored, bool, bWasCorrect, int32, NewScore);

/** Fired when the session log is ready to be sent to the backend. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSessionLogReady, const FNuhoudSessionLog&, Log);

// ---------------------------------------------------------------------------
// GameMode
// ---------------------------------------------------------------------------

/**
 * NuhoudGameMode — the brain of the rehabilitation game.
 *
 * Responsibilities:
 *   1. Session lifecycle (start → tracking → end).
 *   2. Dynamic difficulty adjustment (Challenge Point Framework).
 *   3. Session logging (accumulates reps, angles, errors, score).
 *   4. Session data transmission (POST /api/v2/sessions on end).
 *   5. Target spawning (delegates to a spawn manager).
 *
 * The GameMode does NOT handle WebSocket directly — that's the
 * PlayerController's job. The GameMode receives processed data
 * (elbow_angle, compensation, tracking_success) via method calls
 * from the PlayerController.
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ANuhoudGameMode();

    // -----------------------------------------------------------------------
    // Session Lifecycle
    // -----------------------------------------------------------------------

    /** Start a new rehabilitation session. Resets the session log. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Session")
    void StartSession();

    /** End the current session. Compiles the log and POSTs to the backend. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Session")
    void EndSession();

    /** Pause the session (e.g., patient needs rest). */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Session")
    void PauseSession();

    /** Resume a paused session. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Session")
    void ResumeSession();

    // -----------------------------------------------------------------------
    // Gameplay — called by the PlayerController each frame
    // -----------------------------------------------------------------------

    /**
     * Feed real-time tracking data from the Python WebSocket server.
     * Called every frame by the PlayerController when a new tracking
     * message arrives.
     *
     * @param ElbowAngle   Current elbow flexion angle (0-180 degrees).
     * @param bCompensation  True if shoulder compensation was detected.
     * @param bTrackingSuccess  True if MediaPipe found a person.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Gameplay")
    void ProcessTrackingData(float ElbowAngle, bool bCompensation, bool bTrackingSuccess);

    /**
     * Called by a target actor when the player hits it.
     * The GameMode evaluates whether the hit counts as a correct rep
     * (no compensation) or a compensated rep.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Gameplay")
    void OnTargetHit();

    /**
     * Called when the player misses a target (target despawns without hit).
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Gameplay")
    void OnTargetMissed();

    // -----------------------------------------------------------------------
    // Dynamic Difficulty — Challenge Point Framework
    // -----------------------------------------------------------------------

    /**
     * Evaluate whether the difficulty should change.
     * Called internally after each rep.
     *
     * Rules:
     *   - 10 consecutive correct reps (no compensation) → level up.
     *   - 3 consecutive compensation errors → level down.
     *   - Minimum level = 1, Maximum level = 5.
     */
    void EvaluateDifficultyChange();

    /** Get the current difficulty parameters (for spawners + UI). */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Difficulty")
    FNuhoudDifficultyParams GetCurrentDifficultyParams() const { return CurrentParams; }

    /** Get the current difficulty level. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Difficulty")
    ENuhoudDifficulty GetCurrentDifficulty() const { return CurrentDifficulty; }

    // -----------------------------------------------------------------------
    // Session Log + Backend Transmission
    // -----------------------------------------------------------------------

    /** Get the current session log (for UI display). */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Session")
    FNuhoudSessionLog GetSessionLog() const { return SessionLog; }

    /**
     * Compile the session log into a JSON payload and POST it to the
     * Nuhoud backend at POST /api/v2/sessions.
     *
     * Uses UE5's HTTP module (FHttpModule). The request is asynchronous;
     * the OnSessionLogReady delegate fires when the payload is compiled
     * (before the HTTP response comes back).
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Session")
    void SendSessionToBackend();

    // -----------------------------------------------------------------------
    // Delegates (for Blueprint / UI binding)
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnDifficultyChanged OnDifficultyChanged;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnSessionStateChanged OnSessionStateChanged;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnRepScored OnRepScored;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnSessionLogReady OnSessionLogReady;

    // -----------------------------------------------------------------------
    // Config (set in Blueprint defaults or via the level)
    // -----------------------------------------------------------------------

    /** The WebSocket URL of the Python pose-tracking server. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString WebSocketURL = TEXT("ws://localhost:8001/ws/track");

    /** The backend API URL for session submission. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString BackendURL = TEXT("http://localhost:3000/api/v2/sessions");

    /** The patient ID for this session (set at login or from game config). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString PatientId = TEXT("");

    /** The treatment plan ID (optional — if the patient has a plan). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString PlanId = TEXT("");

    /** The target angle for this session's exercise (from the treatment plan). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    float TargetAngle = 90.0f;

    /** Which limb is being exercised. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString Limb = TEXT("right");

    /** The JWT auth token (set after login). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString AuthToken = TEXT("");

protected:
    // -----------------------------------------------------------------------
    // Internal State
    // -----------------------------------------------------------------------

    /** Current session state. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|State")
    ENuhoudSessionState SessionState = ENuhoudSessionState::Idle;

    /** Current difficulty level. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|State")
    ENuhoudDifficulty CurrentDifficulty = ENuhoudDifficulty::Level1_Easy;

    /** Current difficulty parameters (derived from CurrentDifficulty). */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|State")
    FNuhoudDifficultyParams CurrentParams;

    /** In-memory session log. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|State")
    FNuhoudSessionLog SessionLog;

    /** Consecutive correct reps (resets on any error). Used for level-up. */
    int32 ConsecutiveCorrectReps = 0;

    /** Consecutive compensation errors (resets on any correct rep). Used for level-down. */
    int32 ConsecutiveCompErrors = 0;

    /** Session start time (in seconds, from FPlatformTime::Seconds()). */
    double SessionStartTime = 0.0;

    /** Session end time. */
    double SessionEndTime = 0.0;

    /** Whether the current tracking frame has compensation (latched for the current rep). */
    bool bCurrentRepHasCompensation = false;

    /** Whether tracking was successful in the last frame. */
    bool bLastTrackingSuccess = false;

    // -----------------------------------------------------------------------
    // Internal Helpers
    // -----------------------------------------------------------------------

    /** Set the session state and broadcast the change. */
    void SetSessionState(ENuhoudSessionState NewState);

    /** Update CurrentParams based on CurrentDifficulty. */
    void UpdateDifficultyParams();

    /** Spawn a new target at the appropriate distance/size for the current difficulty. */
    void SpawnTarget();

    /** Handle the HTTP response from the backend. */
    void OnSessionPostResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSuccess);

    /** Format the session log as a JSON string for the backend POST. */
    FString BuildSessionJsonPayload() const;
};
