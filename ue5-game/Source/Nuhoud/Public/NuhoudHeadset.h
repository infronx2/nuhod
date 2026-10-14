#pragma once

#include "CoreMinimal.h"
#include "NuhoudInputAdapter.h"

class ANuhoudFirstPersonPawn;

/** VR headset support: detection, the seated head view, and headset hand tracking as tracking samples. */
struct NUHOUD_API FNuhoudHeadset
{
	/** True when an OpenXR headset is connected and ready (not just a runtime installed). */
	static bool IsConnected();

	static FString DeviceName();

	/** Switches rendering to the headset and seats the patient's real head at the pawn's eyes. */
	static void StartSeatedView(ANuhoudFirstPersonPawn* Pawn);

	/**
	 * Reads one tracked hand from the headset and expresses it like a pose-server sample (cm
	 * relative to the seated eyes, axes forward/right/up). The headset sees no shoulder or elbow,
	 * so those come from an adult seated shoulder and a two-bone arm fitted to the tracked wrist.
	 */
	static bool ReadHand(UObject* WorldContext, ENuhoudHandSide Side, const FTransform& BodyFrame,
		FNuhoudArmSample& OutArm, FNuhoudHandSample& OutHand);
};
