#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "NuhoudGameMode.generated.h"

class ANuhoudMajlis;
class ANuhoudFirstPersonPawn;
class ANuhoudTaskDirector;
class UNuhoudLoginWidget;
class ANuhoudInputAdapter;
class ANuhoudRenderManager;

UCLASS()
class NUHOUD_API ANuhoudGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ANuhoudGameMode();

	virtual void BeginPlay() override;

	void StartGameAfterLogin();

	ANuhoudMajlis* GetMajlis() const { return Majlis; }
	ANuhoudTaskDirector* GetDirector() const { return Director; }

protected:
	void ShowLoginScreen();

	UFUNCTION()
	void OnLoginSuccess(const FString& PatientId, const FString& AuthToken);

private:
	ANuhoudFirstPersonPawn* GetPatientPawn() const;

	UPROPERTY()
	ANuhoudMajlis* Majlis;

	UPROPERTY()
	ANuhoudTaskDirector* Director;

	UPROPERTY()
	UNuhoudLoginWidget* LoginWidget;

	UPROPERTY()
	ANuhoudInputAdapter* InputAdapterActor;

	UPROPERTY()
	ANuhoudRenderManager* RenderManagerActor;

	bool bGameStarted;
};
