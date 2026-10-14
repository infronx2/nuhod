#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudMajlis.generated.h"

class UStaticMesh;
class UStaticMeshComponent;
class UMaterialInterface;
class UProceduralMeshComponent;

/**
 * Traditional Omani floor-seating majlis, built at real scale (cm) around the actor origin
 * (room floor centre). The patient sits against the back wall facing +X over a low coffee table.
 */
UCLASS()
class NUHOUD_API ANuhoudMajlis : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudMajlis();

	FVector GetPatientEyes() const;
	float GetPatientYaw() const { return GetActorRotation().Yaw; }
	float GetTableTopZ() const;
	float GetCeilingZ() const;
	FVector GetPainButtonLocation() const;

	/** Centres of the dates heaped in the bowl. */
	TArray<FTransform> GetDateHomes() const;

	/** Base of each cup / the dallah on the table surface (add the object's rest height). */
	TArray<FTransform> GetCupHomes() const;
	FTransform GetDallahHome() const;

	/** Table-surface spots on the patient's right or left side. */
	FVector GetLanternSpot(bool bRight) const;
	FVector GetPlateSpot(bool bRight) const;

	/** Ceiling positions for lit lanterns, the ones most visible to the patient first. */
	const TArray<FVector>& GetHangSlots() const { return HangSlots; }

protected:
	virtual void BeginPlay() override;

private:
	FVector TablePoint(const FVector2D& Offset, float Height) const;

	void BuildFloor();
	void BuildWalls();
	void BuildWindow(bool bFrontWall, float OpeningMin, float OpeningMax);
	void BuildCeiling();
	void BuildSeating();
	void BuildTableService();
	void BuildDecor();
	void BuildLighting();
	void BuildExterior();

	UStaticMeshComponent* AddMesh(UStaticMesh* Mesh, UMaterialInterface* Material, const FVector& Center,
		const FVector& Size, const FRotator& Rotation = FRotator::ZeroRotator);
	UStaticMeshComponent* AddBox(const FVector& Center, const FVector& Size, UMaterialInterface* Material,
		const FRotator& Rotation = FRotator::ZeroRotator);
	UProceduralMeshComponent* AddCushion(const FVector& Center, const FVector& Size, UMaterialInterface* Material,
		float Roundness, const FRotator& Rotation = FRotator::ZeroRotator);
	UProceduralMeshComponent* AddLathe(const TArray<FVector2D>& Profile, UMaterialInterface* Material,
		const FVector& Location, const FRotator& Rotation = FRotator::ZeroRotator, USceneComponent* Parent = nullptr);
	USceneComponent* AddGroup(const FVector& Location, const FRotator& Rotation);

	UPROPERTY()
	USceneComponent* Root;

	UPROPERTY()
	UStaticMesh* CubeMesh;

	UPROPERTY()
	UStaticMesh* CylinderMesh;

	UPROPERTY()
	UStaticMesh* PlaneMesh;

	UPROPERTY()
	UMaterialInterface* BrassMat;

	UPROPERTY()
	UMaterialInterface* DarkWoodMat;

	TArray<FVector> HangSlots;
};
