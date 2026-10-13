// ============================================================================
// NuhoudPlayerController.cpp
// ============================================================================
// WebSocket client + JSON parser + VR/Flat detection.
//
// The incoming JSON from the Python server has two formats:
//
//   Simple (the user's Phase-1 spec):
//     {"elbow_angle": 45.0, "compensation_detected": false, "tracking_success": true}
//
//   Rich (the actual server response — superset):
//     {
//       "type": "tracking",
//       "elbow_angle": 45.5,
//       "compensation_detected": false,
//       "command": "KEEP_GOING",
//       "rep_count": 0,
//       "score": 0,
//       "max_achieved_angle": 45.5,
//       "visibility": 0.93,
//       "latency_ms": 12.3
//     }
//
// We handle both by checking for the presence of keys.
// ============================================================================

#include "NuhoudPlayerController.h"
#include "NuhoudGameMode.h"

// WebSocket module
#include "WebSocketsModule.h"
#include "IWebSocket.h"

// JSON
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "JsonUtilities.h"

// VR / OpenXR
#if WITH_EDITOR
#include "Engine/Engine.h"
#include "IXRTrackingSystem.h"
#endif

// Logging
DEFINE_LOG_CATEGORY_STATIC(LogNuhoudPC, Log, All);
#define LOG_NUHOUD_PC(Severity, Format, ...) UE_LOG(LogNuhoudPC, Severity, TEXT(Format), ##__VA_ARGS__)

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

ANuhoudPlayerController::ANuhoudPlayerController()
{
    // Enable ticking — we need it for smooth interpolation of the elbow angle.
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bTickEvenWhenPaused = false;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void ANuhoudPlayerController::BeginPlay()
{
    Super::BeginPlay();

    // Detect VR mode.
    DetectVRMode();

    // Auto-connect to the Python server.
    ConnectToServer();
}

void ANuhoudPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    DisconnectFromServer();
    Super::EndPlay(EndPlayReason);
}

void ANuhoudPlayerController::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Feed the latest tracking data to the GameMode.
    // This runs every frame, even if no new WebSocket message arrived,
    // so the GameMode always has the freshest elbow_angle.
    if (bTrackingSuccess)
    {
        if (ANuhoudGameMode* GM = Cast<ANuhoudGameMode>(GetWorld()->GetAuthGameMode()))
        {
            GM->ProcessTrackingData(CurrentElbowAngle, bCompensationDetected, bTrackingSuccess);
        }
    }
}

// ---------------------------------------------------------------------------
// VR Mode Detection
// ---------------------------------------------------------------------------

void ANuhoudPlayerController::DetectVRMode()
{
    bIsVRMode = false;

#if WITH_EDITOR
    if (GEngine && GEngine->XRSystem.IsValid())
    {
        bIsVRMode = GEngine->XRSystem->IsActive();
        LOG_NUHOUD_PC(Log, TEXT("OpenXR headset detected: %s"), bIsVRMode ? TEXT("YES → VR mode") : TEXT("NO → Flat mode"));
    }
#else
    // In a packaged build, check if the XR system is active.
    if (GEngine && GEngine->XRSystem.IsValid() && GEngine->XRSystem->IsActive())
    {
        bIsVRMode = true;
    }
#endif

    if (!bIsVRMode)
    {
        LOG_NUHOUD_PC(Log, TEXT("No VR headset detected → Flat screen mode"));
    }
}

// ---------------------------------------------------------------------------
// WebSocket — Connect / Disconnect / Send
// ---------------------------------------------------------------------------

void ANuhoudPlayerController::ConnectToServer()
{
    // Build the WebSocket URL with query parameters.
    FString URL = FString::Printf(TEXT("%s?limb=%s&target_angle=%.1f&compensation_threshold=%.3f"),
        *ServerURL, *Limb, TargetAngle, CompensationThreshold);

    // Append patient_id if available (for auto-sync to the Next.js DB).
    if (!PatientId.IsEmpty())
    {
        URL += FString::Printf(TEXT("&patient_id=%s"), *PatientId);
    }

    LOG_NUHOUD_PC(Log, TEXT("Connecting to WebSocket: %s"), *URL);

    // Create the WebSocket.
    if (!FModuleManager::Get().IsModuleLoaded("WebSockets"))
    {
        FModuleManager::Get().LoadModule("WebSockets");
    }

    WebSocket = FWebSocketsModule::Get().CreateWebSocket(URL, TEXT(""));

    // Bind handlers.
    WebSocket->OnConnected().AddUObject(this, &ANuhoudPlayerController::OnWebSocketConnected);
    WebSocket->OnConnectionError().AddUObject(this, &ANuhoudPlayerController::OnWebSocketConnectionError);
    WebSocket->OnClosed().AddUObject(this, &ANuhoudPlayerController::OnWebSocketClosed);
    WebSocket->OnMessage().AddUObject(this, &ANuhoudPlayerController::OnWebSocketMessage);

    // Connect.
    WebSocket->Connect();
}

void ANuhoudPlayerController::DisconnectFromServer()
{
    if (WebSocket.IsValid() && WebSocket->IsConnected())
    {
        WebSocket->Close(1000, TEXT("client_disconnect"));
    }
    WebSocket.Reset();
    LOG_NUHOUD_PC(Log, TEXT("WebSocket disconnected"));
}

void ANuhoudPlayerController::SendConfig(float NewTargetAngle, const FString& NewLimb, float NewCompensationThreshold)
{
    if (!IsConnected())
        return;

    // Build the JSON config message.
    FString JsonMsg = FString::Printf(
        TEXT("{\"type\":\"config\",\"target_angle\":%.1f,\"limb\":\"%s\",\"compensation_threshold\":%.3f}"),
        NewTargetAngle, *NewLimb, NewCompensationThreshold
    );

    WebSocket->Send(JsonMsg);
    LOG_NUHOUD_PC(Log, TEXT("Sent config: %s"), *JsonMsg);
}

bool ANuhoudPlayerController::IsConnected() const
{
    return WebSocket.IsValid() && WebSocket->IsConnected();
}

// ---------------------------------------------------------------------------
// WebSocket Event Handlers
// ---------------------------------------------------------------------------

void ANuhoudPlayerController::OnWebSocketConnected()
{
    LOG_NUHOUD_PC(Log, TEXT("✅ WebSocket connected to Python server"));
    OnConnectionStateChanged.Broadcast(true);
}

void ANuhoudPlayerController::OnWebSocketConnectionError(const FString& Error)
{
    LOG_NUHOUD_PC(Error, TEXT("❌ WebSocket connection error: %s"), *Error);
    OnConnectionStateChanged.Broadcast(false);
}

void ANuhoudPlayerController::OnWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
    LOG_NUHOUD_PC(Warning, TEXT("WebSocket closed: %d %s (clean=%s)"),
        StatusCode, *Reason, bWasClean ? TEXT("true") : TEXT("false"));
    OnConnectionStateChanged.Broadcast(false);
}

void ANuhoudPlayerController::OnWebSocketMessage(const FString& MessageString)
{
    ParseTrackingMessage(MessageString);
}

// ---------------------------------------------------------------------------
// JSON Parsing
// ---------------------------------------------------------------------------

void ANuhoudPlayerController::ParseTrackingMessage(const FString& MessageString)
{
    // Parse the JSON message.
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(MessageString);
    TSharedPtr<FJsonObject> JsonObject;
    if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
    {
        LOG_NUHOUD_PC(Warning, TEXT("Failed to parse JSON: %s"), *MessageString.Left(100));
        return;
    }

    // Check the message type. The server sends either:
    //   {"type": "tracking", ...}  — a tracking frame
    //   {"type": "error", ...}     — an error (NO_POSE, BAD_FRAME, etc.)
    FString MsgType;
    JsonObject->TryGetStringField(TEXT("type"), MsgType);

    if (MsgType == TEXT("error"))
    {
        // Error message — set tracking to failed.
        bTrackingSuccess = false;
        FString ErrorCode;
        JsonObject->TryGetStringField(TEXT("code"), ErrorCode);
        LOG_NUHOUD_PC(Warning, TEXT("Server error: %s"), *ErrorCode);
        return;
    }

    // --- Tracking message ---
    // Extract elbow_angle (handles both "elbow_angle" and null).
    const TSharedPtr<FJsonValue>* AngleVal = JsonObject->Values.Find(TEXT("elbow_angle"));
    if (AngleVal && AngleVal->IsValid())
    {
        float NewAngle = static_cast<float>((*AngleVal)->AsNumber());
        if (NewAngle >= 0.0f && NewAngle <= 180.0f)
        {
            CurrentElbowAngle = NewAngle;
        }
    }
    else
    {
        // elbow_angle is null → NO_POSE (person not found).
        bTrackingSuccess = false;
        return;
    }

    // Extract compensation_detected.
    const TSharedPtr<FJsonValue>* CompVal = JsonObject->Values.Find(TEXT("compensation_detected"));
    if (CompVal && CompVal->IsValid())
    {
        bCompensationDetected = (*CompVal)->AsBool();
    }

    // Extract tracking_success (simple format) or infer from command (rich format).
    const TSharedPtr<FJsonValue>* SuccessVal = JsonObject->Values.Find(TEXT("tracking_success"));
    if (SuccessVal && SuccessVal->IsValid())
    {
        bTrackingSuccess = (*SuccessVal)->AsBool();
    }
    else
    {
        // Rich format: if elbow_angle is non-null, tracking succeeded.
        bTrackingSuccess = true;
    }

    // Extract command (rich format only).
    const TSharedPtr<FJsonValue>* CmdVal = JsonObject->Values.Find(TEXT("command"));
    if (CmdVal && CmdVal->IsValid())
    {
        CurrentCommand = (*CmdVal)->AsString();
        OnCommandReceived.Broadcast(CurrentCommand);
    }

    // Broadcast the tracking data for the Pawn to use.
    OnTrackingDataReceived.Broadcast(CurrentElbowAngle, bCompensationDetected, bTrackingSuccess);
}
