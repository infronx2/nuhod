// ============================================================================
// NuhoudPawns.h
// ============================================================================
// VR + Flat screen pawns that map the elbow_angle to a virtual hand / cursor.
//
// The mapping strategy:
//
//   VR Mode (NuhoudVRPawn):
//     The elbow_angle (0-180°) drives the RIGHT hand's position via a
//     simple forward-kinematics mapping:
//       - At 0° (arm fully flexed): hand is near the shoulder (close to body)
//       - At 180° (arm fully extended): hand is at full reach (away from body)
//     The hand position is interpolated along a vector from the shoulder
//     outward, with the distance proportional to the angle.
//
//   Flat Mode (NuhoudFlatPawn):
//     The elbow_angle drives a 2D cursor on the screen:
//       - At 0°: cursor is at the bottom center (arm flexed)
//       - At 180°: cursor is at the top center (arm extended)
//     The cursor moves vertically (Y axis) proportional to the angle.
//     We add slight horizontal sway for a natural feel.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "NuhoudPawns.generated.h"

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------

class ANuhoudPlayerController;
class UMotionControllerComponent;
class USkeletalMeshComponent;
class UStaticMeshComponent;
class UCameraComponent;
class USpringArmComponent;

// ---------------------------------------------------------------------------
// VR Pawn
// ---------------------------------------------------------------------------

/**
 * NuhoudVRPawn — the pawn for VR (OpenXR) mode.
 *
 * The player's real elbow angle (from the Python WebSocket) drives
 * the virtual right hand position. We use a simple FK mapping:
 *
 *   HandPosition = ShoulderPosition + ForwardVector * (Angle / 180) * MaxReach
 *
 * This gives the patient intuitive control: flexing the elbow moves
 * the virtual hand toward the body; extending moves it outward.
 *
 * The left hand is parked at a neutral position (we only exercise
 * one arm at a time — the affected side).
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudVRPawn : public APawn
{
    GENERATED_BODY()

public:
    ANuhoudVRPawn();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    /**
     * Update the virtual hand position based on the elbow angle.
     * Called from the PlayerController each frame (or bound to the
     * OnTrackingDataReceived delegate).
     *
     * @param ElbowAngle  0-180 degrees (0 = fully flexed, 180 = fully extended)
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|VR")
    void UpdateHandFromAngle(float ElbowAngle);

    // -----------------------------------------------------------------------
    // Components
    // -----------------------------------------------------------------------

    /** The VR camera (stereo rendering for OpenXR). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|VR|Components")
    UCameraComponent* VRCamera;

    /** The right hand mesh (visual representation of the virtual hand). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|VR|Components")
    UStaticMeshComponent* RightHandMesh;

    /** The left hand mesh (parked — not driven by tracking). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|VR|Components")
    UStaticMeshComponent* LeftHandMesh;

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /** Maximum reach distance (cm) when the elbow is fully extended (180°). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|VR|Config")
    float MaxReach = 100.0f;

    /** The shoulder offset from the camera (where the arm originates). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|VR|Config")
    FVector ShoulderOffset = FVector(0.0f, 30.0f, -20.0f);

    /** The forward direction the arm extends toward. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|VR|Config")
    FVector ArmForwardDirection = FVector(1.0f, 0.0f, 0.0f);

    /** Interpolation speed for smooth hand movement (higher = snappier). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|VR|Config")
    float InterpSpeed = 8.0f;

    /** Which side is affected (right or left) — determines which hand is driven. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|VR|Config")
    bool bRightArmAffected = true;

protected:
    /** The target hand position (interpolated toward each frame). */
    FVector TargetHandPosition = FVector::ZeroVector;

    /** Ref to the player controller for tracking data access. */
    UPROPERTY()
    ANuhoudPlayerController* OwningPC = nullptr;
};

// ---------------------------------------------------------------------------
// Flat Screen Pawn
// ---------------------------------------------------------------------------

/**
 * NuhoudFlatPawn — the pawn for flat screen (PC/Mobile) mode.
 *
 * The elbow angle drives a 2D cursor on the screen:
 *   - Y axis (vertical): mapped from elbow_angle (0° = bottom, 180° = top)
 *   - X axis (horizontal): slight sine-wave sway for natural feel
 *
 * The cursor is a UStaticMeshComponent (a glowing sphere) that
 * the player sees from a third-person perspective.
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudFlatPawn : public APawn
{
    GENERATED_BODY()

public:
    ANuhoudFlatPawn();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    /**
     * Update the cursor position based on the elbow angle.
     *
     * @param ElbowAngle  0-180 degrees
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Flat")
    void UpdateCursorFromAngle(float ElbowAngle);

    // -----------------------------------------------------------------------
    // Components
    // -----------------------------------------------------------------------

    /** Third-person camera. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Flat|Components")
    UCameraComponent* Camera;

    /** Spring arm for the third-person camera. */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Flat|Components")
    USpringArmComponent* CameraBoom;

    /** The cursor mesh (glowing sphere the player controls). */
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Flat|Components")
    UStaticMeshComponent* CursorMesh;

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /** Minimum cursor Y position (when angle = 0°). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Flat|Config")
    float MinY = -50.0f;

    /** Maximum cursor Y position (when angle = 180°). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Flat|Config")
    float MaxY = 150.0f;

    /** Amplitude of the horizontal sway (cm). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Flat|Config")
    float SwayAmplitude = 15.0f;

    /** Frequency of the horizontal sway (Hz). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Flat|Config")
    float SwayFrequency = 0.5f;

    /** Interpolation speed for smooth cursor movement. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Flat|Config")
    float InterpSpeed = 10.0f;

protected:
    /** Target cursor position (interpolated toward each frame). */
    FVector TargetCursorPos = FVector::ZeroVector;

    /** Elapsed time for the sway sine wave. */
    float ElapsedTime = 0.0f;

    /** Ref to the player controller. */
    UPROPERTY()
    ANuhoudPlayerController* OwningPC = nullptr;
};
