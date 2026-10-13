// ============================================================================
// NuhoudPlayerController.h
// ============================================================================
// The PlayerController manages the WebSocket connection to the Python
// pose-tracking server and dispatches tracking data to the GameMode.
//
// It also handles the dual-mode architecture (VR vs Flat Screen) by
// choosing which Pawn to possess based on whether an OpenXR headset
// is connected.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "IWebSocket.h" // UE5 built-in WebSocket module
#include "NuhoudPlayerController.generated.h"

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when a new tracking message arrives from the Python server. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(
    FOnTrackingDataReceived,
    float, ElbowAngle,      // 0-180 degrees
    bool, bCompensation,    // true if shoulder shrug detected
    bool, bTrackingSuccess  // true if MediaPipe found a person
);

/** Fired when the WebSocket connection state changes. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FOnConnectionStateChanged,
    bool, bConnected
);

/** Fired when a command is received (KEEP_GOING, HOLD, TARGET_HIT, etc.). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(
    FOnCommandReceived,
    FString, Command
);

// ---------------------------------------------------------------------------
// PlayerController
// ---------------------------------------------------------------------------

/**
 * NuhoudPlayerController — the bridge between the Python pose-tracking
 * server and the UE5 game.
 *
 * Lifecycle:
 *   1. On BeginPlay, connects to ws://localhost:8001/ws/track.
 *   2. Receives JSON messages: {"elbow_angle": 45.0, "compensation_detected": false, "tracking_success": true}
 *      — also the richer format: {"type":"tracking", "elbow_angle":..., "command":"KEEP_GOING", ...}
 *   3. Parses the JSON and dispatches ElbowAngle + Compensation + TrackingSuccess
 *      to the GameMode via ProcessTrackingData().
 *   4. Also broadcasts via delegates for the Pawn to use (drives the VR hand / cursor).
 *   5. On EndPlay, closes the WebSocket.
 *
 * VR vs Flat:
 *   The controller checks for an active OpenXR headset at BeginPlay.
 *   If found → possesses a NuhoudVRPawn (VR mode).
 *   If not  → possesses a NuhoudFlatPawn (flat screen mode).
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    ANuhoudPlayerController();

    // -----------------------------------------------------------------------
    // AActor / APlayerController overrides
    // -----------------------------------------------------------------------

    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    virtual void Tick(float DeltaSeconds) override;

    // -----------------------------------------------------------------------
    // WebSocket Management
    // -----------------------------------------------------------------------

    /** Connect to the Python pose-tracking WebSocket server. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Network")
    void ConnectToServer();

    /** Disconnect from the server. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Network")
    void DisconnectFromServer();

    /** Send a config message to the server (e.g., change target angle). */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Network")
    void SendConfig(float TargetAngle, const FString& Limb, float CompensationThreshold);

    /** Is the WebSocket connected? */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Network")
    bool IsConnected() const;

    // -----------------------------------------------------------------------
    // Tracking Data (for Pawn consumption)
    // -----------------------------------------------------------------------

    /** The latest elbow angle (0-180 degrees). Updated each frame. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Tracking")
    float CurrentElbowAngle = 0.0f;

    /** True if compensation was detected in the last frame. */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Tracking")
    bool bCompensationDetected = false;

    /** True if tracking was successful (person found). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Tracking")
    bool bTrackingSuccess = false;

    /** The latest command from the server (KEEP_GOING, HOLD, etc.). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|Tracking")
    FString CurrentCommand = TEXT("NO_POSE");

    /** True if a VR headset is connected (OpenXR). */
    UPROPERTY(BlueprintReadOnly, Category = "Nuhoud|VR")
    bool bIsVRMode = false;

    // -----------------------------------------------------------------------
    // Delegates
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnTrackingDataReceived OnTrackingDataReceived;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnConnectionStateChanged OnConnectionStateChanged;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Events")
    FOnCommandReceived OnCommandReceived;

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /** The WebSocket URL of the Python server. Set in Blueprint or config. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString ServerURL = TEXT("ws://localhost:8001/ws/track");

    /** Patient ID to pass to the server (for auto-sync). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString PatientId = TEXT("");

    /** Target angle for the exercise. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    float TargetAngle = 90.0f;

    /** Which limb to track. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    FString Limb = TEXT("right");

    /** Compensation threshold (normalized Y). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Config")
    float CompensationThreshold = 0.05f;

private:
    // -----------------------------------------------------------------------
    // WebSocket instance
    // -----------------------------------------------------------------------

    /** The UE5 WebSocket instance. */
    TSharedPtr<IWebSocket> WebSocket;

    // -----------------------------------------------------------------------
    // Internal handlers
    // -----------------------------------------------------------------------

    void OnWebSocketConnected();
    void OnWebSocketConnectionError(const FString& Error);
    void OnWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
    void OnWebSocketMessage(const FString& MessageString);

    /** Parse the incoming JSON message from the Python server. */
    void ParseTrackingMessage(const FString& MessageString);

    /** Check if an OpenXR headset is connected and set bIsVRMode. */
    void DetectVRMode();
};
