// ============================================================================
// NuhoudROMHeatmap.h
// ============================================================================
// A UMG widget that renders a real-time heatmap of the patient's elbow
// angles over the last 10 reps. Helps the patient visually see their
// Range of Motion (ROM) improving live during the session.
//
// The widget uses a Canvas Panel with dynamically positioned + colored
// bars (one per rep), where the height represents the angle and the
// color represents the quality (green = clean, amber = compensated).
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "NuhoudROMHeatmap.generated.h"

class UCanvasPanel;
class UTextBlock;

// ---------------------------------------------------------------------------
// Rep data entry (one bar in the heatmap)
// ---------------------------------------------------------------------------

USTRUCT(BlueprintType)
struct FNuhoudRepEntry
{
    GENERATED_BODY()

    /** The max elbow angle achieved during this rep. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Heatmap")
    float MaxAngle = 0.0f;

    /** Was this rep clean (no compensation)? */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Heatmap")
    bool bClean = true;

    /** The timestamp of this rep. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Heatmap")
    float Timestamp = 0.0f;
};

// ---------------------------------------------------------------------------
// ROM Heatmap Widget
// ---------------------------------------------------------------------------

UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API UNuhoudROMHeatmap : public UUserWidget
{
    GENERATED_BODY()

public:
    UNuhoudROMHeatmap(const FObjectInitializer& ObjectInitializer);

    virtual void NativeConstruct() override;

    /**
     * Add a completed rep to the heatmap.
     * @param MaxAngle   The max elbow angle for this rep.
     * @param bClean     True if no compensation was detected.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Heatmap")
    void AddRep(float MaxAngle, bool bClean);

    /** Clear all entries (e.g., on session start). */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Heatmap")
    void ClearReps();

    /** Get the current average angle across all reps. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Heatmap")
    float GetAverageAngle() const;

    /** Get the trend (improving, stable, declining) based on recent reps. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Heatmap")
    FString GetTrendString() const;

    // -----------------------------------------------------------------------
    // Bound Widgets
    // -----------------------------------------------------------------------

    /** The canvas panel where the heatmap bars are drawn. */
    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Heatmap|Widgets")
    UCanvasPanel* HeatmapCanvas;

    /** Text showing the average angle. */
    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Heatmap|Widgets")
    UTextBlock* AvgAngleText;

    /** Text showing the trend. */
    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Heatmap|Widgets")
    UTextBlock* TrendText;

protected:
    /** The last 10 reps (or fewer if the session is young). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Heatmap|State")
    TArray<FNuhoudRepEntry> RepEntries;

    /** The max angle seen across all reps (for scaling the bars). */
    float GlobalMaxAngle = 180.0f;

    /** Refresh the visual bars in the canvas (called by AddRep). */
    UFUNCTION(BlueprintImplementableEvent, Category = "Nuhoud|Heatmap")
    void RefreshHeatmap();

    /** The current session start time (for timestamps). */
    double SessionStartTime = 0.0;
};
