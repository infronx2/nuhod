#include "NuhoudPlayerController.h"
#include "NuhoudGameInstance.h"
#include "NuhoudGameMode.h"
#include "NuhoudMajlis.h"
#include "NuhoudInputAdapter.h"
#include "NuhoudFirstPersonPawn.h"
#include "NuhoudHeadset.h"
#include "NuhoudProceduralAssets.h"
#include "NuhoudTaskDirector.h"
#include "WebSocketsModule.h"
#include "IWebSocket.h"
#include "Engine/World.h"
#include "Engine/StaticMeshActor.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Dom/JsonObject.h"
#include "Misc/CommandLine.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	const TCHAR* const FingerKeys[5] = { TEXT("thumb"), TEXT("index"), TEXT("middle"), TEXT("ring"), TEXT("pinky") };

	constexpr int32 MaxPoseReconnects = 3;
	const float ReconnectDelays[MaxPoseReconnects] = { 1.f, 2.f, 4.f };
	constexpr double ConnectTimeoutSeconds = 6.0;
	// The pose server sends ~25-30 messages a second, even when it sees nobody.
	constexpr double StreamStallSeconds = 3.0;
	constexpr double HeadsetHandFreshSeconds = 0.5;
	constexpr float PainStopTouchCm = 7.f;

	FVector ReadVector(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Field)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (!Obj->TryGetArrayField(Field, Arr) || Arr->Num() < 3) return FVector::ZeroVector;
		return FVector((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber());
	}

	float ReadNumber(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Field)
	{
		double Value = 0.0;
		Obj->TryGetNumberField(Field, Value);
		return static_cast<float>(Value);
	}

	bool ReadBool(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Field, bool bDefault = false)
	{
		bool bValue = bDefault;
		Obj->TryGetBoolField(Field, bValue);
		return bValue;
	}

	FString GestureLabel(const FString& Gesture)
	{
		if (Gesture == TEXT("open")) return TEXT("OPEN HAND");
		if (Gesture == TEXT("fist")) return TEXT("FIST");
		if (Gesture == TEXT("point")) return TEXT("POINTING");
		if (Gesture == TEXT("peace")) return TEXT("PEACE");
		if (Gesture == TEXT("pinch")) return TEXT("PINCH");
		return TEXT("");
	}
}

ANuhoudPlayerController::ANuhoudPlayerController()
{
	PrimaryActorTick.bCanEverTick = true;
	bShowMouseCursor = true;
	bEnableClickEvents = true;

	InputAdapter = nullptr;
	bWebSocketConnected = false;
	bBodyDetected = false;
	TrackingFps = 0.f;
	PainStopActor = nullptr;
	ScoreText = nullptr;
	StatusText = nullptr;
	GestureText = nullptr;
	InstructionText = nullptr;
	PoseLink = EPoseLink::Idle;
	PoseRetries = 0;
	PoseRetryTimer = 0.f;
	PoseLinkSince = 0.0;
	LastPoseMessageTime = 0.0;
	SocketGeneration = 0;
	bCameraStreaming = true;
	LastHeadsetHandTime[0] = LastHeadsetHandTime[1] = -100.0;
	ConnectionAnimTimer = 0.f;
	bSessionEnded = false;
	bGameInitialized = false;
	AutoEndAt = 0.0;
	bAutoEndPain = false;
}

void ANuhoudPlayerController::InitializeAfterLogin()
{
	if (bGameInitialized) return;
	bGameInitialized = true;
	bSessionEnded = false;

	if (!FModuleManager::Get().IsModuleLoaded(TEXT("WebSockets")))
	{
		FModuleManager::Get().LoadModule(TEXT("WebSockets"));
	}

	SpawnPainStopButton();
	SpawnStatusHUD();
	ConnectWebSocket();

#if !UE_BUILD_SHIPPING
	// QA: -NuhoudAutoEnd=<seconds> finishes the session by itself, -NuhoudAutoEndPain as a pain stop.
	float AutoEnd = 0.f;
	if (FParse::Value(FCommandLine::Get(), TEXT("NuhoudAutoEnd="), AutoEnd) && AutoEnd > 0.f)
	{
		AutoEndAt = GetWorld()->GetTimeSeconds() + AutoEnd;
		bAutoEndPain = FParse::Param(FCommandLine::Get(), TEXT("NuhoudAutoEndPain"));
	}
#endif
}

void ANuhoudPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	// Closing the game or stopping Play still saves the session for the doctor.
	if (bGameInitialized && !bSessionEnded)
	{
		EndSession();
	}
	CloseWebSocket();
	RetiredSocket.Reset();
	Super::EndPlay(EndPlayReason);
}

void ANuhoudPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	if (InputComponent)
	{
		InputComponent->BindKey(EKeys::LeftMouseButton, IE_Pressed, this, &ANuhoudPlayerController::OnPainStopClicked);
		InputComponent->BindKey(EKeys::Escape, IE_Pressed, this, &ANuhoudPlayerController::OnFinishPressed);
		InputComponent->BindKey(EKeys::R, IE_Pressed, this, &ANuhoudPlayerController::OnRetryPressed);
	}
}

void ANuhoudPlayerController::OnFinishPressed()
{
	FinishSession();
}

void ANuhoudPlayerController::FinishSession()
{
	if (bGameInitialized && !bSessionEnded)
	{
		EndSession();
	}
}

void ANuhoudPlayerController::ConnectWebSocket()
{
	CloseWebSocket();

	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const FString WsURL = GI ? GI->CloudWebSocketURL : TEXT("ws://127.0.0.1:8001/ws/track");
	WebSocket = FWebSocketsModule::Get().CreateWebSocket(WsURL, TEXT("ws"));

	// Callbacks of a socket that has since been replaced are ignored.
	const int32 Generation = ++SocketGeneration;
	TWeakObjectPtr<ANuhoudPlayerController> WeakThis(this);
	auto IsCurrent = [WeakThis, Generation]() { return WeakThis.IsValid() && WeakThis->SocketGeneration == Generation; };

	WebSocket->OnConnected().AddLambda([WeakThis, IsCurrent]()
	{
		if (IsCurrent()) WeakThis->OnPoseLinkUp();
	});
	WebSocket->OnConnectionError().AddLambda([WeakThis, IsCurrent](const FString& Error)
	{
		if (IsCurrent()) WeakThis->OnPoseLinkLost(Error);
	});
	WebSocket->OnClosed().AddLambda([WeakThis, IsCurrent](int32 StatusCode, const FString& Reason, bool)
	{
		if (IsCurrent()) WeakThis->OnPoseLinkLost(FString::Printf(TEXT("closed %d %s"), StatusCode, *Reason));
	});
	WebSocket->OnMessage().AddLambda([WeakThis, IsCurrent](const FString& Message)
	{
		if (IsCurrent()) WeakThis->OnWebSocketMessage(Message);
	});

	SetPoseLink(EPoseLink::Connecting);
	WebSocket->Connect();
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: connecting to %s%s"), *WsURL,
		PoseRetries > 0 ? *FString::Printf(TEXT(" (reconnect %d of %d)"), PoseRetries, MaxPoseReconnects) : TEXT(""));
}

void ANuhoudPlayerController::CloseWebSocket()
{
	// Silence the old socket first, including the close event this causes.
	++SocketGeneration;
	if (WebSocket.IsValid())
	{
		WebSocket->OnConnected().Clear();
		WebSocket->OnConnectionError().Clear();
		WebSocket->OnClosed().Clear();
		WebSocket->OnMessage().Clear();
		if (WebSocket->IsConnected()) WebSocket->Close();
		RetiredSocket = MoveTemp(WebSocket);
	}
	bWebSocketConnected = false;
}

void ANuhoudPlayerController::SetPoseLink(EPoseLink NewState)
{
	PoseLink = NewState;
	PoseLinkSince = FPlatformTime::Seconds();
	bWebSocketConnected = NewState == EPoseLink::Connected;
}

void ANuhoudPlayerController::OnPoseLinkUp()
{
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: pose server connected%s"),
		PoseRetries > 0 ? *FString::Printf(TEXT(" after %d reconnect attempt(s)"), PoseRetries) : TEXT(""));
	PoseRetries = 0;
	LastPoseMessageTime = FPlatformTime::Seconds();
	SetPoseLink(EPoseLink::Connected);
}

void ANuhoudPlayerController::OnPoseLinkLost(const FString& Reason)
{
	const bool bWasConnected = PoseLink == EPoseLink::Connected;
	CloseWebSocket();
	if (bSessionEnded)
	{
		SetPoseLink(EPoseLink::Idle);
		return;
	}

	if (PoseRetries < MaxPoseReconnects)
	{
		PoseRetryTimer = ReconnectDelays[PoseRetries];
		PoseRetries++;
		SetPoseLink(EPoseLink::WaitingToRetry);
		UE_LOG(LogTemp, Warning, TEXT("Nuhoud: pose server %s (%s) - reconnect %d of %d in %.0fs"),
			bWasConnected ? TEXT("lost") : TEXT("unreachable"), *Reason, PoseRetries, MaxPoseReconnects, PoseRetryTimer);
	}
	else
	{
		SetPoseLink(EPoseLink::GaveUp);
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: pose server still unreachable after %d reconnects (%s). Press R to try again."),
			MaxPoseReconnects, *Reason);
	}
}

void ANuhoudPlayerController::UpdatePoseLink(float DeltaTime)
{
	const double Now = FPlatformTime::Seconds();
	switch (PoseLink)
	{
	case EPoseLink::WaitingToRetry:
		PoseRetryTimer -= DeltaTime;
		if (PoseRetryTimer <= 0.f) ConnectWebSocket();
		break;
	case EPoseLink::Connecting:
		if (Now - PoseLinkSince > ConnectTimeoutSeconds) OnPoseLinkLost(TEXT("connection timed out"));
		break;
	case EPoseLink::Connected:
		// A server that stops sending (hung, or a stalled network) is treated like a dropped link.
		if (Now - LastPoseMessageTime > StreamStallSeconds) OnPoseLinkLost(TEXT("no tracking data for 3s"));
		break;
	default:
		break;
	}
}

void ANuhoudPlayerController::OnRetryPressed()
{
	if (!bGameInitialized || bSessionEnded) return;
	if (PoseLink == EPoseLink::GaveUp || PoseLink == EPoseLink::WaitingToRetry)
	{
		UE_LOG(LogTemp, Log, TEXT("Nuhoud: retrying the pose server on request"));
		PoseRetries = 0;
		ConnectWebSocket();
	}
}

void ANuhoudPlayerController::OnWebSocketMessage(const FString& Message)
{
	LastPoseMessageTime = FPlatformTime::Seconds();

	TSharedPtr<FJsonObject> J;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
	if (!FJsonSerializer::Deserialize(Reader, J) || !J.IsValid()) return;

	// Older pose servers do not send "camera"; they only send while frames arrive.
	bCameraStreaming = ReadBool(J, TEXT("camera"), true);
	bBodyDetected = ReadBool(J, TEXT("body"));
	TrackingFps = ReadNumber(J, TEXT("fps"));

	const TSharedPtr<FJsonObject>* Arms = nullptr;
	const TSharedPtr<FJsonObject>* Hands = nullptr;
	J->TryGetObjectField(TEXT("arms"), Arms);
	J->TryGetObjectField(TEXT("hands"), Hands);
	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());

	for (ENuhoudHandSide Side : { ENuhoudHandSide::Right, ENuhoudHandSide::Left })
	{
		// A hand the headset is tracking right now is not overwritten by the camera's estimate.
		if (IsHeadsetHandFresh(static_cast<int32>(Side))) continue;

		const TCHAR* Key = Side == ENuhoudHandSide::Right ? TEXT("right") : TEXT("left");

		FNuhoudArmSample Arm;
		const TSharedPtr<FJsonObject>* ArmObj = nullptr;
		if (Arms && (*Arms)->TryGetObjectField(Key, ArmObj))
		{
			Arm.bTracked = ReadBool(*ArmObj, TEXT("tracked"));
			Arm.Shoulder = ReadVector(*ArmObj, TEXT("shoulder"));
			Arm.Elbow = ReadVector(*ArmObj, TEXT("elbow"));
			Arm.Wrist = ReadVector(*ArmObj, TEXT("wrist"));
			Arm.UpperArmCm = ReadNumber(*ArmObj, TEXT("upper_arm_cm"));
			Arm.ForearmCm = ReadNumber(*ArmObj, TEXT("forearm_cm"));
			Arm.ShoulderElevation = ReadNumber(*ArmObj, TEXT("shoulder_elevation"));
			Arm.ShoulderFlexion = ReadNumber(*ArmObj, TEXT("shoulder_flexion"));
			Arm.ShoulderAbduction = ReadNumber(*ArmObj, TEXT("shoulder_abduction"));
			Arm.ElbowAngle = ReadNumber(*ArmObj, TEXT("elbow_angle"));
		}
		if (InputAdapter) InputAdapter->SetArmSample(Side, Arm);
		// Only the arm the plan trains is measured for the doctor.
		if (GI && Arm.bTracked && GI->PlanTrainsHand(Side == ENuhoudHandSide::Right))
		{
			GI->UpdateMaxAngle(Arm.ShoulderElevation);
			GI->UpdateElbowAngle(Arm.ElbowAngle);
		}

		FNuhoudHandSample Hand;
		const TSharedPtr<FJsonObject>* HandObj = nullptr;
		if (Hands && (*Hands)->TryGetObjectField(Key, HandObj) && ReadBool(*HandObj, TEXT("tracked")))
		{
			Hand.bTracked = true;
			Hand.Dir = ReadVector(*HandObj, TEXT("dir"));
			Hand.PalmNormal = ReadVector(*HandObj, TEXT("normal"));
			(*HandObj)->TryGetStringField(TEXT("gesture"), Hand.Gesture);
			Hand.FingersExtended = FMath::RoundToInt(ReadNumber(*HandObj, TEXT("fingers_extended")));
			Hand.bPinching = ReadBool(*HandObj, TEXT("is_pinching"));
			Hand.PinchCm = ReadNumber(*HandObj, TEXT("pinch_cm"));

			const TSharedPtr<FJsonObject>* Curls = nullptr;
			if ((*HandObj)->TryGetObjectField(TEXT("curls"), Curls))
			{
				Hand.Curls.SetNum(5);
				for (int32 f = 0; f < 5; f++)
				{
					const TSharedPtr<FJsonObject>* Finger = nullptr;
					if ((*Curls)->TryGetObjectField(FingerKeys[f], Finger))
					{
						Hand.Curls[f] = FVector(ReadNumber(*Finger, TEXT("mcp")), ReadNumber(*Finger, TEXT("pip")), ReadNumber(*Finger, TEXT("dip")));
					}
				}
			}
		}
		if (InputAdapter) InputAdapter->SetHandSample(Side, Hand);
	}
}

bool ANuhoudPlayerController::IsHeadsetHandFresh(int32 SideIndex) const
{
	return FPlatformTime::Seconds() - LastHeadsetHandTime[SideIndex] < HeadsetHandFreshSeconds;
}

void ANuhoudPlayerController::UpdateHeadsetHands()
{
	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const ANuhoudFirstPersonPawn* PatientPawn = Cast<ANuhoudFirstPersonPawn>(GetPawn());
	if (!GI || GI->TrackingMode != ENuhoudTrackingMode::Headset || !InputAdapter || !PatientPawn) return;

	const FTransform Body = PatientPawn->GetBodyFrame();
	for (ENuhoudHandSide Side : { ENuhoudHandSide::Right, ENuhoudHandSide::Left })
	{
		FNuhoudArmSample Arm;
		FNuhoudHandSample Hand;
		if (!FNuhoudHeadset::ReadHand(this, Side, Body, Arm, Hand)) continue;

		LastHeadsetHandTime[static_cast<int32>(Side)] = FPlatformTime::Seconds();
		InputAdapter->SetArmSample(Side, Arm);
		InputAdapter->SetHandSample(Side, Hand);
		if (GI->PlanTrainsHand(Side == ENuhoudHandSide::Right))
		{
			GI->UpdateMaxAngle(Arm.ShoulderElevation);
			GI->UpdateElbowAngle(Arm.ElbowAngle);
		}
	}
}

void ANuhoudPlayerController::CheckPainStopTouch()
{
	// In a headset there is no mouse: touching the red button with a hand is the pain stop.
	// (On a flat screen depth is too uncertain for touch, so it stays a click there.)
	const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	if (!GI || GI->TrackingMode != ENuhoudTrackingMode::Headset || !PainStopActor || !InputAdapter) return;

	TArray<FVector> Palms;
	InputAdapter->GetInteractionPoints(Palms);
	for (const FVector& Palm : Palms)
	{
		if (FVector::Dist(Palm, PainStopActor->GetActorLocation()) < PainStopTouchCm)
		{
			TriggerPainStop(TEXT("touched"));
			return;
		}
	}
}

void ANuhoudPlayerController::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	RetiredSocket.Reset();
	if (!bGameInitialized) return;

	if (bSessionEnded)
	{
		// Keep telling the patient whether the session reached their doctor.
		const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
		if (InstructionText && GI)
		{
			InstructionText->SetText(FText::FromString(GI->LastSyncMessage.IsEmpty()
				? FString(TEXT("Session finished. Rest your arm.")) : GI->LastSyncMessage));
		}
		return;
	}

#if !UE_BUILD_SHIPPING
	if (AutoEndAt > 0.0 && GetWorld()->GetTimeSeconds() >= AutoEndAt)
	{
		AutoEndAt = 0.0;
		if (bAutoEndPain) TriggerPainStop(TEXT("QA auto-end"));
		else EndSession();
		return;
	}
#endif

	ConnectionAnimTimer += DeltaTime;
	UpdatePoseLink(DeltaTime);
	UpdateHeadsetHands();
	CheckPainStopTouch();
	if (!bSessionEnded) UpdateStatusHUD();
}

void ANuhoudPlayerController::UpdateStatusHUD()
{
	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const bool bRight = InputAdapter && InputAdapter->IsHandVisible(ENuhoudHandSide::Right);
	const bool bLeft = InputAdapter && InputAdapter->IsHandVisible(ENuhoudHandSide::Left);
	const bool bHeadsetHands = IsHeadsetHandFresh(0) || IsHeadsetHandFresh(1);
	const bool bCameraNeeded = !bHeadsetHands;

	if (ScoreText && GI)
	{
		const FString Tasks = GI->PlanDailyTasks > 0
			? FString::Printf(TEXT("%d/%d"), GI->SessionReps, GI->PlanDailyTasks)
			: FString::FromInt(GI->SessionReps);
		ScoreText->SetText(FText::FromString(FString::Printf(TEXT("SCORE %d   |   STREAK %d   |   TASKS %s   |   Esc: finish"),
			GI->SessionScore, GI->SessionStreak, *Tasks)));
	}

	FString CameraProblem;
	FString CameraFix;
	if (bCameraNeeded)
	{
		switch (PoseLink)
		{
		case EPoseLink::Connecting:
		case EPoseLink::Idle:
			CameraProblem = TEXT("Connecting to camera") + FString::ChrN((int32)ConnectionAnimTimer % 4, TEXT('.'));
			CameraFix = TEXT("Start the pose server: python pose_server.py");
			break;
		case EPoseLink::WaitingToRetry:
			CameraProblem = FString::Printf(TEXT("Camera connection lost - reconnecting (%d of %d)"), PoseRetries, MaxPoseReconnects);
			CameraFix = TEXT("Start the pose server: python pose_server.py");
			break;
		case EPoseLink::GaveUp:
			CameraProblem = TEXT("Camera not connected");
			CameraFix = TEXT("Start the pose server (python pose_server.py), then press R");
			break;
		case EPoseLink::Connected:
			if (!bCameraStreaming)
			{
				CameraProblem = TEXT("The camera is not sending video");
				CameraFix = TEXT("Check the phone camera app and its connection");
			}
			break;
		}
	}

	if (StatusText)
	{
		FString Status;
		if (!CameraProblem.IsEmpty())
		{
			Status = CameraProblem;
			StatusText->SetTextRenderColor(FColor(255, 150, 50));
		}
		else if (!bRight && !bLeft)
		{
			Status = bHeadsetHands || bBodyDetected ? TEXT("Raise your hands in front of you") : TEXT("Sit facing the camera");
			StatusText->SetTextRenderColor(FColor(255, 200, 50));
		}
		else
		{
			auto Side = [this](ENuhoudHandSide S, const TCHAR* Label) -> FString
			{
				if (!InputAdapter->IsHandVisible(S)) return FString::Printf(TEXT("%s  --"), Label);
				const FNuhoudArmSample& A = InputAdapter->GetArmSample(S);
				return FString::Printf(TEXT("%s  shoulder %.0f  %s"), Label, A.ShoulderElevation, *InputAdapter->DescribeGrip(S));
			};
			Status = Side(ENuhoudHandSide::Right, TEXT("R")) + TEXT("     ") + Side(ENuhoudHandSide::Left, TEXT("L"));
			StatusText->SetTextRenderColor(FColor(80, 255, 210));
		}
		StatusText->SetText(FText::FromString(Status));
	}

	if (GestureText)
	{
		FString Label;
		if (bRight) Label = GestureLabel(InputAdapter->GetHandSample(ENuhoudHandSide::Right).Gesture);
		if (Label.IsEmpty() && bLeft) Label = GestureLabel(InputAdapter->GetHandSample(ENuhoudHandSide::Left).Gesture);
		GestureText->SetText(FText::FromString(Label));
	}

	if (InstructionText)
	{
		const ANuhoudGameMode* GM = Cast<ANuhoudGameMode>(GetWorld()->GetAuthGameMode());
		const FString TaskLine = GM && GM->GetDirector() ? GM->GetDirector()->GetInstruction() : FString();

		FString Instruction;
		if (!CameraFix.IsEmpty()) Instruction = CameraFix;
		else if (!bRight && !bLeft && TaskLine.IsEmpty()) Instruction = TEXT("Your hands will appear as you lift them");
		else Instruction = TaskLine;
		InstructionText->SetText(FText::FromString(Instruction));
	}
}

void ANuhoudPlayerController::OnPainStopClicked()
{
	if (bSessionEnded || !bGameInitialized) return;

	FHitResult Hit;
	if (GetHitResultUnderCursor(ECC_Visibility, false, Hit) && Hit.GetActor() && Hit.GetActor()->ActorHasTag(TEXT("PainStopButton")))
	{
		TriggerPainStop(TEXT("clicked"));
	}
}

void ANuhoudPlayerController::TriggerPainStop(const TCHAR* How)
{
	if (bSessionEnded) return;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: PAIN STOP (%s)"), How);
	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->MarkPainStop();
	}
	EndSession();
}

void ANuhoudPlayerController::EndSession()
{
	bSessionEnded = true;
	const ANuhoudGameMode* GM = GetWorld() ? Cast<ANuhoudGameMode>(GetWorld()->GetAuthGameMode()) : nullptr;
	if (GM && GM->GetDirector())
	{
		GM->GetDirector()->EndSession();
	}
	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->SyncSessionToCloud();
	}
	CloseWebSocket();
	SetPoseLink(EPoseLink::Idle);
}

void ANuhoudPlayerController::SpawnPainStopButton()
{
	ANuhoudGameMode* GM = Cast<ANuhoudGameMode>(GetWorld()->GetAuthGameMode());
	UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (!GM || !GM->GetMajlis() || !Cylinder) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AStaticMeshActor* Button = GetWorld()->SpawnActor<AStaticMeshActor>(
		AStaticMeshActor::StaticClass(), GM->GetMajlis()->GetPainButtonLocation() + FVector(0.f, 0.f, 1.f), FRotator::ZeroRotator, Params);
	if (!Button) return;

	Button->Tags.Add(TEXT("PainStopButton"));
	UStaticMeshComponent* SMC = Button->GetStaticMeshComponent();
	SMC->SetMobility(EComponentMobility::Movable);
	SMC->SetStaticMesh(Cylinder);
	Button->SetActorScale3D(FVector(0.09f, 0.09f, 0.02f));
	SMC->SetMaterial(0, FNuhoudProceduralAssets::MakeLitMaterial(Button, FLinearColor(0.8f, 0.05f, 0.05f), 0.f, 0.4f,
		FLinearColor(2.f, 0.1f, 0.1f)));
	PainStopActor = Button;
}

void ANuhoudPlayerController::SpawnStatusHUD()
{
	const ANuhoudFirstPersonPawn* PatientPawn = Cast<ANuhoudFirstPersonPawn>(GetPawn());
	if (!PatientPawn) return;
	const FTransform Body = PatientPawn->GetBodyFrame();
	const FRotator Facing(0.f, Body.Rotator().Yaw + 180.f, 0.f);

	auto MakeText = [this, &Body, &Facing](const FVector& Local, float Size, const FColor& Color) -> UTextRenderComponent*
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		AActor* A = GetWorld()->SpawnActor<AActor>(AActor::StaticClass(), FTransform::Identity, Params);
		if (!A) return nullptr;

		UTextRenderComponent* TRC = NewObject<UTextRenderComponent>(A, TEXT("Text"));
		A->SetRootComponent(TRC);
		TRC->RegisterComponent();
		TRC->SetWorldSize(Size);
		TRC->SetTextRenderColor(Color);
		TRC->SetHorizontalAlignment(EHTA_Center);
		TRC->SetVerticalAlignment(EVRTA_TextCenter);
		A->SetActorLocationAndRotation(Body.TransformPosition(Local), Facing);
		return TRC;
	};

	// About 2.6 m ahead, at and just above eye level so reach targets below stay unobstructed.
	ScoreText = MakeText(FVector(260.f, 0.f, 18.f), 9.f, FColor(255, 215, 90));
	StatusText = MakeText(FVector(260.f, 0.f, 9.f), 7.f, FColor(80, 255, 210));
	GestureText = MakeText(FVector(260.f, 0.f, 1.f), 9.f, FColor(255, 230, 150));
	InstructionText = MakeText(FVector(260.f, 0.f, -7.f), 6.5f, FColor(220, 220, 255));
}
