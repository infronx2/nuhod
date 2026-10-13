// ============================================================================
// NuhoudLoginScreen.cpp
// ============================================================================

#include "NuhoudLoginScreen.h"
#include "NuhoudGameInstance.h"

#include "Components/EditableTextBox.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "Components/Throbber.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"

UNuhoudLoginScreen::UNuhoudLoginScreen(const FObjectInitializer& ObjectInitializer)
    : Super(ObjectInitializer)
{
}

void UNuhoudLoginScreen::NativeConstruct()
{
    Super::NativeConstruct();

    // Bind the login button click
    if (LoginButton)
    {
        LoginButton->OnClicked.AddDynamic(this, &UNuhoudLoginScreen::OnLoginClicked);
    }

    // Hide the error text + spinner initially
    if (ErrorText)
    {
        ErrorText->SetVisibility(ESlateVisibility::Hidden);
    }
    if (LoadingSpinner)
    {
        LoadingSpinner->SetVisibility(ESlateVisibility::Hidden);
    }

    // Pre-fill the email if we have a saved patient ID
    if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
    {
        if (GI->IsLoggedIn())
        {
            // Already logged in — auto-skip
            OnLoginSuccess.Broadcast(GI->GetPatientName());
        }
    }
}

// ---------------------------------------------------------------------------
// Login Logic
// ---------------------------------------------------------------------------

void UNuhoudLoginScreen::OnLoginClicked()
{
    AttemptLogin();
}

void UNuhoudLoginScreen::AttemptLogin()
{
    if (bIsLoggingIn) return;

    // Get email + password from the text boxes
    FString Email = EmailTextBox ? EmailTextBox->GetText().ToString() : TEXT("");
    FString Password = PasswordTextBox ? PasswordTextBox->GetText().ToString() : TEXT("");

    if (Email.IsEmpty() || Password.IsEmpty())
    {
        if (ErrorText)
        {
            ErrorText->SetText(NSLOCTEXT("Nuhoud", "EmptyFields", "Please enter both email and password."));
            ErrorText->SetVisibility(ESlateVisibility::Visible);
        }
        return;
    }

    // Build the JSON payload: {"email": "...", "password": "..."}
    TSharedRef<FJsonObject> JsonObject = MakeShareable(new FJsonObject());
    JsonObject->SetStringField(TEXT("email"), Email);
    JsonObject->SetStringField(TEXT("password"), Password);

    FString JsonPayload;
    TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonPayload);
    FJsonSerializer::Serialize(JsonObject, Writer);

    // Build the request URL
    FString URL = GetBackendURL() + TEXT("/auth/login");

    // Create + send the HTTP request
    TSharedRef<IHttpRequest> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(URL);
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetContentAsString(JsonPayload);
    Request->OnProcessRequestComplete().BindUObject(this, &UNuhoudLoginScreen::OnLoginResponse);

    SetLoading(true);
    Request->ProcessRequest();
}

void UNuhoudLoginScreen::OnLoginResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSuccess)
{
    SetLoading(false);

    if (!bSuccess || !Response.IsValid())
    {
        FString ErrMsg = TEXT("Network error — check your connection.");
        if (ErrorText)
        {
            ErrorText->SetText(FText::FromString(ErrMsg));
            ErrorText->SetVisibility(ESlateVisibility::Visible);
        }
        OnLoginFailed.Broadcast(ErrMsg);
        return;
    }

    int32 Code = Response->GetResponseCode();
    FString Body = Response->GetContentAsString();

    if (Code != 200)
    {
        // Parse error
        FString ErrMsg = FString::Printf(TEXT("Login failed (HTTP %d)"), Code);
        if (ErrorText)
        {
            ErrorText->SetText(FText::FromString(ErrMsg));
            ErrorText->SetVisibility(ESlateVisibility::Visible);
        }
        OnLoginFailed.Broadcast(ErrMsg);
        return;
    }

    // Parse the success response:
    // {"ok": true, "token": "...", "user": {"id": "...", "name": "...", "role": "PATIENT"}}
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Body);
    TSharedPtr<FJsonObject> Json;
    if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
    {
        OnLoginFailed.Broadcast(TEXT("Invalid server response."));
        return;
    }

    bool bOk = false;
    Json->TryGetBoolField(TEXT("ok"), bOk);
    if (!bOk)
    {
        OnLoginFailed.Broadcast(TEXT("Login rejected by server."));
        return;
    }

    FString Token, PatientId, PatientName;
    Json->TryGetStringField(TEXT("token"), Token);
    const TSharedPtr<FJsonObject>* UserObj;
    if (Json->TryGetObjectField(TEXT("user"), UserObj) && UserObj->IsValid())
    {
        (*UserObj)->TryGetStringField(TEXT("id"), PatientId);
        (*UserObj)->TryGetStringField(TEXT("name"), PatientName);
    }

    if (Token.IsEmpty())
    {
        OnLoginFailed.Broadcast(TEXT("No token received."));
        return;
    }

    // Store the token in the GameInstance
    if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
    {
        GI->SetAuthToken(Token, PatientId, PatientName);
    }

    // Broadcast success — the main menu / game will start
    OnLoginSuccess.Broadcast(PatientName);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

FString UNuhoudLoginScreen::GetBackendURL() const
{
    if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
    {
        return GI->GetBackendURL();
    }
    return TEXT("http://localhost:3000/api/v2");
}

void UNuhoudLoginScreen::SetLoading(bool bIsLoading)
{
    bIsLoggingIn = bIsLoading;

    if (LoginButton)
    {
        LoginButton->SetIsEnabled(!bIsLoading);
    }
    if (LoadingSpinner)
    {
        LoadingSpinner->SetVisibility(bIsLoading ? ESlateVisibility::Visible : ESlateVisibility::Hidden);
    }
    if (ErrorText && !bIsLoading)
    {
        // Keep the error visible — it's cleared on the next attempt
    }
}
