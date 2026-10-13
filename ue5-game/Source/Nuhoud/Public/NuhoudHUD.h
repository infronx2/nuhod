// ============================================================================
// NuhoudHUD.h
// ============================================================================
// A UMG-based HUD widget displayed via a UWidgetComponent attached to the
// player's Pawn. Works in both VR (floating in front of the player) and
// Flat screen (rendered as a world-space widget).
//
// Shows:
//   - Score (large, top center)
//   - Current streak (with flame icon when streak ≥ 3)
//   - Dynamic level (1-5, with a progress bar to the next level)
//   - "Pain Stop" emergency button → calls GameMode->EndSession()
//
// Blueprint setup:
//   Create a UMG Widget Blueprint (WBP_NuhoudHUD) based on this class.
//   Add TextBlocks bound to ScoreText, StreakText, LevelText.
//   Add a Button bound to PainStopButton.
//   Add a ProgressBar bound to LevelProgressBar.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "NuhoudHUD.generated.h"

class UTextBlock;
class UButton;
class UProgressBar;
class UImage;

// ---------------------------------------------------------------------------
// HUD Widget
// ---------------------------------------------------------------------------

UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API UNuhoudHUD : public UUserWidget
{
    GENERATED_BODY()

public:
    UNuhoudHUD(const FObjectInitializer& ObjectInitializer);

    virtual void NativeConstruct() override;

    // -----------------------------------------------------------------------
    // Update methods — called by the GameMode/Pawn each frame or on events
    // -----------------------------------------------------------------------

    /** Update the score display. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void UpdateScore(int32 NewScore);

    /** Update the streak display. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void UpdateStreak(int32 NewStreak);

    /** Update the level display + progress bar. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void UpdateLevel(int32 LevelIndex, int32 ConsecutiveCorrectReps, int32 RepsToNextLevel = 10);

    /** Update all at once (for convenience). */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void UpdateAll(int32 Score, int32 Streak, int32 LevelIndex, int32 ConsecutiveCorrectReps, int32 RepsToNextLevel = 10);

    /** Show/hide the compensation warning overlay. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void ShowCompensationWarning(bool bShow);

    /** Show/hide the level-up celebration flash. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HUD")
    void ShowLevelUpFlash();

    // -----------------------------------------------------------------------
    // Bound widgets (set in the UMG Blueprint editor — bind by name)
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UTextBlock* ScoreText;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UTextBlock* StreakText;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UTextBlock* LevelText;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UProgressBar* LevelProgressBar;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UButton* PainStopButton;

    /** Optional: image that flashes red when compensation is detected. */
    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UImage* CompensationOverlay;

    /** Optional: image that flashes gold when leveling up. */
    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|HUD|Widgets")
    UImage* LevelUpFlash;

protected:
    // -----------------------------------------------------------------------
    // The Pain Stop button handler — calls EndSession on the GameMode
    // -----------------------------------------------------------------------

    UFUNCTION()
    void OnPainStopClicked();

    /** Helper to get the GameMode. */
    class ANuhoudGameMode* GetGameMode() const;
};
