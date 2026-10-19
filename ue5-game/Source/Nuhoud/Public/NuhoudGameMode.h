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

	/** Asks about pain and tiredness, then starts the session or sends the patient to rest. */
	void AskBeforeSession();

	/** Applies the loaded plan's hand to the input and starts handing out tasks. */
	void BeginTasks();

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

	/** The answers before the session, kept until the session record is reset. */
	int32 PainBefore = -1;
	int32 FatigueBefore = -1;
};
