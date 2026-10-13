// ============================================================================
// NuhoudROMHeatmap.cpp
// ============================================================================

#include "NuhoudROMHeatmap.h"
#include "HAL/PlatformTime.h"
#include "Components/CanvasPanel.h"
#include "Components/TextBlock.h"

UNuhoudROMHeatmap::UNuhoudROMHeatmap(const FObjectInitializer& ObjectInitializer)
    : Super(ObjectInitializer)
{
}

void UNuhoudROMHeatmap::NativeConstruct()
{
    Super::NativeConstruct();
    SessionStartTime = FPlatformTime::Seconds();
    RepEntries.Empty();
    GlobalMaxAngle = 180.0f;
}

// ---------------------------------------------------------------------------
// Rep Management
// ---------------------------------------------------------------------------

void UNuhoudROMHeatmap::AddRep(float MaxAngle, bool bClean)
{
    FNuhoudRepEntry Entry;
    Entry.MaxAngle = MaxAngle;
    Entry.bClean = bClean;
    Entry.Timestamp = static_cast<float>(FPlatformTime::Seconds() - SessionStartTime);

    RepEntries.Add(Entry);

    // Keep only the last 10 reps.
    if (RepEntries.Num() > 10)
    {
        RepEntries.RemoveAt(0);
    }

    // Update the global max for bar scaling.
    if (MaxAngle > GlobalMaxAngle)
    {
        GlobalMaxAngle = MaxAngle;
    }

    // Update the text labels.
    if (AvgAngleText)
    {
        AvgAngleText->SetText(FText::Format(
            NSLOCTEXT("Nuhoud", "AvgAngle", "Avg: {0}°"),
            FText::AsNumber(FMath::RoundToInt(GetAverageAngle()))
        ));
    }

    if (TrendText)
    {
        TrendText->SetText(FText::FromString(GetTrendString()));
    }

    // Trigger the Blueprint visual refresh (creates bars on the canvas).
    RefreshHeatmap();
}

void UNuhoudROMHeatmap::ClearReps()
{
    RepEntries.Empty();
    GlobalMaxAngle = 180.0f;
    SessionStartTime = FPlatformTime::Seconds();

    if (AvgAngleText)
    {
        AvgAngleText->SetText(NSLOCTEXT("Nuhoud", "NoData", "Avg: —"));
    }
    if (TrendText)
    {
        TrendText->SetText(NSLOCTEXT("Nuhoud", "NoTrend", "Trend: —"));
    }

    RefreshHeatmap();
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

float UNuhoudROMHeatmap::GetAverageAngle() const
{
    if (RepEntries.Num() == 0)
        return 0.0f;

    float Sum = 0.0f;
    for (const auto& Entry : RepEntries)
    {
        Sum += Entry.MaxAngle;
    }
    return Sum / RepEntries.Num();
}

FString UNuhoudROMHeatmap::GetTrendString() const
{
    if (RepEntries.Num() < 2)
        return TEXT("—");

    // Compare the average of the first half to the average of the second half.
    int32 Mid = RepEntries.Num() / 2;
    float FirstHalfSum = 0.0f, SecondHalfSum = 0.0f;
    for (int32 i = 0; i < Mid; i++)
        FirstHalfSum += RepEntries[i].MaxAngle;
    for (int32 i = Mid; i < RepEntries.Num(); i++)
        SecondHalfSum += RepEntries[i].MaxAngle;

    float FirstAvg = FirstHalfSum / Mid;
    float SecondAvg = SecondHalfSum / (RepEntries.Num() - Mid);

    float Delta = SecondAvg - FirstAvg;
    if (Delta > 5.0f)
        return TEXT("↑ Improving");
    else if (Delta < -5.0f)
        return TEXT("↓ Declining");
    else
        return TEXT("→ Stable");
}
