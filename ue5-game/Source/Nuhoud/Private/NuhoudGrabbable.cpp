#include "NuhoudGrabbable.h"
#include "NuhoudProceduralAssets.h"
#include "Components/BoxComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SphereComponent.h"
#include "Engine/CollisionProfile.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"

namespace
{
	constexpr float PlaceSeconds = 0.25f;
	constexpr float ReturnSeconds = 0.9f;
	constexpr float RestSpeed = 4.f;
	constexpr float RestSecondsBeforeReturn = 1.2f;
	constexpr float MaxFreeSeconds = 6.f;
	constexpr float MaxThrowSpeed = 250.f;
	const FLinearColor HighlightColor(1.f, 0.62f, 0.25f);
	const FLinearColor Brass(0.62f, 0.46f, 0.24f);
}

// ── Base ───────────────────────────────────────────────────────────────────

ANuhoudGrabbable::ANuhoudGrabbable()
{
	PrimaryActorTick.bCanEverTick = true;

	Visual = CreateDefaultSubobject<USceneComponent>(TEXT("Visual"));
	Body = nullptr;

	GrabAnchorLocal = FVector::ZeroVector;
	RestHeight = 0.f;
	MassKg = 0.1f;
	bAllowPinch = true;
	bAllowGrasp = true;
	bKeepUpright = false;

	State = ENuhoudGrabState::Home;
	HeldGrip = ENuhoudGrip::Grasp;
	Home = FTransform::Identity;
	HeldRelativeRotation = FQuat::Identity;
	HeldOffsetLocal = FVector::ZeroVector;
	HeldYaw = 0.f;
	MoveStart = FVector::ZeroVector;
	MoveStartRotation = FQuat::Identity;
	PlaceTarget = FTransform::Identity;
	MoveAlpha = 1.f;
	RestTimer = 0.f;
	FreeTimer = 0.f;
	Glow = 0.f;
	GlowTime = 0.f;
	HighlightFrame = 0;
}

void ANuhoudGrabbable::BeginPlay()
{
	Super::BeginPlay();

	Body->SetCollisionProfileName(UCollisionProfile::PhysicsActor_ProfileName);
	Body->SetUseCCD(true);
	Body->SetLinearDamping(0.4f);
	Body->SetAngularDamping(2.5f);
	Body->SetMassOverrideInKg(NAME_None, MassKg, true);
	Body->SetSimulatePhysics(false);

	Home = GetActorTransform();
	BuildVisuals();
}

bool ANuhoudGrabbable::CanBeGrabbed() const
{
	return State == ENuhoudGrabState::Home || State == ENuhoudGrabState::Free || State == ENuhoudGrabState::Returning;
}

void ANuhoudGrabbable::SetPhysics(bool bSimulate)
{
	Body->SetSimulatePhysics(bSimulate);
	if (!bSimulate)
	{
		RestTimer = 0.f;
		FreeTimer = 0.f;
	}
}

void ANuhoudGrabbable::SetHome(const FTransform& InHome)
{
	Home = InHome;
	SnapHome();
}

void ANuhoudGrabbable::SnapHome()
{
	SetPhysics(false);
	SetActorTransform(Home);
	State = ENuhoudGrabState::Home;
}

FVector ANuhoudGrabbable::ClosestSurfacePoint(const FVector& Point) const
{
	FVector Closest;
	return Body->GetClosestPointOnCollision(Point, Closest) >= 0.f ? Closest : GetGrabAnchor();
}

void ANuhoudGrabbable::BeginGrab(ENuhoudGrip Grip, const FTransform& GripFrame, const FVector& GrabPoint)
{
	SetPhysics(false);
	HeldGrip = Grip;
	HeldRelativeRotation = GripFrame.GetRotation().Inverse() * GetActorQuat();
	HeldOffsetLocal = GetActorTransform().InverseTransformPosition(GrabPoint);
	HeldYaw = GetActorRotation().Yaw;
	State = ENuhoudGrabState::Held;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: grabbed %s with %s"), *GetClass()->GetName(),
		Grip == ENuhoudGrip::Pinch ? TEXT("pinch") : TEXT("grasp"));
	OnGrabbed.ExecuteIfBound(this, Grip);
}

void ANuhoudGrabbable::UpdateHeld(const FTransform& GripFrame, float DeltaTime)
{
	if (State != ENuhoudGrabState::Held) return;

	const FQuat TargetRotation = bKeepUpright
		? FRotator(0.f, HeldYaw, 0.f).Quaternion()
		: GripFrame.GetRotation() * HeldRelativeRotation;
	const FVector TargetLocation = GripFrame.GetLocation() - TargetRotation.RotateVector(HeldOffsetLocal);

	// Converges within a few frames, so grabbing slightly off-centre slides the object into the fingers.
	SetActorLocationAndRotation(
		FMath::VInterpTo(GetActorLocation(), TargetLocation, DeltaTime, 28.f),
		FMath::QInterpTo(GetActorQuat(), TargetRotation, DeltaTime, 18.f));
}

void ANuhoudGrabbable::Release(const FVector& Velocity)
{
	if (State != ENuhoudGrabState::Held) return;

	SetPhysics(true);
	Body->SetPhysicsLinearVelocity(Velocity.GetClampedToMaxSize(MaxThrowSpeed));
	State = ENuhoudGrabState::Free;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: released %s"), *GetClass()->GetName());
	OnReleased.ExecuteIfBound(this, HeldGrip);
}

void ANuhoudGrabbable::PlaceAt(const FTransform& Target)
{
	SetPhysics(false);
	MoveStart = GetActorLocation();
	MoveStartRotation = GetActorQuat();
	PlaceTarget = Target;
	MoveAlpha = 0.f;
	State = ENuhoudGrabState::Placed;
}

void ANuhoudGrabbable::ReturnHome()
{
	SetPhysics(false);
	MoveStart = GetActorLocation();
	MoveStartRotation = GetActorQuat();
	MoveAlpha = 0.f;
	State = ENuhoudGrabState::Returning;
}

void ANuhoudGrabbable::Freeze()
{
	SetPhysics(false);
	MoveAlpha = 1.f;
	State = ENuhoudGrabState::Placed;
}

void ANuhoudGrabbable::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	switch (State)
	{
	case ENuhoudGrabState::Free:
	{
		FreeTimer += DeltaTime;
		RestTimer = Body->GetPhysicsLinearVelocity().Size() < RestSpeed ? RestTimer + DeltaTime : 0.f;
		const bool bFellAway = GetActorLocation().Z < Home.GetLocation().Z - 150.f;
		if (RestTimer > RestSecondsBeforeReturn || FreeTimer > MaxFreeSeconds || bFellAway)
		{
			ReturnHome();
		}
		break;
	}
	case ENuhoudGrabState::Returning:
	{
		MoveAlpha = FMath::Min(1.f, MoveAlpha + DeltaTime / ReturnSeconds);
		const float A = FMath::SmoothStep(0.f, 1.f, MoveAlpha);
		const FVector Arc(0.f, 0.f, FMath::Sin(A * PI) * 8.f);
		SetActorLocationAndRotation(FMath::Lerp(MoveStart, Home.GetLocation(), A) + Arc,
			FQuat::Slerp(MoveStartRotation, Home.GetRotation(), A));
		if (MoveAlpha >= 1.f)
		{
			State = ENuhoudGrabState::Home;
		}
		break;
	}
	case ENuhoudGrabState::Placed:
		if (MoveAlpha < 1.f)
		{
			MoveAlpha = FMath::Min(1.f, MoveAlpha + DeltaTime / PlaceSeconds);
			const float A = FMath::SmoothStep(0.f, 1.f, MoveAlpha);
			SetActorLocationAndRotation(FMath::Lerp(MoveStart, PlaceTarget.GetLocation(), A),
				FQuat::Slerp(MoveStartRotation, PlaceTarget.GetRotation(), A));
		}
		break;
	default:
		break;
	}

	UpdateGlow(DeltaTime);
}

void ANuhoudGrabbable::UpdateGlow(float DeltaTime)
{
	const bool bHighlighted = GFrameCounter - HighlightFrame <= 1 && CanBeGrabbed();
	const float Target = bHighlighted ? 1.f : (State == ENuhoudGrabState::Held ? 0.35f : 0.f);
	const float Previous = Glow;
	Glow = FMath::FInterpTo(Glow, Target, DeltaTime, 10.f);
	GlowTime += DeltaTime;
	if (Glow < 0.002f && Previous < 0.002f) return;

	const float Pulse = Glow * (0.75f + 0.25f * FMath::Sin(GlowTime * 6.f));
	for (const FGlowMaterial& G : GlowMaterials)
	{
		G.Material->SetVectorParameterValue(TEXT("EmissiveColor"), G.BaseEmissive + HighlightColor * (0.35f * Pulse));
	}
}

UMaterialInstanceDynamic* ANuhoudGrabbable::MakeMaterial(const FLinearColor& BaseColor, float Metallic, float Roughness,
	const FLinearColor& Emissive, bool bHighlight)
{
	UMaterialInstanceDynamic* MID = FNuhoudProceduralAssets::MakeLitMaterial(this, BaseColor, Metallic, Roughness, Emissive);
	if (MID && bHighlight)
	{
		GlowMaterials.Add({ MID, Emissive });
	}
	return MID;
}

// ── Date ───────────────────────────────────────────────────────────────────

ANuhoudDate::ANuhoudDate()
{
	USphereComponent* Sphere = CreateBody<USphereComponent>(TEXT("Body"));
	Sphere->InitSphereRadius(1.25f);
	RestHeight = 1.25f;
	MassKg = 0.012f;
	EatPhase = EEatPhase::None;
	EatTimer = 0.f;
}

void ANuhoudDate::BuildVisuals()
{
	if (UProceduralMeshComponent* M = FNuhoudProceduralAssets::CreateIcosahedron(this, 1, 1.1f, 0.12f, Visual))
	{
		M->SetRelativeScale3D(FVector(1.7f, 1.f, 1.f));
		M->SetMaterial(0, MakeMaterial(FLinearColor(0.20f, 0.07f, 0.025f), 0.f, 0.3f));
	}
}

void ANuhoudDate::Eat()
{
	Freeze();
	EatPhase = EEatPhase::Shrinking;
	EatTimer = 0.f;
}

void ANuhoudDate::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (EatPhase == EEatPhase::None) return;

	EatTimer += DeltaTime;
	switch (EatPhase)
	{
	case EEatPhase::Shrinking:
		Visual->SetRelativeScale3D(FVector(FMath::Max(0.01f, 1.f - EatTimer / 0.25f)));
		if (EatTimer >= 0.25f)
		{
			Visual->SetVisibility(false, true);
			EatPhase = EEatPhase::Waiting;
			EatTimer = 0.f;
		}
		break;
	case EEatPhase::Waiting:
		if (EatTimer >= 1.5f)
		{
			SnapHome();
			Visual->SetVisibility(true, true);
			EatPhase = EEatPhase::Growing;
			EatTimer = 0.f;
		}
		break;
	case EEatPhase::Growing:
		Visual->SetRelativeScale3D(FVector(FMath::Clamp(EatTimer / 0.35f, 0.01f, 1.f)));
		if (EatTimer >= 0.35f)
		{
			EatPhase = EEatPhase::None;
		}
		break;
	default:
		break;
	}
}

// ── Finjan ─────────────────────────────────────────────────────────────────

ANuhoudFinjan::ANuhoudFinjan()
{
	UBoxComponent* Box = CreateBody<UBoxComponent>(TEXT("Body"));
	Box->InitBoxExtent(FVector(3.1f, 3.1f, 2.05f));
	Visual->SetRelativeLocation(FVector(0.f, 0.f, -2.05f));
	RestHeight = 2.05f;
	MassKg = 0.08f;
	GrabAnchorLocal = FVector(0.f, 0.f, 0.6f);
}

void ANuhoudFinjan::BuildVisuals()
{
	if (UProceduralMeshComponent* Cup = FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, 0.f}, {1.6f, 0.f}, {1.8f, 0.25f}, {2.2f, 1.6f}, {2.9f, 3.6f}, {3.1f, 4.f},
		{2.85f, 4.05f}, {2.6f, 3.5f}, {2.f, 1.7f}, {1.5f, 0.7f}, {0.f, 0.7f} }, 32, Visual))
	{
		Cup->SetMaterial(0, MakeMaterial(FLinearColor(0.88f, 0.84f, 0.76f), 0.f, 0.25f));
	}
	if (UProceduralMeshComponent* Rim = FNuhoudProceduralAssets::CreateLathe(this, {
		{2.95f, 3.9f}, {3.18f, 3.98f}, {3.18f, 4.1f}, {2.9f, 4.08f} }, 32, Visual))
	{
		Rim->SetMaterial(0, MakeMaterial(FLinearColor(0.85f, 0.62f, 0.2f), 1.f, 0.3f));
	}
}

// ── Dallah ─────────────────────────────────────────────────────────────────

ANuhoudDallah::ANuhoudDallah()
{
	UCapsuleComponent* Capsule = CreateBody<UCapsuleComponent>(TEXT("Body"));
	Capsule->InitCapsuleSize(6.8f, 14.3f);
	Visual->SetRelativeLocation(FVector(0.f, 0.f, -14.3f));
	RestHeight = 14.3f;
	MassKg = 0.9f;
	bAllowPinch = false;
	GrabAnchorLocal = FVector(-9.2f, 0.f, 0.5f);
}

void ANuhoudDallah::BuildVisuals()
{
	UMaterialInstanceDynamic* Metal = MakeMaterial(Brass, 1.f, 0.4f);

	if (UProceduralMeshComponent* Pot = FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, 0.f}, {5.2f, 0.f}, {5.6f, 0.4f}, {5.4f, 1.2f}, {6.6f, 4.5f}, {7.f, 7.f}, {6.4f, 9.5f},
		{4.6f, 11.8f}, {3.2f, 13.f}, {3.f, 14.5f}, {3.9f, 15.4f}, {3.6f, 16.4f}, {2.7f, 18.f}, {2.5f, 20.5f},
		{3.4f, 21.3f}, {3.6f, 22.f}, {2.9f, 23.2f}, {1.6f, 25.f}, {1.f, 26.f}, {1.2f, 27.f}, {0.6f, 28.2f}, {0.f, 28.6f} },
		36, Visual))
	{
		Pot->SetMaterial(0, Metal);
	}
	if (UProceduralMeshComponent* Spout = FNuhoudProceduralAssets::CreateTube(this,
		{ {4.f, 0.f, 12.f}, {7.f, 0.f, 14.2f}, {9.8f, 0.f, 17.6f}, {11.8f, 0.f, 21.f}, {13.4f, 0.f, 23.6f}, {14.6f, 0.f, 25.f} },
		{ 1.7f, 1.35f, 1.1f, 0.95f, 0.75f, 0.55f }, 12, Visual))
	{
		Spout->SetMaterial(0, Metal);
	}
	if (UProceduralMeshComponent* Handle = FNuhoudProceduralAssets::CreateTube(this,
		{ {-2.9f, 0.f, 21.6f}, {-6.f, 0.f, 22.2f}, {-8.6f, 0.f, 19.5f}, {-9.4f, 0.f, 14.5f}, {-8.4f, 0.f, 9.5f}, {-6.6f, 0.f, 6.5f} },
		{ 0.6f, 0.6f, 0.6f, 0.6f, 0.6f, 0.6f }, 8, Visual))
	{
		Handle->SetMaterial(0, Metal);
	}
	if (UProceduralMeshComponent* Finial = FNuhoudProceduralAssets::CreateIcosahedron(this, 1, 0.9f, 0.f, Visual))
	{
		Finial->SetRelativeLocation(FVector(0.f, 0.f, 28.9f));
		Finial->SetMaterial(0, Metal);
	}
}
