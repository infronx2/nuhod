#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudRiggedHand.generated.h"

class UPoseableMeshComponent;
class UMaterialInstanceDynamic;

UENUM()
enum class ENuhoudHandSide : uint8
{
	Left,
	Right,
};

/** MannyXR skeletal hand driven bone-by-bone from tracked finger flexion. */
UCLASS()
class NUHOUD_API ANuhoudRiggedHand : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudRiggedHand();
	virtual void Tick(float DeltaTime) override;

	void InitializeHand(ENuhoudHandSide InSide);

	/** Wrist position and orientation in world space. Dir points wrist -> middle knuckle, PalmNormal points out of the palm. */
	void SetTargetPose(const FVector& WristWorld, const FVector& DirWorld, const FVector& PalmNormalWorld);

	/** Tracked elbow, so a forearm connects the hand back toward the patient's body. */
	void SetElbowTarget(const FVector& ElbowWorld) { ElbowTarget = ElbowWorld; }

	/** 0 = no grip seen, 1 = holding something; shown as a faint glow on the skin. */
	void SetGripFeedback(float Amount) { GripFeedbackTarget = Amount; }

	/** Per finger (thumb..pinky): X = MCP, Y = PIP, Z = DIP flexion in degrees. Empty array = relaxed pose. */
	void SetFingerCurls(const TArray<FVector>& Curls);

	void SetHandVisible(bool bVisible);
	bool IsHandVisible() const { return bVisibleState; }
	FVector GetPalmLocation() const;
	FVector GetPalmNormal() const;

	/** 0 = thumb .. 4 = pinky, at the current (tracked) finger pose. */
	FVector GetFingerTip(int32 Finger) const;

	/** Between thumb and index fingertips: where a pinched object sits. */
	FVector GetPinchPoint() const;

	/** Just off the palm: where a grasped object sits. */
	FVector GetGraspPoint() const;

	UPROPERTY(EditAnywhere, Category = "Nuhoud|Hand")
	FLinearColor SkinTint;

private:
	struct FFingerRig
	{
		FName Bones[3];
		FVector Axis = FVector::ZeroVector;
		FVector DistalAxisLocal = FVector::ForwardVector;
		float DistalLength = 2.f;
		float RefCurl[3] = { 0.f, 0.f, 0.f };
		float CurrentCurl[3] = { 0.f, 0.f, 0.f };
		float TargetCurl[3] = { 0.f, 0.f, 0.f };
	};

	void BuildRig();
	void ApplyFingers();
	void UpdateForearm(float DeltaTime);

	UPROPERTY(VisibleAnywhere)
	USceneComponent* Root;

	UPROPERTY(VisibleAnywhere)
	UPoseableMeshComponent* HandMesh;

	UPROPERTY()
	UMaterialInstanceDynamic* SkinMaterial;

	UPROPERTY()
	class UProceduralMeshComponent* Forearm;

	FVector ElbowTarget;
	FVector ElbowSmoothed;
	float GripFeedbackTarget;
	float GripFeedback;

	ENuhoudHandSide Side;
	FFingerRig Fingers[5];
	FQuat RestBasisInverse;
	FVector PalmBoneLocal;
	FVector PalmNormalLocal;

	FVector TargetLocation;
	FQuat TargetRotation;
	bool bHasTarget;
	bool bVisibleState;
	bool bRigReady;
	bool bSnapElbow;
};
