#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudRenderManager.generated.h"

class APostProcessVolume;

UENUM(BlueprintType)
enum class ENuhoudQualityTier : uint8
{
	Ultra   UMETA(DisplayName = "Ultra (RTX/Lumen)"),
	High    UMETA(DisplayName = "High (PC)"),
	Medium  UMETA(DisplayName = "Medium (VR)"),
	Low     UMETA(DisplayName = "Low (Mobile/Forward)"),
};

UCLASS()
class NUHOUD_API ANuhoudRenderManager : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudRenderManager();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Render")
	ENuhoudQualityTier CurrentTier;

	UPROPERTY(EditAnywhere, Category = "Nuhoud|Render")
	bool bEnableAdaptiveScaling;

	UFUNCTION(BlueprintCallable, Category = "Nuhoud|Render")
	void SetQualityTier(ENuhoudQualityTier Tier);

protected:
	void DetectHardwareTier();
	void ApplyQualitySettings();
	void SpawnCinematicPostProcess();
	void MonitorPerformance();

private:
	UPROPERTY()
	APostProcessVolume* CinematicPPV;

	float FrameTimeAccumulator;
	int32 FrameSampleCount;
	float TargetFrameTime;
};
