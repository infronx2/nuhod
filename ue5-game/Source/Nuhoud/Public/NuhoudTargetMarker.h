#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudTargetMarker.generated.h"

class UMaterialInstanceDynamic;

/** Where the patient should bring an object: a ceiling hook for a lantern or a guest plate for a date. */
UCLASS()
class NUHOUD_API ANuhoudTargetMarker : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudTargetMarker();
	virtual void Tick(float DeltaTime) override;

	/** Brass hook on a chain from the ceiling; the actor location is where a lantern ring catches. */
	void BuildHook(float CeilingZ);

	/** Porcelain plate on the table; the actor location is the plate's base. */
	void BuildPlate();

	FVector GetPlateTop() const { return GetActorLocation() + FVector(0.f, 0.f, PlateTopZ); }

	/** Brief golden flash when the patient succeeds. */
	void Celebrate() { CelebrateTime = 0.f; bCelebrating = true; }

	/** 0..1 while the object is held on the target: the halo warms to gold, telling the patient to hold still. */
	void SetProgress(float InProgress) { Progress = FMath::Clamp(InProgress, 0.f, 1.f); }

private:
	void BuildHalo(float Radius, float Z);

	UPROPERTY()
	USceneComponent* Root;

	UPROPERTY()
	UMaterialInstanceDynamic* HaloMaterial;

	float Time;
	float CelebrateTime;
	bool bCelebrating;
	float Progress = 0.f;

	static constexpr float PlateTopZ = 0.9f;
};
