// ============================================================================
// NuhoudPawns.cpp
// ============================================================================
// Implementation of the VR and Flat screen pawns.
//
// The core mapping logic:
//
//   VR Hand:
//     TargetHandPosition = ShoulderOffset + ArmForwardDirection * (Angle / 180) * MaxReach
//     CurrentPosition = FInterpTo(CurrentPosition, TargetHandPosition, DeltaTime, InterpSpeed)
//
//   Flat Cursor:
//     Y = FMath::Lerp(MinY, MaxY, Angle / 180.0f)
//     X = SwayAmplitude * Sin(2π * SwayFrequency * ElapsedTime)
//     Z = 0 (fixed depth)
// ============================================================================

#include "NuhoudPawns.h"
#include "NuhoudPlayerController.h"

#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "Math/UnrealMathUtility.h"

// Logging
DEFINE_LOG_CATEGORY_STATIC(LogNuhoudPawn, Log, All);
#define LOG_NUHOUD_PAWN(Severity, Format, ...) UE_LOG(LogNuhoudPawn, Severity, TEXT(Format), ##__VA_ARGS__)

// ===========================================================================
// VR PAWN
// ===========================================================================

ANuhoudVRPawn::ANuhoudVRPawn()
{
    PrimaryActorTick.bCanEverTick = true;

    // VR Camera — stereo rendering is handled by the OpenXR plugin.
    VRCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("VRCamera"));
    VRCamera->SetupAttachment(RootComponent);
    VRCamera->bLockToHmd = true; // Follow the headset position/rotation.

    // Right hand mesh — the virtual hand driven by the elbow angle.
    RightHandMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightHandMesh"));
    RightHandMesh->SetupAttachment(RootComponent);

    // Left hand mesh — parked at a neutral position.
    LeftHandMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftHandMesh"));
    LeftHandMesh->SetupAttachment(RootComponent);

    // Default hand mesh: a simple sphere.
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(
        TEXT("/Engine/BasicShapes/Sphere.Sphere")
    );
    if (SphereMesh.Succeeded())
    {
        RightHandMesh->SetStaticMesh(SphereMesh.Object);
        LeftHandMesh->SetStaticMesh(SphereMesh.Object);
        RightHandMesh->SetWorldScale3D(FVector(0.1f)); // 10cm sphere
        LeftHandMesh->SetWorldScale3D(FVector(0.1f));
    }
}

void ANuhoudVRPawn::BeginPlay()
{
    Super::BeginPlay();

    // Cache the owning PlayerController.
    OwningPC = Cast<ANuhoudPlayerController>(GetController());

    // Park the left hand at a neutral position.
    if (LeftHandMesh)
    {
        // Mirror the shoulder offset for the left side.
        LeftHandMesh->SetRelativeLocation(FVector(ShoulderOffset.X, -ShoulderOffset.Y, ShoulderOffset.Z) +
                                          FVector(30.0f, 0.0f, 0.0f));
    }

    // Initialize the right hand at the shoulder position.
    TargetHandPosition = ShoulderOffset;
    if (RightHandMesh)
    {
        RightHandMesh->SetRelativeLocation(ShoulderOffset);
    }

    LOG_NUHOUD_PAWN(Log, TEXT("VR Pawn initialized — MaxReach: %.0fcm"), MaxReach);
}

void ANuhoudVRPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Interpolate the hand mesh toward the target position.
    if (RightHandMesh)
    {
        FVector CurrentPos = RightHandMesh->GetRelativeLocation();
        FVector NewPos = FMath::VInterpTo(CurrentPos, TargetHandPosition, DeltaSeconds, InterpSpeed);
        RightHandMesh->SetRelativeLocation(NewPos);
    }
}

void ANuhoudVRPawn::UpdateHandFromAngle(float ElbowAngle)
{
    // -----------------------------------------------------------------------
    // Mapping: elbow angle → VR hand position
    //
    //   0°   (fully flexed)  → hand at shoulder (close to body)
    //   90°  (half extended)  → hand at half reach
    //   180° (fully extended) → hand at full reach (MaxReach cm from shoulder)
    //
    // The hand moves along the ArmForwardDirection vector, starting from
    // the ShoulderOffset. This gives the patient intuitive control:
    // flexing the elbow pulls the hand in; extending pushes it out.
    //
    // For a proper VR experience, you'd add inverse kinematics (IK) on
    // a skeletal mesh to animate the arm joints. But for Phase 1, this
    // direct mapping is clear, performant, and clinically adequate.
    // -----------------------------------------------------------------------

    // Normalize the angle to 0-1 range.
    float NormalizedAngle = FMath::Clamp(ElbowAngle / 180.0f, 0.0f, 1.0f);

    // Calculate the reach distance.
    float ReachDistance = NormalizedAngle * MaxReach;

    // Compute the target hand position.
    // Start at the shoulder, extend forward proportional to the angle.
    FVector Direction = ArmForwardDirection.GetSafeNormal();
    TargetHandPosition = ShoulderOffset + Direction * ReachDistance;

    // If the left arm is affected, mirror the X offset.
    if (!bRightArmAffected)
    {
        TargetHandPosition.Y = -TargetHandPosition.Y;
    }
}

// ===========================================================================
// FLAT SCREEN PAWN
// ===========================================================================

ANuhoudFlatPawn::ANuhoudFlatPawn()
{
    PrimaryActorTick.bCanEverTick = true;

    // Spring arm for the third-person camera.
    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
    CameraBoom->SetupAttachment(RootComponent);
    CameraBoom->TargetArmLength = 300.0f; // 3 meters behind the player.
    CameraBoom->bDoCollisionTest = false; // No collision for the boom.

    // Third-person camera.
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);

    // The cursor mesh — a glowing sphere the player controls.
    CursorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("CursorMesh"));
    CursorMesh->SetupAttachment(RootComponent);

    // Default: a sphere.
    static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(
        TEXT("/Engine/BasicShapes/Sphere.Sphere")
    );
    if (SphereMesh.Succeeded())
    {
        CursorMesh->SetStaticMesh(SphereMesh.Object);
        CursorMesh->SetWorldScale3D(FVector(0.15f)); // 15cm cursor
    }
}

void ANuhoudFlatPawn::BeginPlay()
{
    Super::BeginPlay();

    OwningPC = Cast<ANuhoudPlayerController>(GetController());

    // Initialize the cursor at the center.
    TargetCursorPos = FVector(0.0f, 0.0f, (MinY + MaxY) / 2.0f);
    if (CursorMesh)
    {
        CursorMesh->SetRelativeLocation(TargetCursorPos);
    }

    LOG_NUHOUD_PAWN(Log, TEXT("Flat Pawn initialized — MinY: %.0f, MaxY: %.0f"), MinY, MaxY);
}

void ANuhoudFlatPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    ElapsedTime += DeltaSeconds;

    // Interpolate the cursor toward the target.
    if (CursorMesh)
    {
        FVector CurrentPos = CursorMesh->GetRelativeLocation();
        FVector NewPos = FMath::VInterpTo(CurrentPos, TargetCursorPos, DeltaSeconds, InterpSpeed);
        CursorMesh->SetRelativeLocation(NewPos);
    }
}

void ANuhoudFlatPawn::UpdateCursorFromAngle(float ElbowAngle)
{
    // -----------------------------------------------------------------------
    // Mapping: elbow angle → 2D cursor position (flat screen)
    //
    //   Y axis (vertical):
    //     0°   → MinY (bottom of the screen, arm flexed)
    //     180° → MaxY (top of the screen, arm extended)
    //
    //   X axis (horizontal):
    //     Slight sine-wave sway for a natural, non-robotic feel.
    //     The sway amplitude and frequency are configurable.
    //
    //   Z axis (depth):
    //     Fixed at 0 — the cursor stays in the camera plane.
    //
    // This mapping is intentionally simple for Phase 1. In a production
    // game, you'd add:
    //   - Particle trails behind the cursor
    //   - Haptic feedback (mobile vibration) on target hits
    //   - A depth component (Z axis) driven by the arm's forward reach
    // -----------------------------------------------------------------------

    // Normalize the angle to 0-1.
    float NormalizedAngle = FMath::Clamp(ElbowAngle / 180.0f, 0.0f, 1.0f);

    // Y: linear interpolation from MinY to MaxY.
    float Y = FMath::Lerp(MinY, MaxY, NormalizedAngle);

    // X: sine-wave sway.
    float X = SwayAmplitude * FMath::Sin(2.0f * PI * SwayFrequency * ElapsedTime);

    // Z: fixed at 0 (camera plane).
    float Z = 0.0f;

    TargetCursorPos = FVector(X, 0.0f, Y);
    // Note: in UE5, "up" is +Z, so we use Z for vertical and X for horizontal.
    // Adjust based on your camera orientation.
}
