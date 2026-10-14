#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudRiggedHand.h"
#include "NuhoudGrabbable.h"
#include "NuhoudInputAdapter.generated.h"

class ANuhoudFirstPersonPawn;

/** One arm sample from the pose server. Positions are cm relative to the eyes, axes (forward, right, up). */
struct FNuhoudArmSample
{
	bool bTracked = false;
	FVector Shoulder = FVector::ZeroVector;
	FVector Elbow = FVector::ZeroVector;
	FVector Wrist = FVector::ZeroVector;
	float UpperArmCm = 0.f;
	float ForearmCm = 0.f;
	float ShoulderElevation = 0.f;
	float ShoulderFlexion = 0.f;
	float ShoulderAbduction = 0.f;
	float ElbowAngle = 0.f;
};

/** One hand sample from the pose server, in the same eye-relative axes as FNuhoudArmSample. */
struct FNuhoudHandSample
{
	bool bTracked = false;
	FVector Dir = FVector::ForwardVector;
	FVector PalmNormal = -FVector::UpVector;
	TArray<FVector> Curls;
	FString Gesture;
	int32 FingersExtended = 0;
	bool bPinching = false;
	float PinchCm = 99.f;
};

/** Turns eye-relative tracking into world-space first-person hands that can pick things up. */
UCLASS()
class NUHOUD_API ANuhoudInputAdapter : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudInputAdapter();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaTime) override;

	void SetViewPawn(ANuhoudFirstPersonPawn* InPawn) { ViewPawn = InPawn; }

	/** The hands the treatment plan trains; the other hand is not shown and cannot pick anything up. */
	void SetActiveHands(bool bRight, bool bLeft)
	{
		bRightActive = bRight;
		bLeftActive = bLeft;
	}
	bool IsHandActive(ENuhoudHandSide Side) const { return Side == ENuhoudHandSide::Right ? bRightActive : bLeftActive; }
	void SetArmSample(ENuhoudHandSide Side, const FNuhoudArmSample& Sample);
	void SetHandSample(ENuhoudHandSide Side, const FNuhoudHandSample& Sample);

	const FNuhoudArmSample& GetArmSample(ENuhoudHandSide Side) const { return State(Side).Arm; }
	const FNuhoudHandSample& GetHandSample(ENuhoudHandSide Side) const { return State(Side).Hand; }

	bool IsHandVisible(ENuhoudHandSide Side) const;
	FVector GetPalmLocation(ENuhoudHandSide Side) const;

	/** Palm centres of every visible hand. */
	void GetInteractionPoints(TArray<FVector>& OutPoints) const;

	/** Shoulder relative to the eyes: tracked when available, otherwise an adult default. */
	FVector GetShoulderLocal(ENuhoudHandSide Side) const { return State(Side).ShoulderLocal; }

	/** Shoulder-to-palm reach in cm. */
	float GetReachLength(ENuhoudHandSide Side) const { return State(Side).Reach; }

	/** 0 = open hand, 1 = full fist, from the tracked finger flexion. */
	float GetGripClosure(ENuhoudHandSide Side) const { return State(Side).Closure; }
	bool IsHolding(ENuhoudHandSide Side) const { return State(Side).Held.IsValid(); }

	/** Short readout of what the camera sees for one hand, e.g. "grip 64% pinch 2.8cm". */
	FString DescribeGrip(ENuhoudHandSide Side) const;

private:
	struct FSideState
	{
		FNuhoudArmSample Arm;
		FNuhoudHandSample Hand;
		double LastArmTime = -100.0;
		double LastHandTime = -100.0;
		FVector ShoulderLocal = FVector::ZeroVector;
		float Reach = 60.f;

		float Closure = 0.f;
		float ClosureCeiling = 0.9f;
		bool bGrasping = false;
		bool bPinching = false;
		double GraspStartTime = -100.0;
		double PinchStartTime = -100.0;
		TWeakObjectPtr<ANuhoudGrabbable> Held;
		ENuhoudGrip HeldGrip = ENuhoudGrip::Grasp;
		/** How long the grip has read open while holding something. */
		float OpenTime = 0.f;
		FVector PrevPalm = FVector::ZeroVector;
		FVector PalmVelocity = FVector::ZeroVector;
		bool bHasPrevPalm = false;

		/** Smallest recent thumb-index distance; the pinch threshold is set relative to it. */
		float PinchFloor = 3.f;
		float PinchOnCm = 3.8f;
		float GraspOn = 0.55f;
		TWeakObjectPtr<ANuhoudGrabbable> DwellTarget;
		float DwellTime = 0.f;
		float LogTimer = 0.f;
	};

	FSideState& State(ENuhoudHandSide Side) { return Side == ENuhoudHandSide::Right ? RightState : LeftState; }
	const FSideState& State(ENuhoudHandSide Side) const { return Side == ENuhoudHandSide::Right ? RightState : LeftState; }
	ANuhoudRiggedHand* Hand(ENuhoudHandSide Side) const { return Side == ENuhoudHandSide::Right ? RightHand : LeftHand; }

	void UpdateHand(ENuhoudHandSide Side);
	void UpdateGrip(ENuhoudHandSide Side, float DeltaTime);
	void UpdateGripState(FSideState& S, float DeltaTime);
	void Grab(FSideState& S, const ANuhoudRiggedHand* H, ANuhoudGrabbable* Target, ENuhoudGrip Grip, const FVector& GrabPoint);
	void DropHeld(FSideState& S, const FVector& Velocity);

	/** Nearest grabbable whose surface looks within Radius of Point on screen. */
	ANuhoudGrabbable* FindGrabbable(const FVector& Point, ENuhoudGrip Grip, float Radius, FVector& OutGrabPoint) const;
	float Perceived(const FVector& A, const FVector& B) const;
	void LogGrip(ENuhoudHandSide Side, const FSideState& S, const ANuhoudRiggedHand* H) const;
	static FTransform GripFrame(const ANuhoudRiggedHand* H, ENuhoudGrip Grip);
	static float ComputeClosure(const TArray<FVector>& Curls);

	UPROPERTY()
	ANuhoudRiggedHand* RightHand;

	UPROPERTY()
	ANuhoudRiggedHand* LeftHand;

	UPROPERTY()
	ANuhoudFirstPersonPawn* ViewPawn;

	FSideState RightState;
	FSideState LeftState;
	bool bRightActive = true;
	bool bLeftActive = true;
};
