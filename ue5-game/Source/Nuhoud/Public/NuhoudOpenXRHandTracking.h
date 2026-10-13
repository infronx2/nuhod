// ============================================================================
// NuhoudOpenXRHandTracking.h
// ============================================================================
// Upgrades the VR Pawn with OpenXR Hand Tracking + IK mapping.
//
// The elbow_angle from the Python server drives the VR hand position
// via a 2-bone IK solver (upper arm + forearm). The virtual hand moves
// exactly as the patient's physical hand moves, but driven by the
// external camera (MediaPipe) rather than the headset's hand tracking.
//
// If OpenXR hand tracking is active (controllers not held), we use the
// real XR hand positions. Otherwise, we fall back to the elbow_angle
// FK mapping from Phase 1.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudOpenXRHandTracking.generated.h"

class UMotionControllerComponent;
class USkeletalMeshComponent;
class UAnimInstance;

// ---------------------------------------------------------------------------
// Hand Tracking Mode
// ---------------------------------------------------------------------------

UENUM(BlueprintType)
enum class ENuhoudHandTrackingMode : uint8
{
    /** Driven by the Python WebSocket elbow_angle (default — no XR hand tracking). */
    ElbowAngleDriven  UMETA(DisplayName = "Elbow Angle Driven (MediaPipe)"),

    /** Driven by OpenXR hand tracking (when controllers are not held). */
    OpenXRHandTracking UMETA(DisplayName = "OpenXR Hand Tracking"),

    /** Driven by motion controllers (when the patient holds controllers). */
    MotionController   UMETA(DisplayName = "Motion Controller"),
};

// ---------------------------------------------------------------------------
// OpenXR Hand Tracking Component
// ---------------------------------------------------------------------------

/**
 * A component that manages the VR hand tracking + IK mapping for the
 * NuhoudVRPawn. It sits on the Pawn and updates each frame.
 *
 * Blueprint setup:
 *   Add this component to BP_NuhoudVRPawn. Assign the hand skeletal
 *   meshes (left + right). The component handles the rest.
 */
UCLASS(Blueprintable, BlueprintType, ClassGroup = "Nuhoud", meta = (BlueprintSpawnableComponent))
class NUHOUD_API UNuhoudOpenXRHandTracking : public UActorComponent
{
    GENERATED_BODY()

public:
    UNuhoudOpenXRHandTracking();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, enum ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

    // -----------------------------------------------------------------------
    // Input — called by the PlayerController each frame
    // -----------------------------------------------------------------------

    /**
     * Update the IK hand position based on the elbow angle.
     * @param ElbowAngle  0-180 degrees (from the Python server).
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|HandTracking")
    void UpdateElbowAngle(float ElbowAngle);

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /** The right hand skeletal mesh (for IK animation). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    USkeletalMeshComponent* RightHandMesh;

    /** The left hand skeletal mesh (for IK animation). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    USkeletalMeshComponent* LeftHandMesh;

    /** Right motion controller (disabled if hand tracking is active). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    UMotionControllerComponent* RightMotionController;

    /** Left motion controller. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    UMotionControllerComponent* LeftMotionController;

    /** Maximum reach distance (cm) when elbow is fully extended. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    float MaxReach = 100.0f;

    /** Shoulder offset from the camera. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    FVector ShoulderOffset = FVector(0.0f, 30.0f, -20.0f);

    /** Interpolation speed for smooth hand movement. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    float InterpSpeed = 8.0f;

    /** Which arm is affected (right = true, left = false). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|HandTracking|Config")
    bool bRightArmAffected = true;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /** The current hand tracking mode. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|HandTracking|State")
    ENuhoudHandTrackingMode CurrentMode = ENuhoudHandTrackingMode::ElbowAngleDriven;

    /** Is OpenXR hand tracking available? */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|HandTracking|State")
    bool bOpenXRHandTrackingAvailable = false;

protected:
    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** The target IK hand position (interpolated toward). */
    FVector TargetHandPosition = FVector::ZeroVector;

    /** The current elbow angle (0-180°). */
    float CurrentElbowAngle = 0.0f;

    /** Detect if OpenXR hand tracking is active. */
    void DetectHandTrackingMode();

    /** Update the hand position using FK (elbow angle → position). */
    void UpdateFKHandPosition(float DeltaTime);

    /** Update the hand position using OpenXR hand tracking data. */
    void UpdateOpenXRHandPosition(float DeltaTime);

    /** Disable motion controllers (when hand tracking is active). */
    void DisableControllers();

    /** Enable motion controllers (when the patient holds them). */
    void EnableControllers();
};
