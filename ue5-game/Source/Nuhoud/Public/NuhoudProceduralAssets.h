#pragma once

#include "CoreMinimal.h"
#include "ProceduralMeshComponent.h"

class UMaterialInterface;
class UMaterialInstanceDynamic;

class NUHOUD_API FNuhoudProceduralAssets
{
public:
	static UMaterialInterface* GetLitMaterial();
	static UMaterialInstanceDynamic* MakeLitMaterial(UObject* Outer, const FLinearColor& BaseColor, float Metallic = 0.f,
		float Roughness = 0.6f, const FLinearColor& Emissive = FLinearColor::Black);

	static UProceduralMeshComponent* CreateIcosahedron(AActor* Owner, int32 Subdivisions = 2, float Radius = 50.f,
		float Irregularity = 0.f, USceneComponent* Parent = nullptr);

	/** Surface of revolution around +Z. Profile points are (radius, height), ordered bottom to top. */
	static UProceduralMeshComponent* CreateLathe(AActor* Owner, const TArray<FVector2D>& Profile, int32 Segments = 32,
		USceneComponent* Parent = nullptr);

	/** Capped tube following a polyline, one radius per path point. */
	static UProceduralMeshComponent* CreateTube(AActor* Owner, const TArray<FVector>& Path, const TArray<float>& Radii,
		int32 Sides = 10, USceneComponent* Parent = nullptr);

	static UProceduralMeshComponent* CreateRoundedBox(AActor* Owner, const FVector& HalfExtents, float Radius,
		int32 EdgeSteps = 4, USceneComponent* Parent = nullptr);

private:
	static UProceduralMeshComponent* NewMeshComponent(AActor* Owner, USceneComponent* Parent);
	static void FinalizeTriangles(TArray<int32>& Tris);
	static void SubdivideSphere(TArray<FVector>& Verts, TArray<int32>& Tris, int32 Subdivisions, float Radius);
	static float SimpleNoise3D(float X, float Y, float Z);
	static float HashFloat(int32 N);
};
