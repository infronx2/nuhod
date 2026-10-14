#pragma once

#include "CoreMinimal.h"
#include "NuhoudGrabbable.h"
#include "NuhoudLantern.generated.h"

class UPointLightComponent;
class UMaterialInstanceDynamic;
class ANuhoudLantern;

DECLARE_DELEGATE_OneParam(FOnNuhoudLanternLit, ANuhoudLantern*);

/** Traditional brass lantern (fanoos), held by the ring on top. */
UCLASS()
class NUHOUD_API ANuhoudLantern : public ANuhoudGrabbable
{
	GENERATED_BODY()

public:
	ANuhoudLantern();
	virtual void Tick(float DeltaTime) override;

	void LightUp() { bLit = true; }
	bool IsLit() const { return bLit; }

	/**
	 * Assisted mode for weak grips: holding a palm next to the lantern lights it without picking it up.
	 * NearestPalmDistance is the on-screen distance from the closest visible palm to the lantern.
	 */
	void SetTouchLighting(bool bAllowed, float NearestPalmDistance);

	/** Lit, non-grabbable decoration that drifts to HangLocation and hangs from the ceiling. */
	void HangAsDecoration(const FVector& HangLocation, float CeilingZ, bool bInstant);

	FOnNuhoudLanternLit OnTouchLit;

	UPROPERTY(EditAnywhere, Category = "Nuhoud|Lantern")
	float TouchRadius;

	UPROPERTY(EditAnywhere, Category = "Nuhoud|Lantern")
	float SecondsToLightByTouch;

protected:
	virtual void BuildVisuals() override;

private:
	void ApplyGlow(float LitAlpha, float Proximity);
	void AddChain();

	UPROPERTY()
	UPointLightComponent* Light;

	UPROPERTY()
	UMaterialInstanceDynamic* GlassMaterial;

	UPROPERTY()
	UMaterialInstanceDynamic* FlameMaterial;

	UPROPERTY()
	UMaterialInstanceDynamic* BrassMaterial;

	float NearestPalm;
	FVector HangTarget;
	float CeilingHeight;
	float TouchProgress;
	float Proximity;
	float Glow;
	float BobTime;
	bool bLit;
	bool bAllowTouchLighting;
	bool bDecoration;
	bool bChainAdded;
};
