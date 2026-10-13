// ============================================================================
// NuhoudTargetActor.h — Phase 2 Upgrade
// ============================================================================
// Upgrades: Health system, spline-based movement, dynamic glow material,
// Niagara burst on death, proximity-based glow intensity.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/SplineComponent.h"
#include "NuhoudTargetActor.generated.h"

// Forward declarations
class UStaticMeshComponent;
class USphereComponent;
class UAudioComponent;
class UNiagaraComponent;
class UMaterialInstanceDynamic;

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when the target takes damage (for audio/particle feedback). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
    FOnTargetDamaged,
    ANuhoudTargetActor*, Target,
    int32, RemainingHealth
);

/** Fired when the target is destroyed (for Niagara burst + score). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FOnTargetDestroyed,
    ANuhoudTargetActor*, Target
);

// ---------------------------------------------------------------------------
// Target Actor (Phase 2)
// ---------------------------------------------------------------------------

UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudTargetActor : public AActor
{
    GENERATED_BODY()

public:
    ANuhoudTargetActor();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    // -----------------------------------------------------------------------
    // Hit / Damage / Health
    // -----------------------------------------------------------------------

    /** Called when the player's virtual hand enters the collision sphere. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Target")
    void OnHit();

    /** Take damage — reduces health, plays hit VFX, and destroys at 0. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Target")
    void TakeDamage(int32 Amount = 1);

    /** Is this target still active? */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Target")
    bool IsActive() const { return bActive; }

    /** Get the current health. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Target")
    int32 GetHealth() const { return CurrentHealth; }

    /** Get the max health. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Target")
    int32 GetMaxHealth() const { return MaxHealth; }

    /** Get the health as a 0-1 ratio (for UI bars). */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Target")
    float GetHealthRatio() const { return MaxHealth > 0 ? static_cast<float>(CurrentHealth) / MaxHealth : 0.0f; }

    // -----------------------------------------------------------------------
    // Glow System — brightness follows how close the elbow_angle is to the target
    // -----------------------------------------------------------------------

    /**
     * Update the target's glow intensity based on the player's current elbow angle.
     * Called by the GameMode/PlayerController each frame.
     *
     * @param PlayerElbowAngle  The patient's current elbow angle (0-180°).
     * @param TargetAngle       The angle required to hit this target.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Target|Glow")
    void UpdateGlowFromAngle(float PlayerElbowAngle, float TargetAngle);

    // -----------------------------------------------------------------------
    // Spline Movement
    // -----------------------------------------------------------------------

    /** Set the spline for curved movement. The target follows this path. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Target|Movement")
    void SetSplinePath(USplineComponent* InSpline);

    /** Should this target follow a spline instead of linear movement? */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|Movement")
    bool bUseSplineMovement = false;

    // -----------------------------------------------------------------------
    // Delegates
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Target|Events")
    FOnTargetDamaged OnTargetDamaged;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Target|Events")
    FOnTargetDestroyed OnTargetDestroyed;

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target")
    float Radius = 15.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target")
    float MoveSpeed = 0.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target")
    float RequiredAngle = 90.0f;

    /** Health: how many hits to destroy this target. 1 = instant, 2-3 = multi-hit. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|Health")
    int32 MaxHealth = 1;

    /** Spline movement speed multiplier (how fast it follows the spline). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|Movement")
    float SplineSpeed = 50.0f;

    /** Niagara system to spawn on destruction (glowing orb burst). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|VFX")
    class UNiagaraSystem* DestroyVFX;

    /** Sound to play on each hit (damage tick). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|Audio")
    class USoundBase* HitSound;

    /** Sound to play on destruction. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Target|Audio")
    class USoundBase* DestroySound;

protected:
    // -----------------------------------------------------------------------
    // Components
    // -----------------------------------------------------------------------

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Target|Components")
    UStaticMeshComponent* TargetMesh;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Target|Components")
    USphereComponent* CollisionSphere;

    /** Audio component for spatial hit sounds (attached to the target). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Target|Components")
    UAudioComponent* AudioComp;

    /** Optional Niagara component for constant idle particles (e.g., a gentle aura). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Target|Components")
    UNiagaraComponent* IdleNiagaraComp;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    bool bActive = true;
    int32 CurrentHealth = 1;

    // Linear movement (Phase 1 — kept for backward compat)
    FVector MoveDirection = FVector::RightVector;
    FVector MoveBounds = FVector(100.0f, 100.0f, 100.0f);

    // Spline movement (Phase 2)
    UPROPERTY()
    USplineComponent* FollowSpline = nullptr;
    float SplineDistance = 0.0f;
    float SplineDuration = 10.0f; // seconds to traverse the full spline

    // Dynamic glow material
    UPROPERTY()
    UMaterialInstanceDynamic* DynMaterial = nullptr;

    /** Current glow intensity (0-1). Updated by UpdateGlowFromAngle. */
    float CurrentGlow = 0.3f;

    /** Target glow intensity (interpolated toward). */
    float TargetGlow = 0.3f;

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** Play the destroy VFX (Niagara) at the target's location. */
    void PlayDestroyVFX();

    /** Play a spatial sound at the target's location. */
    void PlaySoundAt(USoundBase* Sound);

    /** Update the dynamic material's glow parameter. */
    void UpdateGlowMaterial();

    /** Movement via linear bounce (Phase 1 style). */
    void TickLinearMovement(float DeltaSeconds);

    /** Movement via spline (Phase 2 curved path). */
    void TickSplineMovement(float DeltaSeconds);
};
