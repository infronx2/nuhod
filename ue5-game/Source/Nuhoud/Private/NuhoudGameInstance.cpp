// ============================================================================
// NuhoudGameInstance.cpp
// ============================================================================

#include "NuhoudGameInstance.h"
#include "Kismet/GameplayStatics.h"

// Pixel Streaming (optional — guarded by #if WITH_EDITOR to avoid hard dep)
#if WITH_EDITOR
#include "Engine/Engine.h"
#endif

// Logging
DEFINE_LOG_CATEGORY_STATIC(LogNuhoudGI, Log, All);
#define LOG_NUHOUD_GI(Severity, Format, ...) UE_LOG(LogNuhoudGI, Severity, TEXT(Format), ##__VA_ARGS__)

// Save slot name
const FString UNuhoudSaveGame::SaveSlotName = TEXT("NuhoudSave");

// ---------------------------------------------------------------------------
// Save Game
// ---------------------------------------------------------------------------

UNuhoudSaveGame::UNuhoudSaveGame()
{
    SaveSlotName = TEXT("NuhoudSave");
}

// ---------------------------------------------------------------------------
// Game Instance
// ---------------------------------------------------------------------------

UNuhoudGameInstance::UNuhoudGameInstance()
{
}

void UNuhoudGameInstance::Init()
{
    Super::Init();

    // Detect where we're running.
    DetectRuntimeMode();

    // Read Pixel Streaming URL parameters (if applicable).
    ReadPixelStreamingParams();

    // Load saved auth state.
    LoadState();

    LOG_NUHOUD_GI(Log, TEXT("GameInstance initialized — Mode: %d, Logged in: %s"),
        static_cast<int32>(RuntimeMode), IsLoggedIn() ? TEXT("YES") : TEXT("NO"));
}

void UNuhoudGameInstance::Shutdown()
{
    SaveState();
    Super::Shutdown();
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

void UNuhoudGameInstance::SetAuthToken(const FString& Token, const FString& InPatientId, const FString& InPatientName)
{
    AuthToken = Token;
    PatientId = InPatientId;
    PatientName = InPatientName;
    SaveState();
    OnLoginStateChanged.Broadcast();

    LOG_NUHOUD_GI(Log, TEXT("Auth token set — Patient: %s (%s)"), *InPatientName, *InPatientId);
}

void UNuhoudGameInstance::Logout()
{
    AuthToken.Empty();
    PatientId.Empty();
    PatientName.Empty();
    SaveState();
    OnLoginStateChanged.Broadcast();

    LOG_NUHOUD_GI(Log, TEXT("Logged out"));
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

void UNuhoudGameInstance::SetPlanConfig(const FString& InPlanId, float InTargetAngle, const FString& InLimb)
{
    PlanId = InPlanId;
    TargetAngle = InTargetAngle;
    Limb = InLimb;
    SaveState();
}

// ---------------------------------------------------------------------------
// Runtime Mode
// ---------------------------------------------------------------------------

FString UNuhoudGameInstance::GetBackendURL() const
{
    if (IsPixelStreaming() && !PixelStreamBackendURL.IsEmpty())
    {
        return PixelStreamBackendURL;
    }
    // Default for APK / Editor — the Nuhoud backend.
    return TEXT("http://localhost:3000/api/v2");
}

FString UNuhoudGameInstance::GetWebSocketURL() const
{
    if (IsPixelStreaming() && !PixelStreamWebSocketURL.IsEmpty())
    {
        return PixelStreamWebSocketURL;
    }
    return TEXT("ws://localhost:8001/ws/track");
}

void UNuhoudGameInstance::DetectRuntimeMode()
{
#if WITH_EDITOR
    RuntimeMode = ENuhoudRuntimeMode::Editor;
    LOG_NUHOUD_GI(Log, TEXT("Runtime mode: Editor"));
#elif PLATFORM_ANDROID || PLATFORM_IOS
    RuntimeMode = ENuhoudRuntimeMode::APK;
    LOG_NUHOUD_GI(Log, TEXT("Runtime mode: APK (Mobile)"));
#else
    // Check for Pixel Streaming via command line or environment.
    // The Pixel Streaming plugin sets FCommandLine with -PixelStreamingIP.
    if (FParse::Param(FCommandLine::Get(), TEXT("PixelStreamingIP")))
    {
        RuntimeMode = ENuhoudRuntimeMode::PixelStream;
        LOG_NUHOUD_GI(Log, TEXT("Runtime mode: Pixel Streaming"));
    }
    else
    {
        RuntimeMode = ENuhoudRuntimeMode::APK;
        LOG_NUHOUD_GI(Log, TEXT("Runtime mode: Standalone (Desktop)"));
    }
#endif
}

void UNuhoudGameInstance::ReadPixelStreamingParams()
{
    if (!IsPixelStreaming())
        return;

    // Pixel Streaming passes URL query parameters via the browser.
    // These are accessible via FCommandLine or the Pixel Streaming plugin's
    // input config. In a full implementation, you'd use:
    //
    //   IPixelStreamingInputComponent::GetURLParameter("backend_url")
    //
    // For now, we read from FCommandLine as a fallback:
    FParse::Value(FCommandLine::Get(), TEXT("BackendURL="), PixelStreamBackendURL);
    FParse::Value(FCommandLine::Get(), TEXT("WebSocketURL="), PixelStreamWebSocketURL);

    // Also read patient_id if passed (for auto-login in hospital kiosk mode):
    FString AutoPatientId;
    if (FParse::Value(FCommandLine::Get(), TEXT("PatientId="), AutoPatientId))
    {
        LOG_NUHOUD_GI(Log, TEXT("Auto-login patient ID from URL: %s"), *AutoPatientId);
        PatientId = AutoPatientId;
    }

    if (!PixelStreamBackendURL.IsEmpty())
    {
        LOG_NUHOUD_GI(Log, TEXT("Pixel Streaming backend URL: %s"), *PixelStreamBackendURL);
    }
    if (!PixelStreamWebSocketURL.IsEmpty())
    {
        LOG_NUHOUD_GI(Log, TEXT("Pixel Streaming WebSocket URL: %s"), *PixelStreamWebSocketURL);
    }
}

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

void UNuhoudGameInstance::SaveState()
{
    if (UNuhoudSaveGame* Save = Cast<UNuhoudSaveGame>(
        UGameplayStatics::CreateSaveGameObject(UNuhoudSaveGame::StaticClass())))
    {
        Save->AuthToken = AuthToken;
        Save->PatientId = PatientId;
        Save->PatientName = PatientName;
        Save->PlanId = PlanId;
        Save->TargetAngle = TargetAngle;
        Save->Limb = Limb;

        UGameplayStatics::SaveGameToSlot(Save, UNuhoudSaveGame::SaveSlotName, 0);
        LOG_NUHOUD_GI(Log, TEXT("State saved to slot: %s"), *UNuhoudSaveGame::SaveSlotName);
    }
}

void UNuhoudGameInstance::LoadState()
{
    if (UGameplayStatics::DoesSaveGameExist(UNuhoudSaveGame::SaveSlotName, 0))
    {
        if (USaveGame* Loaded = UGameplayStatics::LoadGameFromSlot(UNuhoudSaveGame::SaveSlotName, 0))
        {
            if (UNuhoudSaveGame* Save = Cast<UNuhoudSaveGame>(Loaded))
            {
                AuthToken = Save->AuthToken;
                PatientId = Save->PatientId;
                PatientName = Save->PatientName;
                PlanId = Save->PlanId;
                TargetAngle = Save->TargetAngle;
                Limb = Save->Limb;

                LOG_NUHOUD_GI(Log, TEXT("State loaded — Patient: %s, Token: %s"),
                    *PatientName, AuthToken.IsEmpty() ? TEXT("none") : TEXT("present"));
            }
        }
    }
    else
    {
        LOG_NUHOUD_GI(Log, TEXT("No save game found — fresh start"));
    }
}
