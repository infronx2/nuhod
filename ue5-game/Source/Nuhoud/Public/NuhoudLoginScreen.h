// ============================================================================
// NuhoudLoginScreen.h
// ============================================================================
// UMG Login Screen — appears at game start. Sends POST /api/v2/auth/login
// to the Next.js backend, captures the JWT token, and stores it in the
// GameInstance.
//
// Blueprint setup:
//   Create WBP_NuhoudLogin (Widget Blueprint, parent = NuhoudLoginScreen).
//   Add: EmailTextBox, PasswordTextBox, LoginButton, ErrorText, LoadingSpinner.
//   Bind the widgets using meta=(BindWidget).
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "NuhoudLoginScreen.generated.h"

class UEditableTextBox;
class UButton;
class UTextBlock;
class UImage;
class UThrobber;

// ---------------------------------------------------------------------------
// Delegates
// ---------------------------------------------------------------------------

/** Fired when login succeeds (the main menu / game can start). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnLoginSuccess, const FString&, PatientName);

/** Fired when login fails (show error message). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnLoginFailed, const FString&, ErrorMessage);

// ---------------------------------------------------------------------------
// Login Screen Widget
// ---------------------------------------------------------------------------

UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API UNuhoudLoginScreen : public UUserWidget
{
    GENERATED_BODY()

public:
    UNuhoudLoginScreen(const FObjectInitializer& ObjectInitializer);

    virtual void NativeConstruct() override;

    // -----------------------------------------------------------------------
    // Login Logic
    // -----------------------------------------------------------------------

    /** Attempt to log in with the current email + password. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Login")
    void AttemptLogin();

    // -----------------------------------------------------------------------
    // Delegates
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Login|Events")
    FOnLoginSuccess OnLoginSuccess;

    UPROPERTY(BlueprintAssignable, Category = "Nuhoud|Login|Events")
    FOnLoginFailed OnLoginFailed;

    // -----------------------------------------------------------------------
    // Bound Widgets (must match names in the UMG Blueprint)
    // -----------------------------------------------------------------------

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Login|Widgets")
    UEditableTextBox* EmailTextBox;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Login|Widgets")
    UEditableTextBox* PasswordTextBox;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Login|Widgets")
    UButton* LoginButton;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Login|Widgets")
    UTextBlock* ErrorText;

    UPROPERTY(BlueprintReadWrite, meta = (BindWidget), Category = "Nuhoud|Login|Widgets")
    UThrobber* LoadingSpinner;

protected:
    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** The button click handler. */
    UFUNCTION()
    void OnLoginClicked();

    /** Handle the HTTP response from /api/v2/auth/login. */
    void OnLoginResponse(class FHttpRequestPtr Request, class FHttpResponsePtr Response, bool bSuccess);

    /** Get the backend URL from the GameInstance. */
    FString GetBackendURL() const;

    /** Show/hide the loading state. */
    void SetLoading(bool bIsLoading);

    bool bIsLoggingIn = false;
};
