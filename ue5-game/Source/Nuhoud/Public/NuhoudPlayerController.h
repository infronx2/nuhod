#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "IWebSocket.h"
#include "NuhoudPlayerController.generated.h"

class UTextRenderComponent;
class ANuhoudInputAdapter;

UCLASS()
class NUHOUD_API ANuhoudPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ANuhoudPlayerController();

	virtual void Tick(float DeltaTime) override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void SetupInputComponent() override;

	void InitializeAfterLogin();

	/** Ends and saves the session (the daily goal was reached); same as the patient pressing Esc. */
	void FinishSession();

	UPROPERTY()
	ANuhoudInputAdapter* InputAdapter;

	UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Tracking")
	bool bWebSocketConnected;

	UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Tracking")
	bool bBodyDetected;

	UPROPERTY(VisibleAnywhere, Category = "Nuhoud|Tracking")
	float TrackingFps;

protected:
	/** Link to the Python pose server. A lost link is retried 3 times, then waits for R. */
	enum class EPoseLink : uint8
	{
		Idle,
		Connecting,
		Connected,
		WaitingToRetry,
		GaveUp
	};

	void ConnectWebSocket();
	void CloseWebSocket();
	void OnPoseLinkUp();
	void OnPoseLinkLost(const FString& Reason);
	void UpdatePoseLink(float DeltaTime);
	void SetPoseLink(EPoseLink NewState);
	void OnWebSocketMessage(const FString& Message);
	void OnRetryPressed();

	/** Headset sessions: hands from the headset's hand tracking, the camera only fills in for a lost hand. */
	void UpdateHeadsetHands();
	bool IsHeadsetHandFresh(int32 SideIndex) const;
	void CheckPainStopTouch();

	void UpdateStatusHUD();
	void OnPainStopClicked();
	void OnFinishPressed();
	void TriggerPainStop(const TCHAR* How);
	void EndSession();

	void SpawnPainStopButton();
	void SpawnStatusHUD();

private:
	TSharedPtr<IWebSocket> WebSocket;

	/** A closed socket kept alive until the next tick: it may be closed from inside its own callback. */
	TSharedPtr<IWebSocket> RetiredSocket;

	UPROPERTY()
	AActor* PainStopActor;

	UPROPERTY()
	UTextRenderComponent* ScoreText;

	UPROPERTY()
	UTextRenderComponent* StatusText;

	UPROPERTY()
	UTextRenderComponent* GestureText;

	UPROPERTY()
	UTextRenderComponent* InstructionText;

	EPoseLink PoseLink;
	/** Reconnect attempts since the link was last up. */
	int32 PoseRetries;
	float PoseRetryTimer;
	double PoseLinkSince;
	double LastPoseMessageTime;
	/** Bumped for every new socket so callbacks from a replaced socket are ignored. */
	int32 SocketGeneration;
	/** False while the pose server reports that the camera delivers no frames. */
	bool bCameraStreaming;
	double LastHeadsetHandTime[2];

	float ConnectionAnimTimer;
	bool bSessionEnded;
	bool bGameInitialized;

	/** QA builds only: end the session by itself after this many seconds (-NuhoudAutoEnd=). */
	double AutoEndAt;
	bool bAutoEndPain;
};
