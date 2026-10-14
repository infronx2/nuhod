#include "NuhoudHeadset.h"
#include "NuhoudFirstPersonPawn.h"
#include "HeadMountedDisplayFunctionLibrary.h"
#include "HeadMountedDisplayTypes.h"
#include "IXRTrackingSystem.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "TimerManager.h"

namespace
{
	using K = EHandKeypoint;

	// Adult seated shoulders relative to the eyes (the input adapter's defaults), indexed by ENuhoudHandSide.
	const FVector ShoulderLocal[2] = { FVector(-4.f, -17.f, -24.f), FVector(-4.f, 17.f, -24.f) };
	constexpr float UpperArmCm = 30.f;
	constexpr float ForearmCm = 26.f;
	constexpr float PinchingCm = 3.5f;

	// Joints per finger in pose_server.py order: knuckle the finger bends from, then the two
	// joints above it, then the tip (MediaPipe 1-4 for the thumb, 5-8 index, ... 17-20 pinky).
	const K FingerJoints[5][4] = {
		{ K::ThumbMetacarpal, K::ThumbProximal, K::ThumbDistal, K::ThumbTip },
		{ K::IndexProximal, K::IndexIntermediate, K::IndexDistal, K::IndexTip },
		{ K::MiddleProximal, K::MiddleIntermediate, K::MiddleDistal, K::MiddleTip },
		{ K::RingProximal, K::RingIntermediate, K::RingDistal, K::RingTip },
		{ K::LittleProximal, K::LittleIntermediate, K::LittleDistal, K::LittleTip },
	};

	float AngleDeg(const FVector& A, const FVector& B)
	{
		const float Denom = A.Size() * B.Size();
		if (Denom < KINDA_SMALL_NUMBER) return 0.f;
		return FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(A, B) / Denom, -1.f, 1.f)));
	}

	/** Bend at B of the chain A-B-C: 0 = straight, 90 = right angle. */
	float Flexion(const FVector& A, const FVector& B, const FVector& C)
	{
		return FMath::Max(0.f, 180.f - AngleDeg(A - B, C - B));
	}
}

bool FNuhoudHeadset::IsConnected()
{
	return GEngine && GEngine->XRSystem.IsValid() && UHeadMountedDisplayFunctionLibrary::IsHeadMountedDisplayConnected();
}

FString FNuhoudHeadset::DeviceName()
{
	if (!GEngine || !GEngine->XRSystem.IsValid()) return TEXT("no XR runtime");
	const FString System = GEngine->XRSystem->GetSystemName().ToString();
	// OpenXR only fills in the device name once a headset is connected; before that it is garbage.
	return IsConnected()
		? FString::Printf(TEXT("%s %s"), *System, *UHeadMountedDisplayFunctionLibrary::GetHMDDeviceName().ToString())
		: System;
}

void FNuhoudHeadset::StartSeatedView(ANuhoudFirstPersonPawn* Pawn)
{
	UHeadMountedDisplayFunctionLibrary::EnableHMD(true);
	UHeadMountedDisplayFunctionLibrary::SetTrackingOrigin(EHMDTrackingOrigin::Local);
	if (!Pawn) return;
	Pawn->UseHeadsetView();

	// Recentre once rendering in the headset has settled, so the patient's head as they sit now
	// becomes the virtual eyes, facing the table.
	auto Recentre = []()
	{
		UHeadMountedDisplayFunctionLibrary::ResetOrientationAndPosition(0.f, EOrientPositionSelector::OrientationAndPosition);
	};
	Recentre();
	FTimerHandle Handle;
	Pawn->GetWorldTimerManager().SetTimer(Handle, Recentre, 1.f, false);
}

bool FNuhoudHeadset::ReadHand(UObject* WorldContext, ENuhoudHandSide Side, const FTransform& BodyFrame,
	FNuhoudArmSample& OutArm, FNuhoudHandSample& OutHand)
{
	FXRHandTrackingState State;
	UHeadMountedDisplayFunctionLibrary::GetHandTrackingState(WorldContext, EXRSpaceType::UnrealWorldSpace,
		Side == ENuhoudHandSide::Right ? EControllerHand::Right : EControllerHand::Left, State);
	if (!State.bValid || State.TrackingStatus == ETrackingStatus::NotTracked || State.HandKeyLocations.Num() < EHandKeypointCount)
	{
		return false;
	}

	TArray<FVector, TInlineAllocator<EHandKeypointCount>> P;
	for (const FVector& World : State.HandKeyLocations)
	{
		P.Add(BodyFrame.InverseTransformPosition(World));
	}
	auto At = [&P](K Key) { return P[static_cast<int32>(Key)]; };
	auto Dist = [&At](K A, K B) { return FVector::Dist(At(A), At(B)); };

	// Hand frame and finger flexion, the way pose_server.py computes them from MediaPipe.
	const bool bRight = Side == ENuhoudHandSide::Right;
	const FVector Wrist = At(K::Wrist);
	const FVector FingerDir = (At(K::MiddleProximal) - Wrist).GetSafeNormal();
	const FVector ThumbSide = (At(K::IndexProximal) - At(K::LittleProximal)).GetSafeNormal();
	FVector Palm = bRight ? FVector::CrossProduct(FingerDir, ThumbSide) : FVector::CrossProduct(ThumbSide, FingerDir);
	Palm = (Palm - FingerDir * FVector::DotProduct(Palm, FingerDir)).GetSafeNormal();

	OutHand = FNuhoudHandSample();
	OutHand.bTracked = true;
	OutHand.Dir = FingerDir;
	OutHand.PalmNormal = Palm;
	OutHand.Curls.SetNum(5);
	for (int32 f = 0; f < 5; f++)
	{
		const K* J = FingerJoints[f];
		OutHand.Curls[f] = FVector(
			Flexion(Wrist, At(J[0]), At(J[1])),
			Flexion(At(J[0]), At(J[1]), At(J[2])),
			Flexion(At(J[1]), At(J[2]), At(J[3])));
	}

	const bool Extended[5] = {
		Dist(K::ThumbTip, K::LittleProximal) > Dist(K::ThumbDistal, K::LittleProximal),
		Dist(K::IndexTip, K::Wrist) > Dist(K::IndexIntermediate, K::Wrist),
		Dist(K::MiddleTip, K::Wrist) > Dist(K::MiddleIntermediate, K::Wrist),
		Dist(K::RingTip, K::Wrist) > Dist(K::RingIntermediate, K::Wrist),
		Dist(K::LittleTip, K::Wrist) > Dist(K::LittleIntermediate, K::Wrist),
	};
	int32 Count = 0;
	for (bool bExtended : Extended) Count += bExtended ? 1 : 0;
	OutHand.FingersExtended = Count;
	OutHand.PinchCm = Dist(K::ThumbTip, K::IndexTip);
	OutHand.bPinching = OutHand.PinchCm < PinchingCm;
	if (Count >= 4 && !OutHand.bPinching) OutHand.Gesture = TEXT("open");
	else if (Count <= 1 && !Extended[1]) OutHand.Gesture = TEXT("fist");
	else if (OutHand.bPinching) OutHand.Gesture = TEXT("pinch");
	else if (Extended[1] && Extended[2] && !Extended[3] && !Extended[4]) OutHand.Gesture = TEXT("peace");
	else if (Extended[1] && !Extended[2] && !Extended[3]) OutHand.Gesture = TEXT("point");
	else OutHand.Gesture = TEXT("partial");

	// Arm: shoulder from the seated body, elbow from a two-bone fit that hangs down and slightly out.
	const FVector Shoulder = ShoulderLocal[static_cast<int32>(Side)];
	const FVector ToWrist = Wrist - Shoulder;
	const FVector Reach = ToWrist.GetSafeNormal(KINDA_SMALL_NUMBER, FVector::ForwardVector);
	const float D = FMath::Clamp(ToWrist.Size(), 5.f, UpperArmCm + ForearmCm - 0.5f);
	const float Along = (UpperArmCm * UpperArmCm - ForearmCm * ForearmCm + D * D) / (2.f * D);
	const float Out = FMath::Sqrt(FMath::Max(UpperArmCm * UpperArmCm - Along * Along, 0.f));
	const FVector Lateral(0.f, bRight ? 1.f : -1.f, 0.f);
	FVector Pole = -FVector::UpVector + Lateral * 0.4f;
	Pole = (Pole - Reach * FVector::DotProduct(Pole, Reach)).GetSafeNormal(KINDA_SMALL_NUMBER, Lateral);
	const FVector Elbow = Shoulder + Reach * Along + Pole * Out;

	const FVector Upper = (Elbow - Shoulder).GetSafeNormal();
	const FVector Fore = (Wrist - Elbow).GetSafeNormal();
	const FVector Down = -FVector::UpVector;
	OutArm = FNuhoudArmSample();
	OutArm.bTracked = true;
	OutArm.Shoulder = Shoulder;
	OutArm.Elbow = Elbow;
	OutArm.Wrist = Wrist;
	OutArm.UpperArmCm = UpperArmCm;
	OutArm.ForearmCm = ForearmCm;
	OutArm.ShoulderElevation = AngleDeg(Upper, Down);
	OutArm.ShoulderFlexion = FMath::RadiansToDegrees(FMath::Atan2(Upper.X, FVector::DotProduct(Upper, Down)));
	OutArm.ShoulderAbduction = FMath::RadiansToDegrees(FMath::Atan2(FVector::DotProduct(Upper, Lateral), FVector::DotProduct(Upper, Down)));
	OutArm.ElbowAngle = AngleDeg(-Upper, Fore);
	return true;
}
