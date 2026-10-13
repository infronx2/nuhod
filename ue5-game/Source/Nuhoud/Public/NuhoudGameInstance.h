// ============================================================================
// NuhoudGameInstance.h
// ============================================================================
// Persistent game instance — stores the JWT auth token, patient config,
// and runtime mode (APK vs Pixel Streaming). Survives level transitions.
//
// The token is saved to a USaveGame so the patient doesn't re-login every
// time they launch the app. The GameMode reads the token from here to
// attach it to POST /api/v2/sessions.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "NuhoudGameInstance.generated.h"

class USaveGame;

// ---------------------------------------------------------------------------
// Save Game for persisting the auth token + patient config
// ---------------------------------------------------------------------------

UCLASS()
class NUHOUD_API UNuhoudSaveGame : public USaveGame
{
    GENERATED_BODY()

public:
    UNuhoudSaveGame();

    /** The JWT auth token (stored encrypted in a real deployment). */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    FString AuthToken;

    /** The patient ID. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    FString PatientId;

    /** The patient display name. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    FString PatientName;

    /** The treatment plan ID (if assigned). */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    FString PlanId;

    /** The target angle from the plan. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    float TargetAngle = 90.0f;

    /** Which limb is affected. */
    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Save")
    FString Limb = TEXT("right");

    /** Save slot name. */
    static const FString SaveSlotName;
};

// ---------------------------------------------------------------------------
// Runtime mode — APK vs Pixel Streaming
// ---------------------------------------------------------------------------

UENUM(BlueprintType)
enum class ENuhoudRuntimeMode : uint8
{
    APK         UMETA(DisplayName = "APK — running locally on device"),
    PixelStream UMETA(DisplayName = "Pixel Streaming — running on server, streamed to browser"),
    Editor      UMETA(DisplayName = "Editor — running in the UE5 editor"),
};

// ---------------------------------------------------------------------------
// Game Instance
// ---------------------------------------------------------------------------

/**
 * NuhoudGameInstance — the persistent game state.
 *
 * Lifecycle:
 *   1. OnInit() — detect runtime mode, load saved auth token.
 *   2. The LoginScreen widget calls SetAuthToken() after successful login.
 *   3. The GameMode reads GetAuthToken() to attach to HTTP requests.
 *   4. OnShutdown() — saves state.
 */
UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API UNuhoudGameInstance : public UGameInstance
{
    GENERATED_BODY()

public:
    UNuhoudGameInstance();

    virtual void Init() override;
    virtual void Shutdown() override;

    // -----------------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------------

    /** Set the auth token after successful login. Also saves to disk. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Auth")
    void SetAuthToken(const FString& Token, const FString& PatientId, const FString& PatientName);

    /** Get the JWT token (for HTTP Authorization header). */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Auth")
    FString GetAuthToken() const { return AuthToken; }

    /** Is the user logged in? */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Auth")
    bool IsLoggedIn() const { return !AuthToken.IsEmpty(); }

    /** Get the patient ID. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Auth")
    FString GetPatientId() const { return PatientId; }

    /** Get the patient name. */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Auth")
    FString GetPatientName() const { return PatientName; }

    /** Log out — clears the token and saves. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Auth")
    void Logout();

    // -----------------------------------------------------------------------
    // Patient Config (loaded from the backend after login)
    // -----------------------------------------------------------------------

    /** Set the treatment plan config (called after login). */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Config")
    void SetPlanConfig(const FString& PlanId, float TargetAngle, const FString& Limb);

    UFUNCTION(BlueprintPure, Category = "Nuhoud|Config")
    FString GetPlanId() const { return PlanId; }

    UFUNCTION(BlueprintPure, Category = "Nuhoud|Config")
    float GetTargetAngle() const { return TargetAngle; }

    UFUNCTION(BlueprintPure, Category = "Nuhoud|Config")
    FString GetLimb() const { return Limb; }

    // -----------------------------------------------------------------------
    // Runtime Mode
    // -----------------------------------------------------------------------

    /** Get the detected runtime mode (APK, Pixel Streaming, or Editor). */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Runtime")
    ENuhoudRuntimeMode GetRuntimeMode() const { return RuntimeMode; }

    /** Is this running as an APK? */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Runtime")
    bool IsAPK() const { return RuntimeMode == ENuhoudRuntimeMode::APK; }

    /** Is this running via Pixel Streaming? */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Runtime")
    bool IsPixelStreaming() const { return RuntimeMode == ENuhoudRuntimeMode::PixelStream; }

    /**
     * Get the backend API URL.
     * In Pixel Streaming mode, this is read from the URL parameters
     * passed by the browser. In APK mode, it's the configured default.
     */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Runtime")
    FString GetBackendURL() const;

    /**
     * Get the WebSocket URL for the pose server.
     * In Pixel Streaming mode, read from URL params. In APK mode, the default.
     */
    UFUNCTION(BlueprintPure, Category = "Nuhoud|Runtime")
    FString GetWebSocketURL() const;

    // -----------------------------------------------------------------------
    // Delegates
    // -----------------------------------------------------------------------

    /** Fired when the login state changes (for UI updates). */
    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Auth|Events")
    FSimpleMulticastDelegate OnLoginStateChanged;

protected:
    // -----------------------------------------------------------------------
    // Internal State
    // -----------------------------------------------------------------------

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Auth")
    FString AuthToken;

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Auth")
    FString PatientId;

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Auth")
    FString PatientName;

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Config")
    FString PlanId;

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Config")
    float TargetAngle = 90.0f;

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Config")
    FString Limb = TEXT("right");

    UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Runtime")
    ENuhoudRuntimeMode RuntimeMode = ENuhoudRuntimeMode::Editor;

    // -----------------------------------------------------------------------
    // Pixel Streaming URL parameter overrides
    // -----------------------------------------------------------------------

    /** Backend URL override (from Pixel Streaming URL params). */
    FString PixelStreamBackendURL;

    /** WebSocket URL override (from Pixel Streaming URL params). */
    FString PixelStreamWebSocketURL;

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** Save the auth state to disk. */
    void SaveState();

    /** Load the auth state from disk. */
    void LoadState();

    /** Detect the runtime mode (APK, Pixel Streaming, or Editor). */
    void DetectRuntimeMode();

    /** Read Pixel Streaming URL parameters (backend URL, WS URL, patient ID). */
    void ReadPixelStreamingParams();
};
