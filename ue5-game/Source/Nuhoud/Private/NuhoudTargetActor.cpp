// ============================================================================
// NuhoudTargetActor.cpp — Phase 2
// ============================================================================
// Health system, spline movement, dynamic glow material, Niagara burst.
// ============================================================================

#include "NuhoudTargetActor.h"
#include "NuhoudGameMode.h"

#include "Components/StaticMeshComponent.h"
#include "Components/SphereComponent.h"
#include "Components/AudioComponent.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Kismet/GameplayStatics.h"
#include "Math/UnrealMathUtility.h"

ANuhoudTargetActor::ANuhoudTargetActor()
{
    PrimaryActorTick.bCanEverTick = true;

    // Collision
    CollisionSphere = CreateDefaultSubobject<USphereComponent>(TEXT("CollisionSphere"));
    CollisionSphere->SetupAttachment(RootComponent);
    CollisionSphere->SetSphereRadius(15.0f);
    CollisionSphere->SetCollisionProfileName(TEXT("OverlapAll"));

    // Mesh
    TargetMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("TargetMesh"));
    TargetMesh->SetupAttachment(CollisionSphere);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
    if (SphereMesh.Succeeded())
    {
        TargetMesh->SetStaticMesh(SphereMesh.Object);
    }
    TargetMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    // Audio component (for spatial 3D sounds)
    AudioComp = CreateDefaultSubobject<UAudioComponent>(TEXT("AudioComp"));
    AudioComp->SetupAttachment(CollisionSphere);
    AudioComp->bAutoActivate = false;

    // Niagara component (optional idle aura)
    IdleNiagaraComp = CreateDefaultSubobject<UNiagaraComponent>(TEXT("IdleNiagaraComp"));
    IdleNiagaraComp->SetupAttachment(CollisionSphere);
    IdleNiagaraComp->bAutoActivate = false;
}

void ANuhoudTargetActor::BeginPlay()
{
    Super::BeginPlay();

    // Init health
    CurrentHealth = MaxHealth;

    // Collision radius from config
    CollisionSphere->SetSphereRadius(Radius);
    TargetMesh->SetWorldScale3D(FVector(Radius / 50.0f));

    // Create the dynamic material instance so we can control glow at runtime
    if (TargetMesh && TargetMesh->GetMaterial(0))
    {
        DynMaterial = UMaterialInstanceDynamic::Create(TargetMesh->GetMaterial(0), this);
        TargetMesh->SetMaterial(0, DynMaterial);
    }

    // Random direction for linear movement
    if (MoveSpeed > 0.0f)
    {
        MoveDirection = FVector(
            FMath::FRandRange(-1.0f, 1.0f),
            FMath::FRandRange(-1.0f, 1.0f),
            FMath::FRandRange(-0.5f, 0.5f)
        ).GetSafeNormal();
    }

    // Calculate spline traversal duration
    if (FollowSpline)
    {
        float SplineLength = FollowSpline->GetSplineLength();
        SplineDuration = SplineLength / FMath::Max(1.0f, SplineSpeed);
    }
}

void ANuhoudTargetActor::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    if (!bActive) return;

    // Movement
    if (bUseSplineMovement && FollowSpline)
    {
        TickSplineMovement(DeltaSeconds);
    }
    else if (MoveSpeed > 0.0f)
    {
        TickLinearMovement(DeltaSeconds);
    }

    // Smoothly interpolate glow toward target value
    CurrentGlow = FMath::FInterpTo(CurrentGlow, TargetGlow, DeltaSeconds, 6.0f);
    UpdateGlowMaterial();
}

// ---------------------------------------------------------------------------
// Hit / Damage / Health
// ---------------------------------------------------------------------------

void ANuhoudTargetActor::OnHit()
{
    TakeDamage(1);
}

void ANuhoudTargetActor::TakeDamage(int32 Amount)
{
    if (!bActive) return;

    CurrentHealth -= Amount;

    // Play hit sound
    if (HitSound)
    {
        PlaySoundAt(HitSound);
    }

    // Visual feedback — flash the glow to 1.0 briefly
    TargetGlow = 1.0f;
    UpdateGlowMaterial();

    if (CurrentHealth <= 0)
    {
        // Target destroyed
        bActive = false;

        // Play destroy sound
        if (DestroySound)
        {
            PlaySoundAt(DestroySound);
        }

        // Spawn Niagara burst
        PlayDestroyVFX();

        // Notify delegates
        OnTargetDestroyed.Broadcast(this);

        // Notify GameMode
        if (UWorld* World = GetWorld())
        {
            if (ANuhoudGameMode* GM = Cast<ANuhoudGameMode>(World->GetAuthGameMode()))
            {
                GM->OnTargetHit();
            }
        }

        // Destroy after a short delay (let particles/sounds play)
        // In Blueprint, you'd use a Timeline for a nice scale-down animation.
        // For C++, we destroy immediately — the Niagara system persists.
        Destroy();
    }
    else
    {
        // Still alive — broadcast damage for UI
        OnTargetDamaged.Broadcast(this, CurrentHealth);
    }
}

// ---------------------------------------------------------------------------
// Glow System
// ---------------------------------------------------------------------------

void ANuhoudTargetActor::UpdateGlowFromAngle(float PlayerElbowAngle, float TargetAngle)
{
    // -----------------------------------------------------------------------
    // The target glows brighter as the patient's elbow angle approaches
    // the required angle for the exercise.
    //
    // Glow = 1.0 - (abs(PlayerAngle - TargetAngle) / Tolerance)
    //
    //   - At 0° difference  → Glow = 1.0 (fully bright — "you're there!")
    //   - At 45° difference → Glow ≈ 0.0 (dim — "keep going")
    //   - Tolerance = 45° (the range over which the glow ramps up)
    // -----------------------------------------------------------------------

    const float Tolerance = 45.0f;
    float Delta = FMath::Abs(PlayerElbowAngle - TargetAngle);
    TargetGlow = FMath::Clamp(1.0f - (Delta / Tolerance), 0.15f, 1.0f);
}

void ANuhoudTargetActor::UpdateGlowMaterial()
{
    if (DynMaterial)
    {
        // The material must have a scalar parameter named "GlowIntensity"
        DynMaterial->SetScalarParameterValue(FName("GlowIntensity"), CurrentGlow);

        // Optionally change the emissive color based on health:
        // Green (full health) → Amber (mid) → Red (about to break)
        if (MaxHealth > 1)
        {
            float HealthRatio = GetHealthRatio();
            // Blend: Green at 1.0, Amber at 0.5, Red at 0.0
            FLinearColor GlowColor = FLinearColor::LerpUsingHSV(
                FLinearColor::Red,
                FLinearColor::Green,
                HealthRatio
            );
            DynMaterial->SetVectorParameterValue(FName("GlowColor"), GlowColor);
        }
    }
}

// ---------------------------------------------------------------------------
// Spline Movement
// ---------------------------------------------------------------------------

void ANuhoudTargetActor::SetSplinePath(USplineComponent* InSpline)
{
    FollowSpline = InSpline;
    bUseSplineMovement = (InSpline != nullptr);
    SplineDistance = 0.0f;

    if (FollowSpline)
    {
        float SplineLength = FollowSpline->GetSplineLength();
        SplineDuration = SplineLength / FMath::Max(1.0f, SplineSpeed);
    }
}

void ANuhoudTargetActor::TickSplineMovement(float DeltaSeconds)
{
    if (!FollowSpline) return;

    // Advance along the spline
    SplineDistance += SplineSpeed * DeltaSeconds;
    float SplineLength = FollowSpline->GetSplineLength();

    // Loop back to the start when we reach the end
    if (SplineDistance > SplineLength)
    {
        SplineDistance = 0.0f;
    }

    // Get the world position at the current spline distance
    FVector NewPos = FollowSpline->GetLocationAtDistanceAlongSpline(SplineDistance, ESplineCoordinateSpace::World);
    SetActorLocation(NewPos);
}

void ANuhoudTargetActor::TickLinearMovement(float DeltaSeconds)
{
    // Phase 1 linear bounce movement (kept for backward compat)
    FVector NewLocation = GetActorLocation() + MoveDirection * MoveSpeed * DeltaSeconds;
    FVector Origin = GetOwner() ? GetOwner()->GetActorLocation() : FVector::ZeroVector;

    for (int32 i = 0; i < 3; i++)
    {
        if (FMath::Abs(NewLocation[i] - Origin[i]) > MoveBounds[i])
        {
            MoveDirection[i] *= -1.0f;
            NewLocation[i] = Origin[i] + FMath::Sign(NewLocation[i] - Origin[i]) * MoveBounds[i];
        }
    }

    SetActorLocation(NewLocation);
}

// ---------------------------------------------------------------------------
// VFX + Audio Helpers
// ---------------------------------------------------------------------------

void ANuhoudTargetActor::PlayDestroyVFX()
{
    if (DestroyVFX)
    {
        UNiagaraFunctionLibrary::SpawnSystemAtLocation(
            GetWorld(),
            DestroyVFX,
            GetActorLocation(),
            GetActorRotation(),
            FVector(1.0f),
            true, // auto-destroy
            true  // auto-activate
        );
    }
}

void ANuhoudTargetActor::PlaySoundAt(USoundBase* Sound)
{
    if (Sound)
    {
        UGameplayStatics::PlaySoundAtLocation(
            GetWorld(),
            Sound,
            GetActorLocation()
        );
    }
}
