#include "NuhoudLantern.h"
#include "NuhoudProceduralAssets.h"
#include "Components/CapsuleComponent.h"
#include "Components/PointLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"

namespace
{
	const FLinearColor Brass(0.62f, 0.46f, 0.24f);
	const FLinearColor WarmGlow(1.f, 0.55f, 0.18f);
	constexpr float LitLumens = 90.f;
	// The lantern geometry spans z -8..11.6 around its own centre; the visual is shifted so the body is centred.
	constexpr float VisualOffsetZ = -1.8f;
	constexpr float RingTopZ = 10.6f;
}

ANuhoudLantern::ANuhoudLantern()
{
	UCapsuleComponent* Capsule = CreateBody<UCapsuleComponent>(TEXT("Body"));
	Capsule->InitCapsuleSize(5.5f, 9.8f);
	Visual->SetRelativeLocation(FVector(0.f, 0.f, VisualOffsetZ));

	Light = CreateDefaultSubobject<UPointLightComponent>(TEXT("Light"));
	Light->SetupAttachment(Visual);
	Light->SetRelativeLocation(FVector(0.f, 0.f, -1.f));
	Light->SetIntensityUnits(ELightUnits::Lumens);
	Light->SetIntensity(0.f);
	Light->SetLightColor(FLinearColor(1.f, 0.68f, 0.38f));
	Light->SetAttenuationRadius(350.f);
	Light->SetSourceRadius(2.f);
	Light->SetCastShadows(false);

	RestHeight = 9.8f;
	MassKg = 0.6f;
	bKeepUpright = true;
	GrabAnchorLocal = FVector(0.f, 0.f, 10.3f + VisualOffsetZ);

	// Measured to the lantern's surface; a real camera placed palms resting on it 12-14 cm away.
	TouchRadius = 16.f;
	SecondsToLightByTouch = 2.5f;
	NearestPalm = TNumericLimits<float>::Max();

	GlassMaterial = nullptr;
	FlameMaterial = nullptr;
	BrassMaterial = nullptr;
	HangTarget = FVector::ZeroVector;
	CeilingHeight = 0.f;
	TouchProgress = 0.f;
	Proximity = 0.f;
	Glow = 0.f;
	BobTime = 0.f;
	bLit = false;
	bAllowTouchLighting = false;
	bDecoration = false;
	bChainAdded = false;
}

void ANuhoudLantern::BuildVisuals()
{
	BobTime = FMath::FRand() * 6.28f;
	BrassMaterial = MakeMaterial(Brass, 1.f, 0.4f);
	GlassMaterial = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.9f, 0.75f, 0.45f), 0.f, 0.12f);
	FlameMaterial = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(1.f, 0.7f, 0.3f), 0.f, 0.5f);

	auto Brassify = [this](UProceduralMeshComponent* M) { if (M) M->SetMaterial(0, BrassMaterial); };

	Brassify(FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, -8.f}, {5.f, -8.f}, {5.3f, -7.3f}, {4.9f, -6.4f}, {4.5f, -6.f}, {0.f, -6.f} }, 28, Visual));

	if (UProceduralMeshComponent* Glass = FNuhoudProceduralAssets::CreateLathe(this, {
		{4.3f, -6.f}, {4.7f, -3.f}, {4.8f, 0.f}, {4.6f, 2.5f}, {4.2f, 3.4f} }, 28, Visual))
	{
		Glass->SetMaterial(0, GlassMaterial);
	}

	Brassify(FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, 3.2f}, {4.7f, 3.2f}, {5.1f, 3.8f}, {4.4f, 4.6f}, {3.f, 6.2f}, {1.6f, 7.4f},
		{1.1f, 7.8f}, {1.1f, 8.6f}, {0.6f, 9.2f}, {0.f, 9.3f} }, 28, Visual));

	for (int32 i = 0; i < 4; i++)
	{
		const float A = HALF_PI * i + PI / 4.f;
		const FVector D(FMath::Cos(A), FMath::Sin(A), 0.f);
		Brassify(FNuhoudProceduralAssets::CreateTube(this,
			{ D * 4.6f + FVector(0, 0, -6.2f), D * 5.0f + FVector(0, 0, -1.5f), D * 4.95f + FVector(0, 0, 1.f), D * 4.5f + FVector(0, 0, 3.3f) },
			{ 0.35f, 0.35f, 0.35f, 0.35f }, 6, Visual));
	}

	TArray<FVector> RingPath;
	TArray<float> RingRadii;
	for (int32 i = 0; i <= 16; i++)
	{
		const float A = 2.f * PI * i / 16.f;
		RingPath.Add(FVector(FMath::Cos(A) * 1.3f, 0.f, 10.3f + FMath::Sin(A) * 1.3f));
		RingRadii.Add(0.28f);
	}
	Brassify(FNuhoudProceduralAssets::CreateTube(this, RingPath, RingRadii, 6, Visual));

	if (UProceduralMeshComponent* Flame = FNuhoudProceduralAssets::CreateIcosahedron(this, 1, 1.f, 0.f, Visual))
	{
		Flame->SetRelativeLocation(FVector(0.f, 0.f, -2.f));
		Flame->SetRelativeScale3D(FVector(1.f, 1.f, 1.7f));
		Flame->SetMaterial(0, FlameMaterial);
		Flame->SetCastShadow(false);
	}
	ApplyGlow(0.f, 0.f);
}

void ANuhoudLantern::SetTouchLighting(bool bAllowed, float NearestPalmDistance)
{
	bAllowTouchLighting = bAllowed;
	NearestPalm = NearestPalmDistance;
}

void ANuhoudLantern::ApplyGlow(float LitAlpha, float InProximity)
{
	const float GlassGlow = 0.04f + LitAlpha * 5.f + InProximity * 0.8f;
	if (GlassMaterial) GlassMaterial->SetVectorParameterValue(TEXT("EmissiveColor"), WarmGlow * GlassGlow);
	if (FlameMaterial) FlameMaterial->SetVectorParameterValue(TEXT("EmissiveColor"), WarmGlow * (0.3f + LitAlpha * 40.f));
	Light->SetIntensity(LitAlpha * LitLumens);
}

void ANuhoudLantern::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	BobTime += DeltaTime;

	if (bDecoration)
	{
		if (!bChainAdded)
		{
			const FVector NewLocation = FMath::VInterpTo(GetActorLocation(), HangTarget, DeltaTime, 2.5f);
			SetActorLocation(NewLocation);
			if (FVector::DistSquared(NewLocation, HangTarget) < 1.f)
			{
				SetActorLocation(HangTarget);
				AddChain();
			}
		}
		Visual->SetRelativeRotation(FRotator(0.f, 0.f, FMath::Sin(BobTime * 0.7f) * 1.5f));
	}
	else if (!bLit && bAllowTouchLighting && CanBeGrabbed())
	{
		Proximity = FMath::Clamp(1.f - NearestPalm / (TouchRadius * 2.5f), 0.f, 1.f);
		if (NearestPalm < TouchRadius)
		{
			TouchProgress += DeltaTime / SecondsToLightByTouch;
		}
		else
		{
			// Slow decay keeps partial progress so a brief tremor does not undo the effort.
			TouchProgress = FMath::Max(0.f, TouchProgress - DeltaTime * 0.15f);
		}
		if (TouchProgress >= 1.f)
		{
			bLit = true;
			OnTouchLit.ExecuteIfBound(this);
		}
	}
	else
	{
		Proximity = 0.f;
	}

	const float Target = bLit ? 1.f : (GetState() == ENuhoudGrabState::Held ? 0.15f : TouchProgress);
	Glow = FMath::FInterpTo(Glow, Target, DeltaTime, 8.f);
	ApplyGlow(Glow, Proximity);
}

void ANuhoudLantern::HangAsDecoration(const FVector& HangLocation, float CeilingZ, bool bInstant)
{
	Freeze();
	bDecoration = true;
	bLit = true;
	HangTarget = HangLocation;
	CeilingHeight = CeilingZ;
	SetActorRotation(FRotator(0.f, GetActorRotation().Yaw, 0.f));
	if (bInstant)
	{
		Glow = 1.f;
		SetActorLocation(HangLocation);
		AddChain();
	}
}

void ANuhoudLantern::AddChain()
{
	if (bChainAdded) return;
	bChainAdded = true;

	const float RingTopWorldZ = GetActorLocation().Z + VisualOffsetZ + RingTopZ;
	const float Length = CeilingHeight - RingTopWorldZ;
	if (Length <= 1.f) return;
	if (UProceduralMeshComponent* Chain = FNuhoudProceduralAssets::CreateTube(this,
		{ FVector(0, 0, RingTopZ), FVector(0, 0, RingTopZ + Length) }, { 0.22f, 0.22f }, 6, Visual))
	{
		Chain->SetMaterial(0, BrassMaterial);
	}
}
