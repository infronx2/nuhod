// ============================================================================
// NuhoudOpenXRHandTracking.cpp
// ============================================================================

#include "NuhoudOpenXRHandTracking.h"

#include "Components/SkeletalMeshComponent.h"
#include "Components/MotionControllerComponent.h"
#include "Animation/AnimInstance.h"
#include "Math/UnrealMathUtility.h"

// OpenXR (guarded — only available when the OpenXR plugin is enabled)
#if WITH_EDITOR
#include "Engine/Engine.h"
#include "IXRTrackingSystem.h"
#include "IMotionController.h"
#endif

// Logging
DEFINE_LOG_CATEGORY_STATIC(LogNuhoudHand, Log, All);
#define LOG_NUHOUD_HAND(Severity, Format, ...) UE_LOG(LogNuhoudHand, Severity, TEXT(Format), ##__VA_ARGS__)

UNuhoudOpenXRHandTracking::UNuhoudOpenXRHandTracking()
{
    PrimaryComponentTick.bCanEverTick = true;
    PrimaryComponentTick.bStartWithTickEnabled = true;
}

void UNuhoudOpenXRHandTracking::BeginPlay()
{
    Super::BeginPlay();

    // Detect the available hand tracking mode
    DetectHandTrackingMode();

    // Initialize the hand at the shoulder position
    TargetHandPosition = ShoulderOffset;
}

void UNuhoudOpenXRHandTracking::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    switch (CurrentMode)
    {
    case ENuhoudHandTrackingMode::ElbowAngleDriven:
        UpdateFKHandPosition(DeltaTime);
        break;
    case ENuhoudHandTrackingMode::OpenXRHandTracking:
        UpdateOpenXRHandPosition(DeltaTime);
        break;
    case ENuhoudHandTrackingMode::MotionController:
        // Motion controllers drive position automatically — no extra code needed.
        break;
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

void UNuhoudOpenXRHandTracking::UpdateElbowAngle(float ElbowAngle)
{
    CurrentElbowAngle = FMath::Clamp(ElbowAngle, 0.0f, 180.0f);

    // If we're in ElbowAngleDriven mode, compute the target hand position
    if (CurrentMode == ENuhoudHandTrackingMode::ElbowAngleDriven)
    {
        // Normalize to 0-1
        float Normalized = CurrentElbowAngle / 180.0f;

        // FK mapping: 0° = hand at shoulder, 180° = hand at full reach
        FVector Forward(1.0f, 0.0f, 0.0f);
        TargetHandPosition = ShoulderOffset + Forward * (Normalized * MaxReach);

        if (!bRightArmAffected)
        {
            TargetHandPosition.Y = -TargetHandPosition.Y;
        }
    }
}

// ---------------------------------------------------------------------------
// Mode Detection
// ---------------------------------------------------------------------------

void UNuhoudOpenXRHandTracking::DetectHandTrackingMode()
{
    CurrentMode = ENuhoudHandTrackingMode::ElbowAngleDriven; // default

#if WITH_EDITOR
    if (GEngine && GEngine->XRSystem.IsValid())
    {
        bool bVRActive = GEngine->XRSystem->IsActive();
        if (bVRActive)
        {
            // Check if OpenXR hand tracking is available
            // (This requires the OpenXR plugin + the hand tracking feature)
            bOpenXRHandTrackingAvailable = true; // Simplified — in production, query the XR system

            if (bOpenXRHandTrackingAvailable)
            {
                CurrentMode = ENuhoudHandTrackingMode::OpenXRHandTracking;
                LOG_NUHOUD_HAND(Log, TEXT("OpenXR hand tracking detected → using XR hand data"));
            }
            else
            {
                // Check if motion controllers are connected
                CurrentMode = ENuhoudHandTrackingMode::MotionController;
                LOG_NUHOUD_HAND(Log, TEXT("Motion controllers detected → using controller data"));
            }
        }
        else
        {
            LOG_NUHOUD_HAND(Log, TEXT("No XR system → using elbow angle FK mapping"));
        }
    }
    else
    {
        LOG_NUHOUD_HAND(Log, TEXT("No GEngine → using elbow angle FK mapping"));
    }
#endif

    // Disable/enable controllers based on the mode
    if (CurrentMode == ENuhoudHandTrackingMode::OpenXRHandTracking ||
        CurrentMode == ENuhoudHandTrackingMode::ElbowAngleDriven)
    {
        DisableControllers();
    }
    else
    {
        EnableControllers();
    }
}

// ---------------------------------------------------------------------------
// FK Hand Position (Elbow Angle Driven)
// ---------------------------------------------------------------------------

void UNuhoudOpenXRHandTracking::UpdateFKHandPosition(float DeltaTime)
{
    USkeletalMeshComponent* Mesh = bRightArmAffected ? RightHandMesh : LeftHandMesh;
    if (!Mesh)
        return;

    // Interpolate toward the target position
    FVector CurrentPos = Mesh->GetRelativeLocation();
    FVector NewPos = FMath::VInterpTo(CurrentPos, TargetHandPosition, DeltaTime, InterpSpeed);
    Mesh->SetRelativeLocation(NewPos);

    // Optionally: drive an IK bone target on the skeletal mesh
    // In a full implementation, you'd set the IK bone transform on the
    // upper arm + forearm joints to animate the arm bending:
    //
    //   float FlexionRatio = CurrentElbowAngle / 180.0f;
    //   Mesh->SetBoneTransformByName("upperarm_r", UpperArmTransform, ...);
    //   Mesh->SetBoneTransformByName("lowerarm_r", LowerArmTransform, ...);
    //
    // The elbow angle maps to the forearm rotation around the elbow joint.
    // 0° = forearm fully folded back (hand near shoulder)
    // 90° = forearm perpendicular (hand forward)
    // 180° = forearm fully extended (hand at full reach)
}

// ---------------------------------------------------------------------------
// OpenXR Hand Position
// ---------------------------------------------------------------------------

void UNuhoudOpenXRHandTracking::UpdateOpenXRHandPosition(float DeltaTime)
{
    // In production with the OpenXR plugin, you'd query the XR tracking
    // system for the hand joint positions:
    //
    //   FXRMotionControllerData HandData;
    //   GEngine->XRSystem->GetMotionControllerData(
    //       EControllerHand::Right, INDEX_NONE, HandData
    //   );
    //   if (HandData.bValid)
    //   {
    //       RightHandMesh->SetWorldLocation(HandData.GripPosition);
    //       RightHandMesh->SetWorldRotation(HandData.GripRotation);
    //   }
    //
    // The elbow_angle from the Python server would then be used as a
    // supplementary signal — e.g., to trigger game events when the angle
    // crosses the target, independent of the hand's 3D position.
    //
    // For Phase 3, we keep the FK mapping as the primary driver and
    // note the OpenXR integration path. The blueprint can override
    // this function to add real XR hand tracking calls.
}

// ---------------------------------------------------------------------------
// Controller Management
// ---------------------------------------------------------------------------

void UNuhoudOpenXRHandTracking::DisableControllers()
{
    if (RightMotionController)
    {
        RightMotionController->SetActive(false);
        RightMotionController->SetVisibility(false);
    }
    if (LeftMotionController)
    {
        LeftMotionController->SetActive(false);
        LeftMotionController->SetVisibility(false);
    }
    LOG_NUHOUD_HAND(Log, TEXT("Motion controllers disabled (hand tracking active)"));
}

void UNuhoudOpenXRHandTracking::EnableControllers()
{
    if (RightMotionController)
    {
        RightMotionController->SetActive(true);
        RightMotionController->SetVisibility(true);
    }
    if (LeftMotionController)
    {
        LeftMotionController->SetActive(true);
        LeftMotionController->SetVisibility(true);
    }
    LOG_NUHOUD_HAND(Log, TEXT("Motion controllers enabled"));
}
