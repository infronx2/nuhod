// ============================================================================
// NuhoudGameMode.cpp
// ============================================================================
// Implementation of the Nuhoud rehabilitation GameMode.
//
// The Challenge Point Framework (dynamic difficulty):
//   - The patient starts at Level 1 (Easy).
//   - After 10 consecutive correct reps (no compensation), difficulty
//     increases by one level (targets shrink, move further, require higher
//     elbow angle, or move).
//   - After 3 consecutive compensation errors, difficulty decreases by
//     one level (easier targets, preventing frustration).
//   - The framework keeps the patient in the "zone of proximal development"
//     — challenging enough to improve, easy enough to avoid disengagement.
// ============================================================================

#include "NuhoudGameMode.h"
#include "NuhoudPlayerController.h"
#include "NuhoudTargetActor.h"

// HTTP + JSON modules
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

// Logging
DEFINE_LOG_CATEGORY_STATIC(LogNuhoudGM, Log, All);
#define LOG_NUHOUD(Severity, Format, ...) UE_LOG(LogNuhoudGM, Severity, TEXT(Format), ##__VA_ARGS__)

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

ANuhoudGameMode::ANuhoudGameMode()
{
    // Set the default player controller class.
    PlayerControllerClass = ANuhoudPlayerController::StaticClass();

    // Initialize difficulty params for Level 1.
    UpdateDifficultyParams();
}

// ---------------------------------------------------------------------------
// Session Lifecycle
// ---------------------------------------------------------------------------

void ANuhoudGameMode::StartSession()
{
    // Reset the session log.
    SessionLog = FNuhoudSessionLog();
    SessionLog.Limb = Limb;
    SessionLog.Source = TEXT("live");
    SessionLog.DynamicLevelReached = CurrentDifficulty;

    // Reset counters.
    ConsecutiveCorrectReps = 0;
    ConsecutiveCompErrors = 0;
    bCurrentRepHasCompensation = false;
    bLastTrackingSuccess = false;

    // Record start time.
    SessionStartTime = FPlatformTime::Seconds();

    // Set state.
    SetSessionState(ENuhoudSessionState::Tracking);

    // Spawn the first target.
    SpawnTarget();

    LOG_NUHOUD(Log, TEXT("Session started — Target angle: %.1f°, Limb: %s"), TargetAngle, *Limb);
}

void ANuhoudGameMode::EndSession()
{
    SessionEndTime = FPlatformTime::Seconds();
    SessionLog.SessionDuration = static_cast<float>(SessionEndTime - SessionStartTime);

    SetSessionState(ENuhoudSessionState::Ended);

    // Broadcast the log for UI display.
    OnSessionLogReady.Broadcast(SessionLog);

    // Send to the backend.
    SendSessionToBackend();

    LOG_NUHOUD(Log, TEXT("Session ended — Reps: %d, Correct: %d, Score: %d, Duration: %.1fs"),
        SessionLog.TotalReps, SessionLog.CorrectReps, SessionLog.Score, SessionLog.SessionDuration);
}

void ANuhoudGameMode::PauseSession()
{
    if (SessionState == ENuhoudSessionState::Tracking)
    {
        SetSessionState(ENuhoudSessionState::Paused);
        LOG_NUHOUD(Log, TEXT("Session paused"));
    }
}

void ANuhoudGameMode::ResumeSession()
{
    if (SessionState == ENuhoudSessionState::Paused)
    {
        SetSessionState(ENuhoudSessionState::Tracking);
        LOG_NUHOUD(Log, TEXT("Session resumed"));
    }
}

// ---------------------------------------------------------------------------
// Gameplay — ProcessTrackingData (called by PlayerController each frame)
// ---------------------------------------------------------------------------

void ANuhoudGameMode::ProcessTrackingData(float ElbowAngle, bool bCompensation, bool bTrackingSuccess)
{
    if (SessionState != ENuhoudSessionState::Tracking)
        return;

    bLastTrackingSuccess = bTrackingSuccess;

    if (!bTrackingSuccess)
    {
        // No person detected — don't count this frame.
        return;
    }

    // Track max angle.
    if (ElbowAngle > SessionLog.MaxAngle)
    {
        SessionLog.MaxAngle = ElbowAngle;
    }

    // Record angle timeline (cap at 5000 samples for memory).
    if (SessionLog.AngleTimeline.Num() < 5000)
    {
        SessionLog.AngleTimeline.Add(ElbowAngle);
    }

    // Latch the compensation flag for the current rep.
    if (bCompensation)
    {
        bCurrentRepHasCompensation = true;
    }
}

// ---------------------------------------------------------------------------
// Gameplay — Target Hit / Miss
// ---------------------------------------------------------------------------

void ANuhoudGameMode::OnTargetHit()
{
    if (SessionState != ENuhoudSessionState::Tracking)
        return;

    SessionLog.TotalReps++;

    if (bCurrentRepHasCompensation)
    {
        // Compensated rep — counts as a rep but with lower score.
        SessionLog.CompensationErrors++;
        SessionLog.Score += 3;
        ConsecutiveCompErrors++;
        ConsecutiveCorrectReps = 0;

        LOG_NUHOUD(Warning, TEXT("Rep #%d — COMPENSATED (score +3, total %d)"),
            SessionLog.TotalReps, SessionLog.Score);
    }
    else
    {
        // Clean rep — full score.
        SessionLog.CorrectReps++;
        SessionLog.Score += 10;
        ConsecutiveCorrectReps++;
        ConsecutiveCompErrors = 0;

        LOG_NUHOUD(Log, TEXT("Rep #%d — CLEAN (score +10, total %d, streak %d)"),
            SessionLog.TotalReps, SessionLog.Score, ConsecutiveCorrectReps);
    }

    // Broadcast for UI + audio feedback.
    OnRepScored.Broadcast(!bCurrentRepHasCompensation, SessionLog.Score);

    // Reset the compensation latch for the next rep.
    bCurrentRepHasCompensation = false;

    // Evaluate difficulty change.
    EvaluateDifficultyChange();

    // Spawn the next target.
    SpawnTarget();
}

void ANuhoudGameMode::OnTargetMissed()
{
    if (SessionState != ENuhoudSessionState::Tracking)
        return;

    // A missed target counts as a failed rep.
    SessionLog.TotalReps++;
    ConsecutiveCorrectReps = 0;
    ConsecutiveCompErrors++;

    LOG_NUHOUD(Warning, TEXT("Target MISSED (consecutive errors: %d)"), ConsecutiveCompErrors);

    // Evaluate if we need to decrease difficulty.
    EvaluateDifficultyChange();

    // Spawn a new (easier) target.
    SpawnTarget();
}

// ---------------------------------------------------------------------------
// Dynamic Difficulty — Challenge Point Framework
// ---------------------------------------------------------------------------

void ANuhoudGameMode::EvaluateDifficultyChange()
{
    ENuhoudDifficulty OldLevel = CurrentDifficulty;

    // Level UP: 10 consecutive correct reps without compensation.
    if (ConsecutiveCorrectReps >= 10)
    {
        if (CurrentDifficulty < ENuhoudDifficulty::Level5_Master)
        {
            // Advance to the next level.
            CurrentDifficulty = static_cast<ENuhoudDifficulty>(
                static_cast<uint8>(CurrentDifficulty) + 1
            );
            ConsecutiveCorrectReps = 0; // Reset the streak.
            UpdateDifficultyParams();

            LOG_NUHOUD(Log, TEXT("🔥 DIFFICULTY UP → Level %d"), static_cast<int32>(CurrentDifficulty) + 1);

            OnDifficultyChanged.Broadcast(CurrentDifficulty);
        }
    }

    // Level DOWN: 3 consecutive compensation errors.
    if (ConsecutiveCompErrors >= 3)
    {
        if (CurrentDifficulty > ENuhoudDifficulty::Level1_Easy)
        {
            CurrentDifficulty = static_cast<ENuhoudDifficulty>(
                static_cast<uint8>(CurrentDifficulty) - 1
            );
            ConsecutiveCompErrors = 0;
            UpdateDifficultyParams();

            LOG_NUHOUD(Log, TEXT("⚠️ DIFFICULTY DOWN → Level %d"), static_cast<int32>(CurrentDifficulty) + 1);

            OnDifficultyChanged.Broadcast(CurrentDifficulty);
        }
    }

    // Track the highest level reached for the session log.
    if (CurrentDifficulty > SessionLog.DynamicLevelReached)
    {
        SessionLog.DynamicLevelReached = CurrentDifficulty;
    }
}

void ANuhoudGameMode::UpdateDifficultyParams()
{
    // The Challenge Point Framework parameters per level:
    //
    // Level 1 (Easy):    angle 60°, distance 80cm,  radius 15cm, speed 0, 1 target
    // Level 2 (Medium):  angle 90°, distance 120cm, radius 12cm, speed 0, 1 target
    // Level 3 (Hard):    angle 120°, distance 160cm, radius 10cm, speed 10cm/s, 2 targets
    // Level 4 (Expert):  angle 140°, distance 200cm, radius 8cm,  speed 20cm/s, 2 targets
    // Level 5 (Master):  angle 150°, distance 250cm, radius 6cm,  speed 30cm/s, 3 targets

    switch (CurrentDifficulty)
    {
    case ENuhoudDifficulty::Level1_Easy:
        CurrentParams = { 60.0f, 80.0f, 15.0f, 0.0f, 1, 0.0f };
        break;
    case ENuhoudDifficulty::Level2_Medium:
        CurrentParams = { 90.0f, 120.0f, 12.0f, 0.0f, 1, 0.0f };
        break;
    case ENuhoudDifficulty::Level3_Hard:
        CurrentParams = { 120.0f, 160.0f, 10.0f, 10.0f, 2, 8.0f };
        break;
    case ENuhoudDifficulty::Level4_Expert:
        CurrentParams = { 140.0f, 200.0f, 8.0f, 20.0f, 2, 6.0f };
        break;
    case ENuhoudDifficulty::Level5_Master:
        CurrentParams = { 150.0f, 250.0f, 6.0f, 30.0f, 3, 5.0f };
        break;
    default:
        CurrentParams = { 60.0f, 80.0f, 15.0f, 0.0f, 1, 0.0f };
        break;
    }
}

// ---------------------------------------------------------------------------
// Target Spawning
// ---------------------------------------------------------------------------

void ANuhoudGameMode::SpawnTarget()
{
    // In a full implementation, this would:
    // 1. Get the player's pawn location.
    // 2. Spawn an ANuhoudTargetActor at a random position at the current
    //    difficulty's distance, with the current radius.
    // 3. If TargetMoveSpeed > 0, set the target to move randomly.
    // 4. If ConcurrentTargets > 1, spawn multiple targets.
    //
    // For Phase 1, we provide the interface — the Blueprint or C++ spawn
    // manager fills in the actual spawning logic.

    LOG_NUHOUD(Log, TEXT("SpawnTarget — distance: %.0fcm, radius: %.0fcm, speed: %.0fcm/s"),
        CurrentParams.TargetDistance, CurrentParams.TargetRadius, CurrentParams.TargetMoveSpeed);
}

// ---------------------------------------------------------------------------
// Session Log → Backend Transmission
// ---------------------------------------------------------------------------

FString ANuhoudGameMode::BuildSessionJsonPayload() const
{
    // Build the JSON payload that matches the /api/v2/sessions contract:
    //
    // {
    //   "patient_id": "...",
    //   "plan_id": "..." | null,
    //   "source": "live",
    //   "limb": "right",
    //   "duration_seconds": 180,
    //   "total_reps": 50,
    //   "correct_reps": 42,
    //   "max_achieved_angle": 145.2,
    //   "compensation_errors": 8,
    //   "gamification_score": 440,
    //   "angle_timeline": [45.0, 50.0, ...]
    // }

    TSharedRef<FJsonObject> JsonObject = MakeShareable(new FJsonObject());

    JsonObject->SetStringField(TEXT("patient_id"), PatientId);
    JsonObject->SetStringField(TEXT("plan_id"), PlanId);
    JsonObject->SetStringField(TEXT("source"), SessionLog.Source);
    JsonObject->SetStringField(TEXT("limb"), SessionLog.Limb);
    JsonObject->SetNumberField(TEXT("duration_seconds"), SessionLog.SessionDuration);
    JsonObject->SetNumberField(TEXT("total_reps"), SessionLog.TotalReps);
    JsonObject->SetNumberField(TEXT("correct_reps"), SessionLog.CorrectReps);
    JsonObject->SetNumberField(TEXT("max_achieved_angle"), SessionLog.MaxAngle);
    JsonObject->SetNumberField(TEXT("compensation_errors"), SessionLog.CompensationErrors);
    JsonObject->SetNumberField(TEXT("gamification_score"), SessionLog.Score);

    // Angle timeline as a JSON array.
    TArray<TSharedPtr<FJsonValue>> AngleArray;
    for (float Angle : SessionLog.AngleTimeline)
    {
        AngleArray.Add(MakeShareable(new FJsonValueNumber(Angle)));
    }
    JsonObject->SetArrayField(TEXT("angle_timeline"), AngleArray);

    // Serialize to string.
    FString OutputString;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
    FJsonSerializer::Serialize(JsonObject, Writer);

    return OutputString;
}

void ANuhoudGameMode::SendSessionToBackend()
{
    FString JsonPayload = BuildSessionJsonPayload();

    LOG_NUHOUD(Log, TEXT("Sending session to backend: %s"), *BackendURL);
    LOG_NUHOUD(Log, TEXT("Payload: %s"), *JsonPayload.Left(200));

    // Create the HTTP request.
    TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(BackendURL);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));

    // Attach the JWT auth token if available.
    if (!AuthToken.IsEmpty())
    {
        Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *AuthToken));
    }

    Request->SetContentAsString(JsonPayload);

    // Bind the response handler.
    Request->OnProcessRequestComplete().BindUObject(this, &ANuhoudGameMode::OnSessionPostResponse);

    // Send.
    Request->ProcessRequest();
}

void ANuhoudGameMode::OnSessionPostResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSuccess)
{
    if (bSuccess && Response.IsValid())
    {
        int32 Code = Response->GetResponseCode();
        FString Body = Response->GetContentAsString();

        if (Code == 200)
        {
            LOG_NUHOUD(Log, TEXT("✅ Session sent to backend successfully (200)"));
        }
        else
        {
            LOG_NUHOUD(Warning, TEXT("⚠️ Backend returned %d: %s"), Code, *Body.Left(200));
        }
    }
    else
    {
        LOG_NUHOUD(Error, TEXT("❌ Failed to send session to backend"));
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

void ANuhoudGameMode::SetSessionState(ENuhoudSessionState NewState)
{
    if (SessionState == NewState)
        return;

    SessionState = NewState;
    OnSessionStateChanged.Broadcast(NewState);

    LOG_NUHOUD(Log, TEXT("Session state → %d"), static_cast<int32>(NewState));
}
