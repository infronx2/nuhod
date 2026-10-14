#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "NuhoudFirstPersonPawn.generated.h"

class UCameraComponent;

/** Seated patient's head. The camera sits at the eyes; tracked hands are placed relative to it. */
UCLASS()
class NUHOUD_API ANuhoudFirstPersonPawn : public APawn
{
	GENERATED_BODY()

public:
	ANuhoudFirstPersonPawn();

	/** Eye height above the floor in cm (cross-legged on a majlis floor cushion). */
	UPROPERTY(EditAnywhere, Category = "Nuhoud|View")
	float EyeHeight;

	/** Downward look angle so the table and hands are in view. */
	UPROPERTY(EditAnywhere, Category = "Nuhoud|View")
	float ViewPitch;

	UPROPERTY(EditAnywhere, Category = "Nuhoud|View")
	float FieldOfView;

	/** Places the seated patient so their eyes end up at EyesLocation, facing Yaw. */
	void SeatAt(const FVector& EyesLocation, float Yaw);

	/**
	 * Hands the view to a VR headset: the camera follows the patient's head from the seated eye
	 * position, and depth no longer needs the flat-screen allowance.
	 */
	void UseHeadsetView();
	bool IsHeadsetView() const { return bHeadsetView; }

	/** Seated eye position with yaw-only rotation: the frame tracking data is expressed in. */
	FTransform GetBodyFrame() const;

	/**
	 * How far apart A and B look to the patient. On a flat screen offsets along the line of sight
	 * (depth) are divided by 2.5, because depth is the hardest thing to judge on a monitor; a
	 * headset shows depth, so there they count fully.
	 */
	float PerceivedDistance(const FVector& A, const FVector& B) const;

protected:
	virtual void OnConstruction(const FTransform& Transform) override;

private:
	UPROPERTY(VisibleAnywhere)
	USceneComponent* Seat;

	/** The seated eye position. A headset moves the camera relative to it. */
	UPROPERTY(VisibleAnywhere)
	USceneComponent* HeadOrigin;

	UPROPERTY(VisibleAnywhere)
	UCameraComponent* Eyes;

	bool bHeadsetView;
};
