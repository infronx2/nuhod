#include "NuhoudRiggedHand.h"
#include "NuhoudProceduralAssets.h"
#include "Components/PoseableMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	const TCHAR* const FingerNames[5] = { TEXT("thumb"), TEXT("index"), TEXT("middle"), TEXT("ring"), TEXT("pinky") };
	constexpr float CurlInterpSpeed = 18.f;
	constexpr float MoveInterpSpeed = 22.f;
	constexpr float TurnInterpSpeed = 16.f;

	float SignedAngleDeg(const FVector& From, const FVector& To, const FVector& Axis)
	{
		const FVector A = From.GetSafeNormal();
		const FVector B = To.GetSafeNormal();
		return FMath::RadiansToDegrees(FMath::Atan2(
			FVector::DotProduct(FVector::CrossProduct(A, B), Axis), FVector::DotProduct(A, B)));
	}
}

ANuhoudRiggedHand::ANuhoudRiggedHand()
{
	PrimaryActorTick.bCanEverTick = true;

	SkinTint = FLinearColor(0.32f, 0.19f, 0.13f);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	HandMesh = CreateDefaultSubobject<UPoseableMeshComponent>(TEXT("HandMesh"));
	HandMesh->SetupAttachment(Root);
	HandMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	SkinMaterial = nullptr;
	Side = ENuhoudHandSide::Right;
	RestBasisInverse = FQuat::Identity;
	PalmBoneLocal = FVector::ZeroVector;
	PalmNormalLocal = -FVector::UpVector;
	TargetLocation = FVector::ZeroVector;
	TargetRotation = FQuat::Identity;
	bHasTarget = false;
	bVisibleState = true;
	bRigReady = false;
	bSnapElbow = true;
	Forearm = nullptr;
	ElbowTarget = FVector::ZeroVector;
	ElbowSmoothed = FVector::ZeroVector;
	GripFeedbackTarget = 0.f;
	GripFeedback = 0.f;
}

void ANuhoudRiggedHand::InitializeHand(ENuhoudHandSide InSide)
{
	Side = InSide;
	const TCHAR* MeshPath = Side == ENuhoudHandSide::Right
		? TEXT("/Game/Characters/MannequinsXR/Meshes/SKM_MannyXR_right.SKM_MannyXR_right")
		: TEXT("/Game/Characters/MannequinsXR/Meshes/SKM_MannyXR_left.SKM_MannyXR_left");

	USkeletalMesh* Mesh = LoadObject<USkeletalMesh>(nullptr, MeshPath);
	if (!Mesh)
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: hand mesh not found at %s"), MeshPath);
		return;
	}
	HandMesh->SetSkinnedAssetAndUpdate(Mesh);

	// Matte skin with a soft sheen; the mannequin's clear-coat plastic reads as chrome in a warm room.
	SkinMaterial = FNuhoudProceduralAssets::MakeLitMaterial(this, SkinTint, 0.f, 0.5f);
	if (SkinMaterial)
	{
		SkinMaterial->SetScalarParameterValue(TEXT("Specular"), 0.3f);
		for (int32 i = 0; i < HandMesh->GetNumMaterials(); i++)
		{
			HandMesh->SetMaterial(i, SkinMaterial);
		}
	}

	// Unit-length forearm along +Z (radii in cm), stretched each frame from inside the wrist to the tracked elbow.
	Forearm = FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, 0.f}, {2.6f, 0.f}, {2.85f, 0.04f}, {3.0f, 0.12f}, {3.6f, 0.4f}, {4.2f, 0.75f}, {4.4f, 0.93f}, {3.8f, 1.f}, {0.f, 1.f} },
		28, Root);
	if (Forearm)
	{
		Forearm->SetUsingAbsoluteLocation(true);
		Forearm->SetUsingAbsoluteRotation(true);
		Forearm->SetUsingAbsoluteScale(true);
		Forearm->SetMaterial(0, SkinMaterial);
	}

	BuildRig();
	SetHandVisible(false);
}

void ANuhoudRiggedHand::BuildRig()
{
	const TCHAR* Suffix = Side == ENuhoudHandSide::Right ? TEXT("r") : TEXT("l");
	auto Bone = [Suffix](const FString& Base) { return FName(*FString::Printf(TEXT("%s_%s"), *Base, Suffix)); };
	auto CS = [this](FName Name) { return HandMesh->GetBoneTransformByName(Name, EBoneSpaces::ComponentSpace); };

	const FName HandBone = Bone(TEXT("hand"));
	if (HandMesh->GetBoneIndex(HandBone) == INDEX_NONE)
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: bone %s missing from hand mesh"), *HandBone.ToString());
		return;
	}

	const FVector Wrist = CS(HandBone).GetLocation();
	const FVector FingerDir = (CS(Bone(TEXT("middle_01"))).GetLocation() - Wrist).GetSafeNormal();
	const FVector ThumbSide = (CS(Bone(TEXT("index_01"))).GetLocation() - CS(Bone(TEXT("pinky_01"))).GetLocation()).GetSafeNormal();
	FVector Palm = Side == ENuhoudHandSide::Right
		? FVector::CrossProduct(FingerDir, ThumbSide)
		: FVector::CrossProduct(ThumbSide, FingerDir);
	Palm = (Palm - FingerDir * FVector::DotProduct(Palm, FingerDir)).GetSafeNormal();

	RestBasisInverse = FRotationMatrix::MakeFromXZ(FingerDir, Palm).ToQuat().Inverse();
	PalmBoneLocal = CS(Bone(TEXT("palm"))).GetLocation();
	PalmNormalLocal = Palm;

	for (int32 f = 0; f < 5; f++)
	{
		FFingerRig& Rig = Fingers[f];
		for (int32 j = 0; j < 3; j++)
		{
			Rig.Bones[j] = Bone(FString::Printf(TEXT("%s_0%d"), FingerNames[f], j + 1));
		}
		const FName Parent = f == 0 ? HandBone : Bone(FString::Printf(TEXT("%s_metacarpal"), FingerNames[f]));

		const FVector P0 = CS(Parent).GetLocation();
		const FVector P1 = CS(Rig.Bones[0]).GetLocation();
		const FVector P2 = CS(Rig.Bones[1]).GetLocation();
		const FTransform T2 = CS(Rig.Bones[1]);
		const FTransform T3 = CS(Rig.Bones[2]);
		const FVector P3 = T3.GetLocation();

		// The distal bone has no child; carry the bone-axis convention of its parent to get its direction.
		const FVector BoneAxisLocal = T2.GetRotation().UnrotateVector((P3 - P2).GetSafeNormal());
		const FVector DistalDir = T3.GetRotation().RotateVector(BoneAxisLocal);
		const FVector Segments[4] = { P1 - P0, P2 - P1, P3 - P2, DistalDir };
		Rig.DistalAxisLocal = BoneAxisLocal;
		Rig.DistalLength = (P3 - P2).Size() * 0.9f;

		if (f == 0)
		{
			// The thumb flexes across the palm, so take its axis from the rest-pose bend plane.
			FVector Bend = FVector::CrossProduct(Segments[1], Segments[2]).GetSafeNormal()
				+ FVector::CrossProduct(Segments[2], Segments[3]).GetSafeNormal();
			if (Bend.SizeSquared() < 0.25f)
			{
				const FVector Toward = (Palm * 0.5f - ThumbSide).GetSafeNormal();
				Bend = FVector::CrossProduct((P3 - P1).GetSafeNormal(), Toward);
			}
			Rig.Axis = Bend.GetSafeNormal();
		}
		else
		{
			// Positive rotation about (finger x palm) curls the finger toward the palm.
			Rig.Axis = FVector::CrossProduct((P3 - P1).GetSafeNormal(), Palm).GetSafeNormal();
		}

		for (int32 j = 0; j < 3; j++)
		{
			Rig.RefCurl[j] = SignedAngleDeg(Segments[j], Segments[j + 1], Rig.Axis);
			Rig.CurrentCurl[j] = Rig.RefCurl[j];
			Rig.TargetCurl[j] = Rig.RefCurl[j];
		}
	}

	bRigReady = true;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: %s hand rig ready (index rest curl %.0f/%.0f/%.0f)"),
		Side == ENuhoudHandSide::Right ? TEXT("Right") : TEXT("Left"),
		Fingers[1].RefCurl[0], Fingers[1].RefCurl[1], Fingers[1].RefCurl[2]);
}

void ANuhoudRiggedHand::SetTargetPose(const FVector& WristWorld, const FVector& DirWorld, const FVector& PalmNormalWorld)
{
	TargetRotation = FRotationMatrix::MakeFromXZ(DirWorld, PalmNormalWorld).ToQuat() * RestBasisInverse;
	TargetLocation = WristWorld;
	if (!bHasTarget)
	{
		SetActorLocationAndRotation(TargetLocation, TargetRotation);
		bHasTarget = true;
	}
}

void ANuhoudRiggedHand::SetFingerCurls(const TArray<FVector>& Curls)
{
	for (int32 f = 0; f < 5; f++)
	{
		FFingerRig& Rig = Fingers[f];
		if (Curls.Num() < 5)
		{
			for (int32 j = 0; j < 3; j++) Rig.TargetCurl[j] = Rig.RefCurl[j];
			continue;
		}
		const float MaxCurl = f == 0 ? 80.f : 110.f;
		Rig.TargetCurl[0] = FMath::Clamp(Curls[f].X, -5.f, MaxCurl);
		Rig.TargetCurl[1] = FMath::Clamp(Curls[f].Y, -5.f, MaxCurl);
		Rig.TargetCurl[2] = FMath::Clamp(Curls[f].Z, -5.f, MaxCurl);
	}
}

void ANuhoudRiggedHand::SetHandVisible(bool bVisible)
{
	if (bVisible == bVisibleState) return;
	bVisibleState = bVisible;
	HandMesh->SetVisibility(bVisible);
	if (Forearm) Forearm->SetVisibility(bVisible);
	if (bVisible)
	{
		bHasTarget = false;
		bSnapElbow = true;
	}
}

FVector ANuhoudRiggedHand::GetPalmLocation() const
{
	return GetActorTransform().TransformPosition(PalmBoneLocal);
}

FVector ANuhoudRiggedHand::GetPalmNormal() const
{
	return GetActorQuat().RotateVector(PalmNormalLocal);
}

FVector ANuhoudRiggedHand::GetFingerTip(int32 Finger) const
{
	const FFingerRig& Rig = Fingers[FMath::Clamp(Finger, 0, 4)];
	const FTransform Distal = HandMesh->GetBoneTransformByName(Rig.Bones[2], EBoneSpaces::WorldSpace);
	return Distal.GetLocation() + Distal.GetRotation().RotateVector(Rig.DistalAxisLocal) * Rig.DistalLength;
}

FVector ANuhoudRiggedHand::GetPinchPoint() const
{
	return (GetFingerTip(0) + GetFingerTip(1)) * 0.5f;
}

FVector ANuhoudRiggedHand::GetGraspPoint() const
{
	return GetPalmLocation() + GetPalmNormal() * 3.5f;
}

void ANuhoudRiggedHand::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!bRigReady || !bVisibleState || !bHasTarget) return;

	SetActorLocationAndRotation(
		FMath::VInterpTo(GetActorLocation(), TargetLocation, DeltaTime, MoveInterpSpeed),
		FMath::QInterpTo(GetActorQuat(), TargetRotation, DeltaTime, TurnInterpSpeed));

	for (FFingerRig& Rig : Fingers)
	{
		for (int32 j = 0; j < 3; j++)
		{
			Rig.CurrentCurl[j] = FMath::FInterpTo(Rig.CurrentCurl[j], Rig.TargetCurl[j], DeltaTime, CurlInterpSpeed);
		}
	}
	ApplyFingers();
	UpdateForearm(DeltaTime);

	const float PreviousFeedback = GripFeedback;
	GripFeedback = FMath::FInterpTo(GripFeedback, GripFeedbackTarget, DeltaTime, 10.f);
	if (SkinMaterial && !FMath::IsNearlyEqual(GripFeedback, PreviousFeedback, 0.001f))
	{
		SkinMaterial->SetVectorParameterValue(TEXT("EmissiveColor"), FLinearColor(0.1f, 0.06f, 0.015f) * GripFeedback);
	}
}

void ANuhoudRiggedHand::UpdateForearm(float DeltaTime)
{
	if (!Forearm) return;

	ElbowSmoothed = bSnapElbow ? ElbowTarget : FMath::VInterpTo(ElbowSmoothed, ElbowTarget, DeltaTime, MoveInterpSpeed);
	bSnapElbow = false;

	const FVector Wrist = GetActorLocation();
	const FVector Along = ElbowSmoothed - Wrist;
	if (Along.IsNearlyZero()) return;
	const FVector Dir = Along.GetSafeNormal();

	// Start 2 cm inside the hand so the wrist has no seam, and roll the forearm with the palm so its
	// flatter side lines up with the back of the hand (the forearm turns when the palm turns).
	constexpr float WristOverlap = 2.f;
	const FVector Start = Wrist - Dir * WristOverlap;
	Forearm->SetWorldLocationAndRotation(Start, FRotationMatrix::MakeFromZX(Dir, GetPalmNormal()).ToQuat());
	Forearm->SetWorldScale3D(FVector(0.8f, 1.f, FMath::Clamp(Along.Size(), 10.f, 40.f) + WristOverlap));
}

void ANuhoudRiggedHand::ApplyFingers()
{
	for (const FFingerRig& Rig : Fingers)
	{
		for (int32 j = 0; j < 3; j++)
		{
			HandMesh->ResetBoneTransformByName(Rig.Bones[j]);
		}
		for (int32 j = 0; j < 3; j++)
		{
			const float Delta = Rig.CurrentCurl[j] - Rig.RefCurl[j];
			if (FMath::Abs(Delta) < 0.1f) continue;

			FTransform T = HandMesh->GetBoneTransformByName(Rig.Bones[j], EBoneSpaces::ComponentSpace);
			T.SetRotation(FQuat(Rig.Axis, FMath::DegreesToRadians(Delta)) * T.GetRotation());
			HandMesh->SetBoneTransformByName(Rig.Bones[j], T, EBoneSpaces::ComponentSpace);
		}
	}
}
