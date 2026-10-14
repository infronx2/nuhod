#include "NuhoudTargetMarker.h"
#include "NuhoudProceduralAssets.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"

namespace
{
	const FLinearColor Teal(0.1f, 0.9f, 0.75f);
	const FLinearColor Gold(1.f, 0.75f, 0.25f);
	const FLinearColor Brass(0.62f, 0.46f, 0.24f);
}

ANuhoudTargetMarker::ANuhoudTargetMarker()
{
	PrimaryActorTick.bCanEverTick = true;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;
	HaloMaterial = nullptr;
	Time = 0.f;
	CelebrateTime = 0.f;
	bCelebrating = false;
}

void ANuhoudTargetMarker::BuildHalo(float Radius, float Z)
{
	HaloMaterial = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.05f, 0.4f, 0.35f), 0.f, 0.5f, Teal * 2.f);
	TArray<FVector> Path;
	TArray<float> Radii;
	for (int32 i = 0; i <= 40; i++)
	{
		const float A = 2.f * PI * i / 40.f;
		Path.Add(FVector(FMath::Cos(A) * Radius, FMath::Sin(A) * Radius, Z));
		Radii.Add(0.3f);
	}
	if (UProceduralMeshComponent* Halo = FNuhoudProceduralAssets::CreateTube(this, Path, Radii, 6, Root))
	{
		Halo->SetMaterial(0, HaloMaterial);
		Halo->SetCastShadow(false);
	}
}

void ANuhoudTargetMarker::BuildHook(float CeilingZ)
{
	UMaterialInstanceDynamic* Metal = FNuhoudProceduralAssets::MakeLitMaterial(this, Brass, 1.f, 0.4f);
	const float ChainLength = CeilingZ - GetActorLocation().Z - 5.f;
	if (ChainLength > 1.f)
	{
		if (UProceduralMeshComponent* Chain = FNuhoudProceduralAssets::CreateTube(this,
			{ FVector(0.f, 0.f, 5.f), FVector(0.f, 0.f, 5.f + ChainLength) }, { 0.22f, 0.22f }, 6, Root))
		{
			Chain->SetMaterial(0, Metal);
		}
	}
	if (UProceduralMeshComponent* Hook = FNuhoudProceduralAssets::CreateTube(this,
		{ {0.f, 0.f, 5.f}, {0.f, 0.f, 1.5f}, {0.f, -0.6f, -0.3f}, {0.f, -1.8f, -0.6f}, {0.f, -2.8f, 0.2f}, {0.f, -3.1f, 1.5f} },
		{ 0.35f, 0.35f, 0.35f, 0.35f, 0.35f, 0.3f }, 8, Root))
	{
		Hook->SetMaterial(0, Metal);
	}
	BuildHalo(7.f, 0.f);
}

void ANuhoudTargetMarker::BuildPlate()
{
	if (UProceduralMeshComponent* Plate = FNuhoudProceduralAssets::CreateLathe(this, {
		{0.f, 0.f}, {3.5f, 0.f}, {3.8f, 0.2f}, {6.5f, 0.5f}, {7.6f, 1.2f}, {7.8f, 1.4f}, {7.4f, 1.4f},
		{6.3f, 0.9f}, {3.5f, PlateTopZ}, {0.f, PlateTopZ} }, 40, Root))
	{
		Plate->SetMaterial(0, FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.9f, 0.87f, 0.8f), 0.f, 0.22f));
	}
	if (UProceduralMeshComponent* Rim = FNuhoudProceduralAssets::CreateLathe(this, {
		{7.4f, 1.4f}, {7.85f, 1.45f}, {7.85f, 1.6f}, {7.4f, 1.55f} }, 40, Root))
	{
		Rim->SetMaterial(0, FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.85f, 0.62f, 0.2f), 1.f, 0.3f));
	}
	BuildHalo(10.5f, 0.6f);
}

void ANuhoudTargetMarker::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!HaloMaterial) return;
	Time += DeltaTime;

	FLinearColor Emissive = Teal * (1.5f + 1.2f * (0.5f + 0.5f * FMath::Sin(Time * 3.f)));
	if (bCelebrating)
	{
		CelebrateTime += DeltaTime;
		Emissive = Gold * FMath::Max(0.f, 8.f * (1.f - CelebrateTime / 1.2f));
	}
	HaloMaterial->SetVectorParameterValue(TEXT("EmissiveColor"), Emissive);
}
