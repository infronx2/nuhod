#include "NuhoudInputAdapter.h"
#include "NuhoudFirstPersonPawn.h"
#include "NuhoudGameInstance.h"
#include "EngineUtils.h"

namespace
{
	// Brief tracking dropouts keep the last pose instead of flickering the hand off.
	constexpr double TrackingGraceSeconds = 0.35;
	constexpr float PalmBeyondWristCm = 7.f;

	// Grip detection. Finger tracking often drops while a fist is closed, so a held object
	// keeps the last grip state until fresh data says the hand opened.
	constexpr double HandStaleSeconds = 0.6;
	constexpr float ClosureCeilingDecayPerSecond = 0.01f;
	constexpr float PinchMarginCm = 1.8f;
	constexpr float PinchOnMinCm = 3.5f;
	constexpr float PinchOnMaxCm = 5.5f;
	constexpr float PinchReleaseExtraCm = 1.5f;
	constexpr float PinchFloorRisePerSecond = 0.05f;

	// Reach is measured as the patient sees it on screen (see ANuhoudFirstPersonPawn::PerceivedDistance).
	constexpr float PinchReachCm = 6.f;
	constexpr float GraspReachCm = 8.f;
	constexpr double GrabWindowSeconds = 0.8;
	constexpr float DwellGrabSeconds = 0.3f;
	constexpr float MaxWristBendDeg = 70.f;
	constexpr float GripLogSeconds = 2.f;

	FVector ClampToCone(const FVector& Dir, const FVector& Axis, float MaxDeg)
	{
		const float Cos = FVector::DotProduct(Dir, Axis);
		const float MaxCos = FMath::Cos(FMath::DegreesToRadians(MaxDeg));
		if (Cos >= MaxCos) return Dir;
		const FVector Side = (Dir - Axis * Cos).GetSafeNormal();
		if (Side.IsNearlyZero()) return Axis;
		return Axis * MaxCos + Side * FMath::Sin(FMath::DegreesToRadians(MaxDeg));
	}
}

ANuhoudInputAdapter::ANuhoudInputAdapter()
{
	PrimaryActorTick.bCanEverTick = true;
	RightHand = nullptr;
	LeftHand = nullptr;
	ViewPawn = nullptr;

	RightState.ShoulderLocal = FVector(-4.f, 17.f, -24.f);
	LeftState.ShoulderLocal = FVector(-4.f, -17.f, -24.f);
}

void ANuhoudInputAdapter::BeginPlay()
{
	Super::BeginPlay();

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	RightHand = GetWorld()->SpawnActor<ANuhoudRiggedHand>(ANuhoudRiggedHand::StaticClass(), FTransform::Identity, Params);
	LeftHand = GetWorld()->SpawnActor<ANuhoudRiggedHand>(ANuhoudRiggedHand::StaticClass(), FTransform::Identity, Params);
	if (RightHand) RightHand->InitializeHand(ENuhoudHandSide::Right);
	if (LeftHand) LeftHand->InitializeHand(ENuhoudHandSide::Left);
}

void ANuhoudInputAdapter::SetArmSample(ENuhoudHandSide Side, const FNuhoudArmSample& Sample)
{
	FSideState& S = State(Side);
	S.Arm = Sample;
	if (!Sample.bTracked) return;

	S.LastArmTime = GetWorld()->GetTimeSeconds();
	S.ShoulderLocal = Sample.Shoulder;
	if (Sample.UpperArmCm > 10.f && Sample.ForearmCm > 10.f)
	{
		S.Reach = Sample.UpperArmCm + Sample.ForearmCm + PalmBeyondWristCm;
	}
}

void ANuhoudInputAdapter::SetHandSample(ENuhoudHandSide Side, const FNuhoudHandSample& Sample)
{
	FSideState& S = State(Side);
	S.Hand = Sample;
	if (Sample.bTracked)
	{
		S.LastHandTime = GetWorld()->GetTimeSeconds();
	}
}

void ANuhoudInputAdapter::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	UpdateHand(ENuhoudHandSide::Right);
	UpdateHand(ENuhoudHandSide::Left);
	UpdateGrip(ENuhoudHandSide::Right, DeltaTime);
	UpdateGrip(ENuhoudHandSide::Left, DeltaTime);
}

void ANuhoudInputAdapter::UpdateHand(ENuhoudHandSide Side)
{
	ANuhoudRiggedHand* H = Hand(Side);
	if (!H || !ViewPawn) return;

	const double Now = GetWorld()->GetTimeSeconds();
	const FSideState& S = State(Side);
	const bool bArmFresh = Now - S.LastArmTime < TrackingGraceSeconds;
	H->SetHandVisible(bArmFresh);
	if (!bArmFresh) return;

	const bool bHandFresh = Now - S.LastHandTime < TrackingGraceSeconds;
	const FVector Forearm = (S.Arm.Wrist - S.Arm.Elbow).GetSafeNormal();
	FVector DirLocal = S.Hand.Dir.GetSafeNormal();
	FVector PalmLocal = S.Hand.PalmNormal;
	if (!bHandFresh)
	{
		// No finger tracking: point the hand along the forearm, palm facing down.
		DirLocal = Forearm;
		PalmLocal = -FVector::UpVector - DirLocal * FVector::DotProduct(-FVector::UpVector, DirLocal);
		if (PalmLocal.IsNearlyZero()) PalmLocal = FVector::ForwardVector;
	}
	else if (!Forearm.IsNearlyZero())
	{
		// A real wrist bends at most ~70 degrees; anything more is tracking noise and looks broken.
		DirLocal = ClampToCone(DirLocal, Forearm, MaxWristBendDeg);
	}

	const FTransform Body = ViewPawn->GetBodyFrame();
	H->SetTargetPose(
		Body.TransformPosition(S.Arm.Wrist),
		Body.TransformVectorNoScale(DirLocal.GetSafeNormal()),
		Body.TransformVectorNoScale(PalmLocal.GetSafeNormal()));
	H->SetElbowTarget(Body.TransformPosition(S.Arm.Elbow));

	// Keep a closed hand closed through dropouts so a held object is not shown slipping out.
	const bool bKeepGripPose = !bHandFresh && S.Held.IsValid();
	if (!bKeepGripPose)
	{
		H->SetFingerCurls(bHandFresh ? S.Hand.Curls : TArray<FVector>());
	}
}

float ANuhoudInputAdapter::ComputeClosure(const TArray<FVector>& Curls)
{
	if (Curls.Num() < 5) return 0.f;
	float Sum = 0.f;
	for (int32 f = 1; f < 5; f++)
	{
		Sum += (Curls[f].X + Curls[f].Y) * 0.5f;
	}
	// About 15 degrees average MCP/PIP flexion for a relaxed open hand, about 70 for a firm fist.
	return FMath::Clamp((Sum / 4.f - 15.f) / 55.f, 0.f, 1.f);
}

void ANuhoudInputAdapter::UpdateGripState(FSideState& S, float DeltaTime)
{
	const double Now = GetWorld()->GetTimeSeconds();
	if (Now - S.LastHandTime > HandStaleSeconds) return;

	S.Closure = ComputeClosure(S.Hand.Curls);

	// The grasp threshold follows the patient's best recent closure, so a weak grip still registers.
	S.ClosureCeiling = FMath::Max(S.Closure, S.ClosureCeiling - DeltaTime * ClosureCeilingDecayPerSecond);
	S.GraspOn = FMath::Clamp(S.ClosureCeiling * 0.62f, 0.3f, 0.55f);
	const float GraspOff = S.GraspOn * 0.6f;

	// The pinch threshold sits just above the patient's own best pinch: cameras rarely measure
	// touching fingertips as touching, so a fixed small threshold misses real pinches.
	S.PinchFloor = FMath::Min(S.Hand.PinchCm, S.PinchFloor + DeltaTime * PinchFloorRisePerSecond);
	S.PinchOnCm = FMath::Clamp(S.PinchFloor + PinchMarginCm, PinchOnMinCm, PinchOnMaxCm);

	const bool bGrasp = S.bGrasping ? S.Closure > GraspOff : S.Closure > S.GraspOn;
	const bool bPinch = S.bPinching
		? S.Hand.PinchCm < S.PinchOnCm + PinchReleaseExtraCm
		: S.Hand.PinchCm < S.PinchOnCm;
	if (bGrasp && !S.bGrasping) S.GraspStartTime = Now;
	if (bPinch && !S.bPinching) S.PinchStartTime = Now;
	S.bGrasping = bGrasp;
	S.bPinching = bPinch;

	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->RecordGripSample(S.Closure, S.Hand.PinchCm);
	}
}

FTransform ANuhoudInputAdapter::GripFrame(const ANuhoudRiggedHand* H, ENuhoudGrip Grip)
{
	return FTransform(H->GetActorQuat(), Grip == ENuhoudGrip::Pinch ? H->GetPinchPoint() : H->GetGraspPoint());
}

float ANuhoudInputAdapter::Perceived(const FVector& A, const FVector& B) const
{
	return ViewPawn ? ViewPawn->PerceivedDistance(A, B) : FVector::Dist(A, B);
}

ANuhoudGrabbable* ANuhoudInputAdapter::FindGrabbable(const FVector& Point, ENuhoudGrip Grip, float Radius, FVector& OutGrabPoint) const
{
	ANuhoudGrabbable* Best = nullptr;
	float BestDist = Radius;
	for (TActorIterator<ANuhoudGrabbable> It(GetWorld()); It; ++It)
	{
		ANuhoudGrabbable* G = *It;
		if (!G->CanBeGrabbed() || !G->AllowsGrip(Grip)) continue;
		const FVector Surface = G->ClosestSurfacePoint(Point);
		const float Dist = Perceived(Point, Surface);
		if (Dist < BestDist)
		{
			BestDist = Dist;
			Best = G;
			OutGrabPoint = Surface;
		}
	}
	return Best;
}

void ANuhoudInputAdapter::Grab(FSideState& S, const ANuhoudRiggedHand* H, ANuhoudGrabbable* Target, ENuhoudGrip Grip, const FVector& GrabPoint)
{
	Target->BeginGrab(Grip, GripFrame(H, Grip), GrabPoint);
	S.Held = Target;
	S.HeldGrip = Grip;
	S.DwellTarget.Reset();
	S.DwellTime = 0.f;
	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->RecordGrab(Grip == ENuhoudGrip::Pinch, &S == &RightState);
	}
}

void ANuhoudInputAdapter::DropHeld(FSideState& S, const FVector& Velocity)
{
	if (ANuhoudGrabbable* Held = S.Held.Get())
	{
		Held->Release(Velocity);
	}
	S.Held.Reset();
}

void ANuhoudInputAdapter::UpdateGrip(ENuhoudHandSide Side, float DeltaTime)
{
	FSideState& S = State(Side);
	ANuhoudRiggedHand* H = Hand(Side);

	if (!H || !H->IsHandVisible())
	{
		DropHeld(S, FVector::ZeroVector);
		S.bHasPrevPalm = false;
		S.bGrasping = false;
		S.bPinching = false;
		S.DwellTarget.Reset();
		return;
	}

	const FVector Palm = H->GetPalmLocation();
	if (S.bHasPrevPalm && DeltaTime > KINDA_SMALL_NUMBER)
	{
		S.PalmVelocity = FMath::Lerp(S.PalmVelocity, (Palm - S.PrevPalm) / DeltaTime, 0.35f);
	}
	S.PrevPalm = Palm;
	S.bHasPrevPalm = true;

	UpdateGripState(S, DeltaTime);

	// Tell the patient the camera saw the grip: the hand glows faintly while closed, more while holding.
	const bool bGripping = S.bPinching || S.bGrasping;
	H->SetGripFeedback(S.Held.IsValid() ? 1.f : (bGripping ? 0.6f : 0.f));

	S.LogTimer += DeltaTime;
	if (S.LogTimer >= GripLogSeconds)
	{
		S.LogTimer = 0.f;
		LogGrip(Side, S, H);
	}

	if (ANuhoudGrabbable* Held = S.Held.Get())
	{
		if (Held->GetState() != ENuhoudGrabState::Held)
		{
			// The session placed or consumed it (hung on the hook, eaten, served).
			S.Held.Reset();
		}
		else if (S.HeldGrip == ENuhoudGrip::Pinch ? bGripping : S.bGrasping)
		{
			Held->UpdateHeld(GripFrame(H, S.HeldGrip), DeltaTime);
			return;
		}
		else
		{
			DropHeld(S, S.PalmVelocity);
		}
	}
	else
	{
		S.Held.Reset();
	}

	FVector GrabPoint = FVector::ZeroVector;
	ANuhoudGrabbable* Target = nullptr;
	ENuhoudGrip Grip = ENuhoudGrip::Pinch;
	if (S.bPinching)
	{
		Target = FindGrabbable(H->GetPinchPoint(), ENuhoudGrip::Pinch, PinchReachCm, GrabPoint);
	}
	if (!Target && S.bGrasping)
	{
		Target = FindGrabbable(H->GetGraspPoint(), ENuhoudGrip::Grasp, GraspReachCm, GrabPoint);
		Grip = ENuhoudGrip::Grasp;
	}

	if (Target)
	{
		// Grab when the hand closes on the object, or when an already-closed hand rests on it briefly.
		const double Now = GetWorld()->GetTimeSeconds();
		const double GripStart = Grip == ENuhoudGrip::Pinch ? S.PinchStartTime : S.GraspStartTime;
		S.DwellTime = S.DwellTarget.Get() == Target ? S.DwellTime + DeltaTime : 0.f;
		S.DwellTarget = Target;
		if (Now - GripStart < GrabWindowSeconds || S.DwellTime >= DwellGrabSeconds)
		{
			Grab(S, H, Target, Grip, GrabPoint);
			return;
		}
	}
	else
	{
		S.DwellTarget.Reset();
		S.DwellTime = 0.f;
	}

	// Glow whatever the hand could pick up right now.
	FVector Unused;
	ANuhoudGrabbable* Near = FindGrabbable(H->GetPinchPoint(), ENuhoudGrip::Pinch, PinchReachCm * 1.6f, Unused);
	if (!Near) Near = FindGrabbable(H->GetGraspPoint(), ENuhoudGrip::Grasp, GraspReachCm * 1.5f, Unused);
	if (Near) Near->RequestHighlight();
}

void ANuhoudInputAdapter::LogGrip(ENuhoudHandSide Side, const FSideState& S, const ANuhoudRiggedHand* H) const
{
	const FVector Point = H->GetGraspPoint();
	FString NearName = TEXT("none");
	float NearDist = TNumericLimits<float>::Max();
	for (TActorIterator<ANuhoudGrabbable> It(GetWorld()); It; ++It)
	{
		const float Dist = Perceived(Point, It->ClosestSurfacePoint(Point));
		if (Dist < NearDist)
		{
			NearDist = Dist;
			NearName = It->GetClass()->GetName();
		}
	}
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: grip %s closure=%.2f (grasp at %.2f) pinch=%.1fcm (pinch under %.1f) %s%s held=%s nearest=%s %.0fcm"),
		Side == ENuhoudHandSide::Right ? TEXT("R") : TEXT("L"), S.Closure, S.GraspOn, S.Hand.PinchCm, S.PinchOnCm,
		S.bGrasping ? TEXT("GRASP ") : TEXT(""), S.bPinching ? TEXT("PINCH ") : TEXT(""),
		S.Held.IsValid() ? *S.Held->GetClass()->GetName() : TEXT("-"), *NearName, NearDist);
}

FString ANuhoudInputAdapter::DescribeGrip(ENuhoudHandSide Side) const
{
	const FSideState& S = State(Side);
	const TCHAR* Status = S.Held.IsValid() ? TEXT(" HOLDING") : (S.bGrasping ? TEXT(" FIST") : (S.bPinching ? TEXT(" PINCH") : TEXT("")));
	return FString::Printf(TEXT("grip %d%%  pinch %.1fcm%s"), FMath::RoundToInt(S.Closure * 100.f), S.Hand.PinchCm, Status);
}

bool ANuhoudInputAdapter::IsHandVisible(ENuhoudHandSide Side) const
{
	const ANuhoudRiggedHand* H = Hand(Side);
	return H && H->IsHandVisible();
}

FVector ANuhoudInputAdapter::GetPalmLocation(ENuhoudHandSide Side) const
{
	const ANuhoudRiggedHand* H = Hand(Side);
	return H ? H->GetPalmLocation() : FVector::ZeroVector;
}

void ANuhoudInputAdapter::GetInteractionPoints(TArray<FVector>& OutPoints) const
{
	OutPoints.Reset();
	for (ENuhoudHandSide Side : { ENuhoudHandSide::Right, ENuhoudHandSide::Left })
	{
		if (IsHandVisible(Side))
		{
			OutPoints.Add(GetPalmLocation(Side));
		}
	}
}
