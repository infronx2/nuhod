#include "NuhoudMajlis.h"
#include "NuhoudProceduralAssets.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Engine/CollisionProfile.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Particles/ParticleSystem.h"
#include "Particles/ParticleSystemComponent.h"
#include "ProceduralMeshComponent.h"

namespace
{
	// Interior dimensions in cm; the actor origin is the centre of the floor.
	constexpr float HalfX = 300.f;
	constexpr float HalfY = 250.f;
	constexpr float CeilingZ = 320.f;
	constexpr float Wall = 20.f;
	constexpr float WindowBottom = 95.f;
	constexpr float WindowTop = 235.f;
	constexpr float MattressHeight = 14.f;
	constexpr float MattressDepth = 70.f;

	// Cross-legged on the back-wall mattress; eyes about 76 cm above the seat.
	const FVector PatientEyes(-235.f, 0.f, 90.f);

	// The table top sits 45 cm below the eyes, like a desk in front of a webcam, so real reaches map 1:1.
	const FVector TableCenter(-195.f, 0.f, 0.f);
	constexpr float TableTop = 45.f;
	constexpr float TableDiameter = 84.f;

	// Table-local layout (x away from the patient, y to the patient's right), all within a seated reach.
	const FVector2D TrayOffset(14.f, 0.f);
	const FVector2D BowlOffset(-10.f, -16.f);
	const FVector2D CupOffsets[] = { { -10.f, 15.f }, { -2.f, 22.f }, { -12.f, 27.f } };
	const FVector2D LanternSpotRight(6.f, 30.f);
	const FVector2D PlateSpotRight(8.f, 33.f);
	const FVector2D PainButtonOffset(24.f, -22.f);
	constexpr float TrayTopZ = 0.9f;
	constexpr float BowlFloorZ = 1.f;

	UMaterialInterface* LoadMat(const TCHAR* Path) { return LoadObject<UMaterialInterface>(nullptr, Path); }
	UStaticMesh* LoadMesh(const TCHAR* Path) { return LoadObject<UStaticMesh>(nullptr, Path); }
}

ANuhoudMajlis::ANuhoudMajlis()
{
	PrimaryActorTick.bCanEverTick = false;
	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent = Root;

	CubeMesh = nullptr;
	CylinderMesh = nullptr;
	PlaneMesh = nullptr;
	BrassMat = nullptr;
	DarkWoodMat = nullptr;

	const FVector LocalSlots[] = {
		{ 255.f, 0.f, 160.f },
		{ 255.f, -100.f, 160.f }, { 255.f, 100.f, 160.f },
		{ 255.f, -175.f, 175.f }, { 255.f, 175.f, 175.f },
		{ 170.f, -215.f, 180.f }, { 170.f, 215.f, 180.f },
		{ 70.f, -215.f, 180.f }, { 70.f, 215.f, 180.f },
		{ -30.f, -215.f, 180.f }, { -30.f, 215.f, 180.f },
	};
	HangSlots.Append(LocalSlots, UE_ARRAY_COUNT(LocalSlots));
}

FVector ANuhoudMajlis::GetPatientEyes() const
{
	return GetActorTransform().TransformPosition(PatientEyes);
}

float ANuhoudMajlis::GetTableTopZ() const
{
	return GetActorLocation().Z + TableTop;
}

float ANuhoudMajlis::GetCeilingZ() const
{
	return GetActorLocation().Z + CeilingZ;
}

FVector ANuhoudMajlis::TablePoint(const FVector2D& Offset, float Height) const
{
	return GetActorTransform().TransformPosition(TableCenter + FVector(Offset.X, Offset.Y, TableTop + Height));
}

FVector ANuhoudMajlis::GetPainButtonLocation() const
{
	return TablePoint(PainButtonOffset, 0.5f);
}

TArray<FTransform> ANuhoudMajlis::GetDateHomes() const
{
	TArray<FTransform> Homes;
	for (int32 i = 0; i < 9; i++)
	{
		// A small heap: one date in the middle on top, the rest in two rings.
		const float A = i * 2.4f;
		const float R = i == 0 ? 0.f : 2.2f + (i % 3) * 1.1f;
		const float Z = BowlFloorZ + 1.25f + (i % 2) * 0.9f + (i == 0 ? 1.2f : 0.f);
		const FVector Location = TablePoint(BowlOffset + FVector2D(FMath::Cos(A) * R, FMath::Sin(A) * R), Z);
		Homes.Add(FTransform(FRotator(0.f, GetActorRotation().Yaw + i * 40.f, 0.f), Location));
	}
	return Homes;
}

TArray<FTransform> ANuhoudMajlis::GetCupHomes() const
{
	TArray<FTransform> Homes;
	for (const FVector2D& Offset : CupOffsets)
	{
		Homes.Add(FTransform(GetActorRotation(), TablePoint(Offset, 0.f)));
	}
	return Homes;
}

FTransform ANuhoudMajlis::GetDallahHome() const
{
	return FTransform(GetActorRotation(), TablePoint(TrayOffset, TrayTopZ));
}

FVector ANuhoudMajlis::GetLanternSpot(bool bRight) const
{
	return TablePoint(FVector2D(LanternSpotRight.X, bRight ? LanternSpotRight.Y : -LanternSpotRight.Y), 0.f);
}

FVector ANuhoudMajlis::GetPlateSpot(bool bRight) const
{
	return TablePoint(FVector2D(PlateSpotRight.X, bRight ? PlateSpotRight.Y : -PlateSpotRight.Y), 0.f);
}

void ANuhoudMajlis::BeginPlay()
{
	Super::BeginPlay();

	CubeMesh = LoadMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
	CylinderMesh = LoadMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	PlaneMesh = LoadMesh(TEXT("/Engine/BasicShapes/Plane.Plane"));
	BrassMat = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.62f, 0.46f, 0.24f), 1.f, 0.4f);
	DarkWoodMat = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.09f, 0.045f, 0.02f), 0.f, 0.55f);

	BuildExterior();
	BuildFloor();
	BuildWalls();
	BuildCeiling();
	BuildSeating();
	BuildTableService();
	BuildDecor();
	BuildLighting();

	const FTransform T = GetActorTransform();
	for (FVector& Slot : HangSlots)
	{
		Slot = T.TransformPosition(Slot);
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

UStaticMeshComponent* ANuhoudMajlis::AddMesh(UStaticMesh* Mesh, UMaterialInterface* Material, const FVector& Center,
	const FVector& Size, const FRotator& Rotation)
{
	if (!Mesh) return nullptr;

	UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
	C->SetupAttachment(Root);
	C->SetStaticMesh(Mesh);
	// Solid so dropped dates, cups and lanterns land on the table, rug and floor.
	C->SetCollisionProfileName(UCollisionProfile::BlockAll_ProfileName);

	// Fit the mesh's own bounds to Size, centred on Center, whatever its pivot.
	const FBox Bounds = Mesh->GetBoundingBox();
	const FVector Extent = Bounds.GetSize();
	const FVector Scale(
		Extent.X > 0.01f ? Size.X / Extent.X : 1.f,
		Extent.Y > 0.01f ? Size.Y / Extent.Y : 1.f,
		Extent.Z > 0.01f ? Size.Z / Extent.Z : 1.f);
	C->SetRelativeScale3D(Scale);
	C->SetRelativeRotation(Rotation);
	C->SetRelativeLocation(Center - Rotation.RotateVector(Bounds.GetCenter() * Scale));
	if (Material)
	{
		for (int32 i = 0; i < C->GetNumMaterials(); i++) C->SetMaterial(i, Material);
	}
	C->RegisterComponent();
	return C;
}

UStaticMeshComponent* ANuhoudMajlis::AddBox(const FVector& Center, const FVector& Size, UMaterialInterface* Material,
	const FRotator& Rotation)
{
	return AddMesh(CubeMesh, Material, Center, Size, Rotation);
}

UProceduralMeshComponent* ANuhoudMajlis::AddCushion(const FVector& Center, const FVector& Size,
	UMaterialInterface* Material, float Roundness, const FRotator& Rotation)
{
	UProceduralMeshComponent* M = FNuhoudProceduralAssets::CreateRoundedBox(this, Size * 0.5f, Roundness, 4, Root);
	if (M)
	{
		M->SetRelativeLocationAndRotation(Center, Rotation);
		M->SetMaterial(0, Material);
	}
	return M;
}

UProceduralMeshComponent* ANuhoudMajlis::AddLathe(const TArray<FVector2D>& Profile, UMaterialInterface* Material,
	const FVector& Location, const FRotator& Rotation, USceneComponent* Parent)
{
	UProceduralMeshComponent* M = FNuhoudProceduralAssets::CreateLathe(this, Profile, 36, Parent ? Parent : Root);
	if (M)
	{
		M->SetRelativeLocationAndRotation(Location, Rotation);
		M->SetMaterial(0, Material);
	}
	return M;
}

USceneComponent* ANuhoudMajlis::AddGroup(const FVector& Location, const FRotator& Rotation)
{
	USceneComponent* G = NewObject<USceneComponent>(this);
	G->SetupAttachment(Root);
	G->SetRelativeLocationAndRotation(Location, Rotation);
	G->RegisterComponent();
	return G;
}

// ── Room ───────────────────────────────────────────────────────────────────

void ANuhoudMajlis::BuildExterior()
{
	AddMesh(PlaneMesh, FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.60f, 0.46f, 0.30f), 0.f, 1.f),
		FVector(0.f, 0.f, -2.f), FVector(20000.f, 20000.f, 1.f));
}

void ANuhoudMajlis::BuildFloor()
{
	UMaterialInterface* Wood = LoadMat(TEXT("/Game/StarterContent/Materials/M_Wood_Floor_Walnut_Worn.M_Wood_Floor_Walnut_Worn"));
	UStaticMesh* Tile = LoadMesh(TEXT("/Game/StarterContent/Architecture/Floor_400x400.Floor_400x400"));
	for (float X : { -200.f, 200.f })
	{
		for (float Y : { -200.f, 200.f })
		{
			AddMesh(Tile ? Tile : CubeMesh, Wood ? Wood : DarkWoodMat, FVector(X, Y, -10.f), FVector(400.f, 400.f, 20.f));
		}
	}

	auto RugMat = [this](const FLinearColor& C) { return FNuhoudProceduralAssets::MakeLitMaterial(this, C, 0.f, 0.95f); };
	UMaterialInterface* Border = RugMat(FLinearColor(0.07f, 0.035f, 0.025f));
	UMaterialInterface* Red = RugMat(FLinearColor(0.20f, 0.035f, 0.03f));
	UMaterialInterface* Field = RugMat(FLinearColor(0.14f, 0.025f, 0.025f));
	UMaterialInterface* Gold = RugMat(FLinearColor(0.30f, 0.19f, 0.07f));
	UMaterialInterface* Navy = RugMat(FLinearColor(0.025f, 0.035f, 0.08f));

	// Layers stacked 3 mm apart so their top faces never coincide.
	const FVector C(-10.f, 0.f, 0.f);
	const FRotator Diamond(0.f, 45.f, 0.f);
	AddBox(C + FVector(0, 0, 0.6f), FVector(470.f, 340.f, 1.2f), Border);
	AddBox(C + FVector(0, 0, 1.0f), FVector(440.f, 310.f, 1.2f), Red);
	AddBox(C + FVector(0, 0, 1.3f), FVector(370.f, 240.f, 1.2f), Field);
	AddBox(C + FVector(0, 122.f, 1.6f), FVector(374.f, 4.f, 1.2f), Gold);
	AddBox(C + FVector(0, -122.f, 1.6f), FVector(374.f, 4.f, 1.2f), Gold);
	AddBox(C + FVector(187.f, 0, 1.6f), FVector(4.f, 248.f, 1.2f), Gold);
	AddBox(C + FVector(-187.f, 0, 1.6f), FVector(4.f, 248.f, 1.2f), Gold);
	AddBox(C + FVector(0, 0, 1.6f), FVector(120.f, 120.f, 1.2f), Gold, Diamond);
	AddBox(C + FVector(0, 0, 1.9f), FVector(80.f, 80.f, 1.2f), Navy, Diamond);
	AddBox(C + FVector(0, 0, 2.2f), FVector(36.f, 36.f, 1.2f), Red, Diamond);
	for (float X : { -150.f, 150.f })
	{
		for (float Y : { -85.f, 85.f })
		{
			AddBox(C + FVector(X, Y, 1.6f), FVector(30.f, 30.f, 1.2f), Navy, Diamond);
		}
	}
}

void ANuhoudMajlis::BuildWalls()
{
	UMaterialInterface* Plaster = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.58f, 0.50f, 0.39f), 0.f, 0.9f);
	UMaterialInterface* Band = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.34f, 0.25f, 0.16f), 0.f, 0.85f);
	const float H = CeilingZ;
	const float ZC = H * 0.5f;

	// Back wall behind the patient, and the solid left wall.
	AddBox(FVector(-HalfX - Wall * 0.5f, 0.f, ZC), FVector(Wall, 2.f * (HalfY + Wall), H), Plaster);
	AddBox(FVector(0.f, -HalfY - Wall * 0.5f, ZC), FVector(2.f * (HalfX + Wall), Wall, H), Plaster);

	// Right wall: one window letting the afternoon sun in.
	{
		const float Y = HalfY + Wall * 0.5f;
		const float O0 = -20.f, O1 = 80.f;
		const float XMin = -HalfX - Wall, XMax = HalfX + Wall;
		AddBox(FVector((XMin + O0) * 0.5f, Y, ZC), FVector(O0 - XMin, Wall, H), Plaster);
		AddBox(FVector((O1 + XMax) * 0.5f, Y, ZC), FVector(XMax - O1, Wall, H), Plaster);
		AddBox(FVector((O0 + O1) * 0.5f, Y, WindowBottom * 0.5f), FVector(O1 - O0, Wall, WindowBottom), Plaster);
		AddBox(FVector((O0 + O1) * 0.5f, Y, (WindowTop + H) * 0.5f), FVector(O1 - O0, Wall, H - WindowTop), Plaster);
		BuildWindow(false, O0, O1);
	}

	// Front wall the patient faces: two windows either side of a solid centre.
	{
		const float X = HalfX + Wall * 0.5f;
		const float Edges[] = { -HalfY - Wall, -150.f, -50.f, 50.f, 150.f, HalfY + Wall };
		for (int32 i = 0; i < 5; i++)
		{
			const float Y0 = Edges[i];
			const float Y1 = Edges[i + 1];
			const float MidY = (Y0 + Y1) * 0.5f;
			if (i == 1 || i == 3)
			{
				AddBox(FVector(X, MidY, WindowBottom * 0.5f), FVector(Wall, Y1 - Y0, WindowBottom), Plaster);
				AddBox(FVector(X, MidY, (WindowTop + H) * 0.5f), FVector(Wall, Y1 - Y0, H - WindowTop), Plaster);
				BuildWindow(true, Y0, Y1);
			}
			else
			{
				AddBox(FVector(X, MidY, ZC), FVector(Wall, Y1 - Y0, H), Plaster);
			}
		}
	}

	// Dark wooden skirting and a carved-plaster frieze band around the room.
	AddBox(FVector(-HalfX + 1.f, 0.f, 6.f), FVector(2.f, 2.f * HalfY, 12.f), DarkWoodMat);
	AddBox(FVector(HalfX - 1.f, 0.f, 6.f), FVector(2.f, 2.f * HalfY, 12.f), DarkWoodMat);
	AddBox(FVector(0.f, -HalfY + 1.f, 6.f), FVector(2.f * HalfX, 2.f, 12.f), DarkWoodMat);
	AddBox(FVector(0.f, HalfY - 1.f, 6.f), FVector(2.f * HalfX, 2.f, 12.f), DarkWoodMat);
	AddBox(FVector(-HalfX + 0.75f, 0.f, 256.f), FVector(1.5f, 2.f * HalfY, 10.f), Band);
	AddBox(FVector(HalfX - 0.75f, 0.f, 256.f), FVector(1.5f, 2.f * HalfY, 10.f), Band);
	AddBox(FVector(0.f, -HalfY + 0.75f, 256.f), FVector(2.f * HalfX, 1.5f, 10.f), Band);
	AddBox(FVector(0.f, HalfY - 0.75f, 256.f), FVector(2.f * HalfX, 1.5f, 10.f), Band);
}

void ANuhoudMajlis::BuildWindow(bool bFrontWall, float OpeningMin, float OpeningMax)
{
	const float W = OpeningMax - OpeningMin;
	const float Mid = (OpeningMin + OpeningMax) * 0.5f;
	const float HWin = WindowTop - WindowBottom;
	const float ZMid = (WindowBottom + WindowTop) * 0.5f;
	const float Depth = Wall * 0.5f;

	// Along = position along the wall, Out = distance out from the interior face.
	auto At = [bFrontWall](float Along, float Out, float Z)
	{
		return bFrontWall ? FVector(HalfX + Out, Along, Z) : FVector(Along, HalfY + Out, Z);
	};
	auto Sz = [bFrontWall](float AlongSize, float OutSize, float ZSize)
	{
		return bFrontWall ? FVector(OutSize, AlongSize, ZSize) : FVector(AlongSize, OutSize, ZSize);
	};

	AddBox(At(Mid, Depth, WindowBottom - 3.f), Sz(W + 12.f, Wall + 8.f, 6.f), DarkWoodMat);
	AddBox(At(Mid, Depth, WindowTop + 3.f), Sz(W + 12.f, Wall + 8.f, 6.f), DarkWoodMat);
	AddBox(At(OpeningMin - 3.f, Depth, ZMid), Sz(6.f, Wall + 8.f, HWin + 12.f), DarkWoodMat);
	AddBox(At(OpeningMax + 3.f, Depth, ZMid), Sz(6.f, Wall + 8.f, HWin + 12.f), DarkWoodMat);
	for (int32 i = 1; i <= 2; i++)
	{
		AddBox(At(OpeningMin + W * i / 3.f, Depth, ZMid), Sz(3.f, 4.f, HWin), DarkWoodMat);
	}
	AddBox(At(Mid, Depth, ZMid + 20.f), Sz(W, 4.f, 3.f), DarkWoodMat);
}

void ANuhoudMajlis::BuildCeiling()
{
	// Palm-frond matting laid over palm-trunk beams.
	AddBox(FVector(0.f, 0.f, CeilingZ + 10.f), FVector(2.f * (HalfX + Wall), 2.f * (HalfY + Wall), 20.f),
		FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.50f, 0.38f, 0.20f), 0.f, 0.95f));

	UMaterialInterface* Beam = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.16f, 0.09f, 0.04f), 0.f, 0.75f);
	for (int32 i = 0; i < 11; i++)
	{
		AddMesh(CylinderMesh, Beam, FVector(-HalfX + 25.f + i * 55.f, 0.f, CeilingZ - 7.f),
			FVector(14.f, 14.f, 2.f * HalfY), FRotator(0.f, 0.f, 90.f));
	}
}

void ANuhoudMajlis::BuildSeating()
{
	UMaterialInterface* Velvet = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.16f, 0.025f, 0.035f), 0.f, 0.85f);
	UMaterialInterface* Green = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.035f, 0.08f, 0.055f), 0.f, 0.85f);
	UMaterialInterface* Navy = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.025f, 0.035f, 0.085f), 0.f, 0.85f);
	UMaterialInterface* GoldCloth = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.30f, 0.20f, 0.07f), 0.f, 0.65f);
	UMaterialInterface* const CushionColors[] = { Velvet, Green, Navy };

	// The patient's own mattress and back cushions along the back wall.
	AddCushion(FVector(-HalfX + MattressDepth * 0.5f, 0.f, MattressHeight * 0.5f), FVector(MattressDepth, 440.f, MattressHeight), Velvet, 4.f);
	for (int32 i = 0; i < 6; i++)
	{
		AddCushion(FVector(-HalfX + 10.f, -160.f + i * 64.f, MattressHeight + 22.f), FVector(18.f, 58.f, 44.f),
			CushionColors[i % 3], 7.f, FRotator(8.f, 0.f, 0.f));
	}

	// Guest seating along both side walls.
	for (float Sign : { -1.f, 1.f })
	{
		const float Y = Sign * (HalfY - MattressDepth * 0.5f);
		AddCushion(FVector(0.f, Y, MattressHeight * 0.5f), FVector(450.f, MattressDepth, MattressHeight), Velvet, 4.f);
		AddMesh(CylinderMesh, GoldCloth, FVector(0.f, Y - Sign * MattressDepth * 0.5f, MattressHeight),
			FVector(2.2f, 2.2f, 450.f), FRotator(90.f, 0.f, 0.f));

		for (int32 i = 0; i < 7; i++)
		{
			AddCushion(FVector(-192.f + i * 64.f, Sign * (HalfY - 10.f), MattressHeight + 22.f), FVector(58.f, 18.f, 44.f),
				CushionColors[(i + 1) % 3], 7.f, FRotator(0.f, 0.f, -Sign * 8.f));
		}
		for (float X : { -150.f, 0.f, 150.f })
		{
			AddMesh(CylinderMesh, GoldCloth, FVector(X, Sign * (HalfY - 35.f), MattressHeight + 12.f),
				FVector(24.f, 24.f, 55.f), FRotator(0.f, 0.f, 90.f));
		}
	}
}

void ANuhoudMajlis::BuildTableService()
{
	// Dark walnut so the brass, porcelain and dates stand out clearly against it.
	UStaticMesh* TableMesh = LoadMesh(TEXT("/Game/StarterContent/Props/SM_TableRound.SM_TableRound"));
	UMaterialInterface* Walnut = LoadMat(TEXT("/Game/StarterContent/Materials/M_Wood_Walnut.M_Wood_Walnut"));
	AddMesh(TableMesh ? TableMesh : CylinderMesh, Walnut ? Walnut : DarkWoodMat,
		FVector(TableCenter.X, TableCenter.Y, TableTop * 0.5f), FVector(TableDiameter, TableDiameter, TableTop));

	// Small brass tray for the dallah. The dallah, cups and dates themselves are grabbable actors.
	AddLathe({ {0.f, 0.f}, {16.f, 0.f}, {16.8f, 0.5f}, {17.1f, 1.8f}, {16.6f, 2.f}, {16.f, TrayTopZ}, {0.f, TrayTopZ} },
		BrassMat, TableCenter + FVector(TrayOffset.X, TrayOffset.Y, TableTop));

	// Glazed bowl that holds the dates.
	AddLathe({ {0.f, 0.f}, {3.2f, 0.f}, {3.5f, 0.4f}, {6.5f, 2.8f}, {8.4f, 5.6f}, {8.6f, 6.f}, {8.1f, 6.f},
		{6.1f, 3.2f}, {3.f, BowlFloorZ}, {0.f, BowlFloorZ} },
		FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.03f, 0.30f, 0.36f), 0.f, 0.2f),
		TableCenter + FVector(BowlOffset.X, BowlOffset.Y, TableTop));
}

void ANuhoudMajlis::BuildDecor()
{
	// Engraved brass plates hung beside the windows.
	const TArray<FVector2D> Plate = { {0.f, 0.f}, {22.f, 0.f}, {22.6f, 0.6f}, {22.f, 1.5f}, {19.5f, 1.1f},
		{17.f, 0.8f}, {8.f, 1.4f}, {4.f, 1.f}, {0.f, 1.6f} };
	for (float Y : { -205.f, 205.f })
	{
		AddLathe(Plate, BrassMat, FVector(HalfX - 2.f, Y, 150.f), FRotator(90.f, 0.f, 0.f));
	}

	// Mandoos: dark wooden chest with brass bands and studs, centred on the front wall.
	const float CX = HalfX - 26.f;
	AddBox(FVector(CX, 0.f, 25.f), FVector(48.f, 96.f, 50.f), DarkWoodMat);
	AddBox(FVector(CX, 0.f, 53.f), FVector(52.f, 100.f, 6.f), DarkWoodMat);
	for (float Y : { -32.f, 0.f, 32.f })
	{
		AddBox(FVector(CX - 24.5f, Y, 27.f), FVector(1.2f, 5.f, 52.f), BrassMat);
	}
	AddBox(FVector(CX - 24.5f, 0.f, 8.f), FVector(1.2f, 96.f, 4.f), BrassMat);
	AddBox(FVector(CX - 25.f, 0.f, 42.f), FVector(1.5f, 10.f, 12.f), BrassMat);
	for (float Z : { 18.f, 34.f })
	{
		for (int32 k = 0; k < 11; k++)
		{
			if (UProceduralMeshComponent* Stud = FNuhoudProceduralAssets::CreateIcosahedron(this, 1, 0.9f, 0.f, Root))
			{
				Stud->SetRelativeLocation(FVector(CX - 25.f, -44.f + k * 8.8f, Z));
				Stud->SetMaterial(0, BrassMat);
			}
		}
	}

	// Mabkhara (incense burner) with a glowing ember.
	USceneComponent* Burner = AddGroup(FVector(HalfX - 25.f, 80.f, 0.f), FRotator::ZeroRotator);
	AddLathe({ {0.f, 0.f}, {7.f, 0.f}, {7.f, 2.f}, {5.2f, 3.f}, {4.f, 10.f}, {5.5f, 12.f}, {7.5f, 14.f}, {7.5f, 16.5f}, {0.f, 16.5f} },
		DarkWoodMat, FVector::ZeroVector, FRotator::ZeroRotator, Burner);
	AddLathe({ {7.f, 16.f}, {7.9f, 16.4f}, {7.9f, 17.4f}, {7.f, 17.6f} }, BrassMat, FVector::ZeroVector, FRotator::ZeroRotator, Burner);
	if (UProceduralMeshComponent* Ember = FNuhoudProceduralAssets::CreateIcosahedron(this, 1, 2.f, 0.25f, Burner))
	{
		Ember->SetRelativeLocation(FVector(0.f, 0.f, 17.5f));
		Ember->SetMaterial(0, FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.3f, 0.08f, 0.02f), 0.f, 0.9f,
			FLinearColor(3.f, 0.9f, 0.2f)));
	}
	UPointLightComponent* EmberLight = NewObject<UPointLightComponent>(this);
	EmberLight->SetupAttachment(Burner);
	EmberLight->SetRelativeLocation(FVector(0.f, 0.f, 22.f));
	EmberLight->SetIntensityUnits(ELightUnits::Lumens);
	EmberLight->SetIntensity(25.f);
	EmberLight->SetAttenuationRadius(120.f);
	EmberLight->SetLightColor(FLinearColor(1.f, 0.45f, 0.15f));
	EmberLight->SetCastShadows(false);
	EmberLight->RegisterComponent();

	// Potted plants in the front corners.
	UMaterialInterface* Clay = FNuhoudProceduralAssets::MakeLitMaterial(this, FLinearColor(0.42f, 0.19f, 0.09f), 0.f, 0.85f);
	UStaticMesh* Bush = LoadMesh(TEXT("/Game/StarterContent/Props/SM_Bush.SM_Bush"));
	for (float Y : { -215.f, 215.f })
	{
		AddLathe({ {0.f, 0.f}, {9.f, 0.f}, {11.f, 2.f}, {14.f, 30.f}, {15.f, 31.f}, {15.f, 33.f}, {13.5f, 33.f}, {0.f, 30.f} },
			Clay, FVector(HalfX - 35.f, Y, 0.f));
		AddMesh(Bush, nullptr, FVector(HalfX - 35.f, Y, 33.f + 40.f), FVector(70.f, 70.f, 80.f));
	}

	// Dust motes drifting through the sunbeams.
	if (UParticleSystem* Dust = LoadObject<UParticleSystem>(nullptr, TEXT("/Game/StarterContent/Particles/P_Ambient_Dust.P_Ambient_Dust")))
	{
		UParticleSystemComponent* P = NewObject<UParticleSystemComponent>(this);
		P->SetupAttachment(Root);
		P->SetTemplate(Dust);
		P->SetRelativeLocation(FVector(0.f, 0.f, 130.f));
		P->RegisterComponent();
		P->Activate(true);
	}
}

void ANuhoudMajlis::BuildLighting()
{
	// Soft lamp over the table. Its shadows put the hands and the objects on the table in contact,
	// which is also the main cue for judging how high the hand is above a date on a flat screen.
	USpotLightComponent* TableLamp = NewObject<USpotLightComponent>(this);
	TableLamp->SetupAttachment(Root);
	TableLamp->SetRelativeLocationAndRotation(TableCenter + FVector(-10.f, 0.f, TableTop + 160.f), FRotator(-90.f, 0.f, 0.f));
	TableLamp->SetIntensityUnits(ELightUnits::Lumens);
	TableLamp->SetIntensity(650.f);
	TableLamp->SetAttenuationRadius(320.f);
	TableLamp->SetInnerConeAngle(14.f);
	TableLamp->SetOuterConeAngle(30.f);
	TableLamp->SetSourceRadius(12.f);
	TableLamp->SetSoftSourceRadius(20.f);
	TableLamp->SetLightColor(FLinearColor(1.f, 0.88f, 0.72f));
	TableLamp->SetCastShadows(true);
	TableLamp->RegisterComponent();

	// Soft warm fill so hands and table read clearly even on lower quality tiers without Lumen.
	UPointLightComponent* Fill = NewObject<UPointLightComponent>(this);
	Fill->SetupAttachment(Root);
	Fill->SetRelativeLocation(FVector(-40.f, 0.f, 270.f));
	Fill->SetIntensityUnits(ELightUnits::Lumens);
	Fill->SetIntensity(900.f);
	Fill->SetAttenuationRadius(900.f);
	Fill->SetLightColor(FLinearColor(1.f, 0.82f, 0.62f));
	Fill->SetCastShadows(false);
	Fill->RegisterComponent();
}
