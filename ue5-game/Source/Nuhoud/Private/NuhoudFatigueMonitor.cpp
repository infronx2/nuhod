// ============================================================================
// NuhoudFatigueMonitor.cpp
// ============================================================================

#include "NuhoudFatigueMonitor.h"
#include "HAL/PlatformTime.h"

UNuhoudFatigueMonitor::UNuhoudFatigueMonitor()
{
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

void UNuhoudFatigueMonitor::Reset()
{
    CurrentState = ENuhoudFatigueState::Normal;
    BaselineReactionTime = 0.0f;
    CurrentReactionTime = 0.0f;
    BaselineMaxAngle = 0.0f;
    CurrentMaxAngle = 0.0f;
    SustainedDropTimer = 0.0f;
    RestTimer = 0.0f;
    bBaselineEstablished = false;
    bReactionTimeSlowed = false;
    bAngleDropped = false;
    bLastTrackingSuccess = false;
    LastFrameTime = 0.0;
    RepTimestamps.Empty();
    AngleHistory.Empty();
}

// ---------------------------------------------------------------------------
// Data Input
// ---------------------------------------------------------------------------

void UNuhoudFatigueMonitor::ProcessFrame(float ElbowAngle, bool bTrackingSuccess)
{
    double Now = FPlatformTime::Seconds();

    if (bTrackingSuccess)
    {
        // Record angle in the rolling history (capped at 30 seconds).
        AngleHistory.Add(TPair<double, float>(Now, ElbowAngle));
        while (AngleHistory.Num() > 0 && (Now - AngleHistory[0].Key) > 30.0)
        {
            AngleHistory.RemoveAt(0);
        }
    }

    bLastTrackingSuccess = bTrackingSuccess;
    LastFrameTime = Now;
}

void UNuhoudFatigueMonitor::OnRepCompleted()
{
    double Now = FPlatformTime::Seconds();
    RepTimestamps.Add(Now);

    // Keep only the last 20 reps for reaction-time averaging.
    if (RepTimestamps.Num() > 20)
    {
        RepTimestamps.RemoveAt(0);
    }

    // Try to establish the baseline after the first N reps.
    TryEstablishBaseline();
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

void UNuhoudFatigueMonitor::Tick(float DeltaSeconds)
{
    if (CurrentState == ENuhoudFatigueState::Recovering)
    {
        // Count down the rest timer
        RestTimer -= DeltaSeconds;
        if (RestTimer <= 0.0f)
        {
            // Rest complete — back to normal
            SetState(ENuhoudFatigueState::Normal);
            bReactionTimeSlowed = false;
            bAngleDropped = false;
            SustainedDropTimer = 0.0f;
        }
        return;
    }

    if (!bBaselineEstablished)
        return;

    EvaluateFatigue();
}

// ---------------------------------------------------------------------------
// Fatigue Evaluation
// ---------------------------------------------------------------------------

void UNuhoudFatigueMonitor::EvaluateFatigue()
{
    // --- Metric 1: Reaction Time ---
    CurrentReactionTime = ComputeAverageReactionTime();

    if (BaselineReactionTime > 0.0f && CurrentReactionTime > 0.0f)
    {
        float SlowdownRatio = (CurrentReactionTime - BaselineReactionTime) / BaselineReactionTime;
        bReactionTimeSlowed = SlowdownRatio > ReactionTimeSlowdownThreshold;
    }

    // --- Metric 2: Angle Drop ---
    CurrentMaxAngle = ComputeRecentMaxAngle(10.0);

    if (BaselineMaxAngle > 0.0f)
    {
        bool bBelowThreshold = CurrentMaxAngle < BaselineMaxAngle * AngleDropThreshold;

        if (bBelowThreshold)
        {
            // Accumulate the sustained drop timer
            SustainedDropTimer += 0.1f; // Approximate (called every ~0.1s from Tick)
        }
        else
        {
            // Reset the timer if the patient recovers
            SustainedDropTimer = 0.0f;
        }

        bAngleDropped = SustainedDropTimer >= SustainedDropDuration;
    }

    // --- Decision: require BOTH metrics to trigger auto-pause ---
    if (bReactionTimeSlowed && bAngleDropped)
    {
        // Fatigue detected — trigger Smart Auto-Pause
        SetState(ENuhoudFatigueState::Fatigued);
        RestTimer = RestDuration;
        OnSmartAutoPause.Broadcast(RestDuration);

        // After broadcasting, transition to Recovering state
        SetState(ENuhoudFatigueState::Recovering);
    }
    else if (bReactionTimeSlowed || bAngleDropped)
    {
        // One metric flagged — warning state
        if (CurrentState == ENuhoudFatigueState::Normal)
        {
            SetState(ENuhoudFatigueState::Warning);
        }
    }
    else
    {
        // Both normal
        if (CurrentState == ENuhoudFatigueState::Warning)
        {
            SetState(ENuhoudFatigueState::Normal);
        }
    }
}

// ---------------------------------------------------------------------------
// Baseline Establishment
// ---------------------------------------------------------------------------

void UNuhoudFatigueMonitor::TryEstablishBaseline()
{
    if (bBaselineEstablished)
        return;

    if (RepTimestamps.Num() < BaselineRepCount)
        return;

    // Baseline reaction time = average gap between the first N reps
    BaselineReactionTime = ComputeAverageReactionTime();

    // Baseline max angle = max angle in the first 10 seconds of data
    BaselineMaxAngle = 0.0f;
    for (const auto& Pair : AngleHistory)
    {
        if (Pair.Value > BaselineMaxAngle)
        {
            BaselineMaxAngle = Pair.Value;
        }
    }

    bBaselineEstablished = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

float UNuhoudFatigueMonitor::ComputeAverageReactionTime() const
{
    if (RepTimestamps.Num() < 2)
        return 0.0f;

    float TotalGap = 0.0f;
    int32 Count = 0;

    for (int32 i = 1; i < RepTimestamps.Num(); i++)
    {
        double Gap = RepTimestamps[i] - RepTimestamps[i - 1];
        TotalGap += static_cast<float>(Gap);
        Count++;
    }

    return Count > 0 ? TotalGap / Count : 0.0f;
}

float UNuhoudFatigueMonitor::ComputeRecentMaxAngle(double WindowSeconds) const
{
    double Now = FPlatformTime::Seconds();
    float MaxAngle = 0.0f;

    for (const auto& Pair : AngleHistory)
    {
        if ((Now - Pair.Key) <= WindowSeconds && Pair.Value > MaxAngle)
        {
            MaxAngle = Pair.Value;
        }
    }

    return MaxAngle;
}

void UNuhoudFatigueMonitor::SetState(ENuhoudFatigueState NewState)
{
    if (CurrentState == NewState)
        return;

    CurrentState = NewState;
    OnFatigueStateChanged.Broadcast(NewState);
}
