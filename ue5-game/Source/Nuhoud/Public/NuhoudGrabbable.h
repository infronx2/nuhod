#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudGrabbable.generated.h"

class UShapeComponent;
class UMaterialInstanceDynamic;
class ANuhoudGrabbable;

UENUM()
enum class ENuhoudGrip : uint8
{
	Pinch,
	Grasp,
};

UENUM()
enum class ENuhoudGrabState : uint8
{
	Home,       // resting kinematically at its home spot
	Held,       // following a hand
	Free,       // dropped, simulating physics
	Returning,  // floating back home after coming to rest
	Placed,     // settled on a target or consumed; not grabbable
};

DECLARE_DELEGATE_TwoParams(FOnNuhoudGrabEvent, ANuhoudGrabbable*, ENuhoudGrip);

/**
 * A real-scale object the patient can pick up with a tracked hand. Dropped objects fall with
 * physics, then drift back to their home spot so the patient can try again.
 */
UCLASS(Abstract)
class NUHOUD_API ANuhoudGrabbable : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudGrabbable();
	virtual void Tick(float DeltaTime) override;

	bool AllowsGrip(ENuhoudGrip Grip) const { return Grip == ENuhoudGrip::Pinch ? bAllowPinch : bAllowGrasp; }
	bool CanBeGrabbed() const;

	/**
	 * The current task decides what can be picked up: a stroke patient's resting hand is often
	 * half closed and would otherwise pick up whatever cup it rests next to.
	 */
	void SetGrabEnabled(bool bEnabled) { bGrabEnabled = bEnabled; }
	ENuhoudGrabState GetState() const { return State; }
	FVector GetGrabAnchor() const { return GetActorTransform().TransformPosition(GrabAnchorLocal); }
	const FVector& GetGrabAnchorLocal() const { return GrabAnchorLocal; }

	/** Distance from the actor origin down to the surface it rests on. */
	float GetRestHeight() const { return RestHeight; }

	/** Sets the home pose and snaps there. */
	void SetHome(const FTransform& InHome);
	void SnapHome();

	/** Point on the object's surface closest to Point (Point itself when inside). */
	FVector ClosestSurfacePoint(const FVector& Point) const;

	/** GrabPoint is where the hand closed on the object; that point stays in the hand while held. */
	void BeginGrab(ENuhoudGrip Grip, const FTransform& GripFrame, const FVector& GrabPoint);
	void UpdateHeld(const FTransform& GripFrame, float DeltaTime);
	void Release(const FVector& Velocity);

	/** Settles quickly onto Target and stops being grabbable. */
	void PlaceAt(const FTransform& Target);
	void ReturnHome();

	/** Call every frame a hand is close enough to grab it; the glow fades when calls stop. */
	void RequestHighlight() { HighlightFrame = GFrameCounter; }

	FOnNuhoudGrabEvent OnGrabbed;
	FOnNuhoudGrabEvent OnReleased;

protected:
	virtual void BeginPlay() override;
	virtual void BuildVisuals() {}

	template <typename TShape>
	TShape* CreateBody(FName Name)
	{
		TShape* Shape = CreateDefaultSubobject<TShape>(Name);
		Body = Shape;
		RootComponent = Shape;
		Visual->SetupAttachment(Shape);
		return Shape;
	}

	/** Lit material whose emissive also carries the grab highlight. */
	UMaterialInstanceDynamic* MakeMaterial(const FLinearColor& BaseColor, float Metallic, float Roughness,
		const FLinearColor& Emissive = FLinearColor::Black, bool bHighlight = true);

	/** Not grabbable and not moving on its own anymore; the subclass drives it. */
	void Freeze();

	UPROPERTY(VisibleAnywhere)
	UShapeComponent* Body;

	UPROPERTY(VisibleAnywhere)
	USceneComponent* Visual;

	FVector GrabAnchorLocal;
	float RestHeight;
	float MassKg;
	bool bAllowPinch;
	bool bAllowGrasp;

	/** Hangs upright while held (a lantern by its ring) instead of turning with the hand. */
	bool bKeepUpright;

private:
	void SetPhysics(bool bSimulate);
	void UpdateGlow(float DeltaTime);

	struct FGlowMaterial
	{
		UMaterialInstanceDynamic* Material;
		FLinearColor BaseEmissive;
	};
	TArray<FGlowMaterial> GlowMaterials;

	ENuhoudGrabState State;
	bool bGrabEnabled = true;
	ENuhoudGrip HeldGrip;
	FTransform Home;
	FQuat HeldRelativeRotation;
	FVector HeldOffsetLocal;
	float HeldYaw;
	FVector MoveStart;
	FQuat MoveStartRotation;
	FTransform PlaceTarget;
	float MoveAlpha;
	float RestTimer;
	float FreeTimer;
	float Glow;
	float GlowTime;
	uint64 HighlightFrame;
};

/** A date in the bowl: pinch it, serve it, or eat it. */
UCLASS()
class NUHOUD_API ANuhoudDate : public ANuhoudGrabbable
{
	GENERATED_BODY()

public:
	ANuhoudDate();
	virtual void Tick(float DeltaTime) override;

	/** Disappears into the patient's mouth, then a fresh date appears back in the bowl. */
	void Eat();

protected:
	virtual void BuildVisuals() override;

private:
	enum class EEatPhase : uint8 { None, Shrinking, Waiting, Growing };
	EEatPhase EatPhase;
	float EatTimer;
};

/** Small porcelain coffee cup. */
UCLASS()
class NUHOUD_API ANuhoudFinjan : public ANuhoudGrabbable
{
	GENERATED_BODY()

public:
	ANuhoudFinjan();

protected:
	virtual void BuildVisuals() override;
};

/** Brass coffee pot, held by its handle. */
UCLASS()
class NUHOUD_API ANuhoudDallah : public ANuhoudGrabbable
{
	GENERATED_BODY()

public:
	ANuhoudDallah();

protected:
	virtual void BuildVisuals() override;
};
