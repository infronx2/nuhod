#include "NuhoudGameMode.h"
#include "NuhoudGameInstance.h"
#include "NuhoudPlayerController.h"
#include "NuhoudInputAdapter.h"
#include "NuhoudRenderManager.h"
#include "NuhoudLoginWidget.h"
#include "NuhoudMajlis.h"
#include "NuhoudFirstPersonPawn.h"
#include "NuhoudTaskDirector.h"
#include "NuhoudHeadset.h"
#include "Engine/World.h"
#include "Misc/CommandLine.h"
#include "TimerManager.h"
#include "Blueprint/UserWidget.h"

ANuhoudGameMode::ANuhoudGameMode()
{
	DefaultPawnClass = ANuhoudFirstPersonPawn::StaticClass();
	PlayerControllerClass = ANuhoudPlayerController::StaticClass();

	Majlis = nullptr;
	Director = nullptr;
	LoginWidget = nullptr;
	InputAdapterActor = nullptr;
	RenderManagerActor = nullptr;
	bGameStarted = false;
}

void ANuhoudGameMode::BeginPlay()
{
	Super::BeginPlay();

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Majlis = GetWorld()->SpawnActor<ANuhoudMajlis>(ANuhoudMajlis::StaticClass(), FTransform::Identity, Params);

	ANuhoudFirstPersonPawn* PatientPawn = GetPatientPawn();
	if (PatientPawn)
	{
		PatientPawn->SeatAt(Majlis->GetPatientEyes(), Majlis->GetPatientYaw());
	}
	else
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: no first-person pawn to seat"));
	}

	// The room, props and lit lanterns are ready behind the login screen.
	Director = GetWorld()->SpawnActor<ANuhoudTaskDirector>(ANuhoudTaskDirector::StaticClass(), FTransform::Identity, Params);
	Director->Setup(Majlis, PatientPawn);

	// A connected VR headset is used; otherwise the phone camera through the pose server.
	// -NuhoudCameraOnly keeps a plugged-in headset out of the session.
	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const bool bCameraOnly = FParse::Param(FCommandLine::Get(), TEXT("NuhoudCameraOnly"));
	const bool bHeadset = !bCameraOnly && FNuhoudHeadset::IsConnected();
	if (GI) GI->TrackingMode = bHeadset ? ENuhoudTrackingMode::Headset : ENuhoudTrackingMode::Camera;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: tracking mode %s (headset: %s%s)"),
		bHeadset ? TEXT("HEADSET") : TEXT("CAMERA"), *FNuhoudHeadset::DeviceName(),
		bCameraOnly ? TEXT(", ignored by -NuhoudCameraOnly") : (bHeadset ? TEXT("") : TEXT(", not connected")));

	if (GI && GI->IsSignedIn())
	{
		StartGameAfterLogin();
	}
	else
	{
		ShowLoginScreen();
	}
}

ANuhoudFirstPersonPawn* ANuhoudGameMode::GetPatientPawn() const
{
	APlayerController* PC = GetWorld()->GetFirstPlayerController();
	return PC ? Cast<ANuhoudFirstPersonPawn>(PC->GetPawn()) : nullptr;
}

void ANuhoudGameMode::ShowLoginScreen()
{
	APlayerController* PC = GetWorld()->GetFirstPlayerController();
	if (!PC) return;

	LoginWidget = CreateWidget<UNuhoudLoginWidget>(PC, UNuhoudLoginWidget::StaticClass());
	if (LoginWidget)
	{
		LoginWidget->AddToViewport(100);
		LoginWidget->OnLoginSuccess.AddDynamic(this, &ANuhoudGameMode::OnLoginSuccess);
		PC->SetShowMouseCursor(true);
		PC->SetInputMode(FInputModeUIOnly());
	}
	else
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: failed to create login widget"));
	}
}

void ANuhoudGameMode::OnLoginSuccess(const FString& PatientId, const FString& AuthToken)
{
	FTimerHandle Handle;
	GetWorldTimerManager().SetTimer(Handle, this, &ANuhoudGameMode::StartGameAfterLogin, 1.0f, false);
}

void ANuhoudGameMode::StartGameAfterLogin()
{
	if (bGameStarted) return;
	bGameStarted = true;

	if (LoginWidget)
	{
		LoginWidget->RemoveFromParent();
		LoginWidget = nullptr;
	}

	APlayerController* PC = GetWorld()->GetFirstPlayerController();
	if (PC)
	{
		PC->SetInputMode(FInputModeGameAndUI());
		PC->SetShowMouseCursor(true);
	}

	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	if (GI)
	{
		GI->ResetSession();
		// Sessions saved on this computer while offline go to the doctor now that the patient is signed in.
		GI->UploadPendingSessions();
		if (GI->TrackingMode == ENuhoudTrackingMode::Headset)
		{
			FNuhoudHeadset::StartSeatedView(GetPatientPawn());
		}
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	RenderManagerActor = GetWorld()->SpawnActor<ANuhoudRenderManager>(
		ANuhoudRenderManager::StaticClass(), FTransform::Identity, Params);

	InputAdapterActor = GetWorld()->SpawnActor<ANuhoudInputAdapter>(
		ANuhoudInputAdapter::StaticClass(), FTransform::Identity, Params);
	InputAdapterActor->SetViewPawn(GetPatientPawn());

	if (ANuhoudPlayerController* NPC = Cast<ANuhoudPlayerController>(PC))
	{
		NPC->InputAdapter = InputAdapterActor;
		NPC->InitializeAfterLogin();
	}

	// The doctor's plan decides the target angle, the session length and the hand that plays,
	// so the tasks start once it has loaded (or failed to, which keeps the defaults).
	if (GI)
	{
		TWeakObjectPtr<ANuhoudGameMode> WeakThis(this);
		GI->FetchActivePlan([WeakThis]()
		{
			if (WeakThis.IsValid()) WeakThis->BeginTasks();
		});
	}
	else
	{
		BeginTasks();
	}
	UE_LOG(LogTemp, Warning, TEXT("=== NUHOUD MAJLIS READY === Patient: %s"), GI ? *GI->CloudPatientId : TEXT("unknown"));
}

void ANuhoudGameMode::BeginTasks()
{
	if (const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		if (InputAdapterActor)
		{
			InputAdapterActor->SetActiveHands(GI->PlanTrainsHand(true), GI->PlanTrainsHand(false));
		}
	}
	Director->StartSession(InputAdapterActor);
}
