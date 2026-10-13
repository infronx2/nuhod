// ============================================================================
// NuhoudHUD.cpp
// ============================================================================

#include "NuhoudHUD.h"
#include "NuhoudGameMode.h"

#include "Components/TextBlock.h"
#include "Components/Button.h"
#include "Components/ProgressBar.h"
#include "Components/Image.h"
#include "Kismet/GameplayStatics.h"

UNuhoudHUD::UNuhoudHUD(const FObjectInitializer& ObjectInitializer)
    : Super(ObjectInitializer)
{
}

void UNuhoudHUD::NativeConstruct()
{
    Super::NativeConstruct();

    // Bind the Pain Stop button click event
    if (PainStopButton)
    {
        PainStopButton->OnClicked.AddDynamic(this, &UNuhoudHUD::OnPainStopClicked);
    }

    // Hide the overlays initially
    if (CompensationOverlay)
    {
        CompensationOverlay->SetVisibility(ESlateVisibility::Hidden);
    }
    if (LevelUpFlash)
    {
        LevelUpFlash->SetVisibility(ESlateVisibility::Hidden);
    }
}

// ---------------------------------------------------------------------------
// Update methods
// ---------------------------------------------------------------------------

void UNuhoudHUD::UpdateScore(int32 NewScore)
{
    if (ScoreText)
    {
        ScoreText->SetText(FText::FromString(FString::FromInt(NewScore)));
    }
}

void UNuhoudHUD::UpdateStreak(int32 NewStreak)
{
    if (StreakText)
    {
        // Show the streak with a flame emoji for 3+ streak
        if (NewStreak >= 3)
        {
            StreakText->SetText(FText::Format(
                NSLOCTEXT("Nuhoud", "StreakFire", "{0} 🔥"),
                FText::AsNumber(NewStreak)
            ));
        }
        else
        {
            StreakText->SetText(FText::AsNumber(NewStreak));
        }
    }
}

void UNuhoudHUD::UpdateLevel(int32 LevelIndex, int32 ConsecutiveCorrectReps, int32 RepsToNextLevel)
{
    if (LevelText)
    {
        LevelText->SetText(FText::Format(
            NSLOCTEXT("Nuhoud", "LevelText", "Level {0}"),
            FText::AsNumber(LevelIndex + 1)
        ));
    }

    if (LevelProgressBar)
    {
        float Progress = RepsToNextLevel > 0
            ? static_cast<float>(ConsecutiveCorrectReps) / RepsToNextLevel
            : 0.0f;
        LevelProgressBar->SetPercent(FMath::Clamp(Progress, 0.0f, 1.0f));
    }
}

void UNuhoudHUD::UpdateAll(int32 Score, int32 Streak, int32 LevelIndex, int32 ConsecutiveCorrectReps, int32 RepsToNextLevel)
{
    UpdateScore(Score);
    UpdateStreak(Streak);
    UpdateLevel(LevelIndex, ConsecutiveCorrectReps, RepsToNextLevel);
}

void UNuhoudHUD::ShowCompensationWarning(bool bShow)
{
    if (CompensationOverlay)
    {
        CompensationOverlay->SetVisibility(bShow ? ESlateVisibility::Visible : ESlateVisibility::Hidden);
    }
}

void UNuhoudHUD::ShowLevelUpFlash()
{
    // In Blueprint, this would trigger a UMG animation (e.g., a gold flash
    // that fades out over 1 second). In C++, we briefly show the image.
    // The Blueprint should override this with a PlayAnimation call.
    if (LevelUpFlash)
    {
        LevelUpFlash->SetVisibility(ESlateVisibility::Visible);
    }
}

// ---------------------------------------------------------------------------
// Pain Stop
// ---------------------------------------------------------------------------

void UNuhoudHUD::OnPainStopClicked()
{
    ANuhoudGameMode* GM = GetGameMode();
    if (GM)
    {
        GM->EndSession();
    }
}

ANuhoudGameMode* UNuhoudHUD::GetGameMode() const
{
    if (UWorld* World = GetWorld())
    {
        return Cast<ANuhoudGameMode>(World->GetAuthGameMode());
    }
    return nullptr;
}
