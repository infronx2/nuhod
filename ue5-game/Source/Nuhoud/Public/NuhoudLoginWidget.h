#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Components/EditableTextBox.h"
#include "Components/Button.h"
#include "Components/TextBlock.h"
#include "Components/Image.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "NuhoudLoginWidget.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnLoginSuccess, const FString&, PatientId, const FString&, AuthToken);

UCLASS()
class NUHOUD_API UNuhoudLoginWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintAssignable)
	FOnLoginSuccess OnLoginSuccess;

	virtual void NativeOnInitialized() override;
	virtual void NativeConstruct() override;

protected:
	UPROPERTY(meta = (BindWidgetOptional))
	UEditableTextBox* EmailInput;

	UPROPERTY(meta = (BindWidgetOptional))
	UEditableTextBox* PasswordInput;

	UPROPERTY(meta = (BindWidgetOptional))
	UButton* LoginButton;

	UPROPERTY(meta = (BindWidgetOptional))
	UTextBlock* StatusLabel;

	UPROPERTY(meta = (BindWidgetOptional))
	UTextBlock* TitleLabel;

private:
	UFUNCTION()
	void OnLoginClicked();

	void OnLoginResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSuccess);

	bool bRequestInFlight;
};
