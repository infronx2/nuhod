#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "Engine/TimerHandle.h"
#include "NuhoudGameInstance.generated.h"

/** Where the patient's head and hands are tracked from. */
UENUM()
enum class ENuhoudTrackingMode : uint8
{
	/** Phone or webcam through the Python pose server. */
	Camera,
	/** A VR headset: head from the headset, hands from its hand tracking (camera as fallback). */
	Headset
};

UCLASS()
class NUHOUD_API UNuhoudGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	UNuhoudGameInstance();

	virtual void Init() override;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Cloud")
	FString CloudBackendURL;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Cloud")
	FString CloudWebSocketURL;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Cloud")
	FString CloudPatientId;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Cloud")
	FString CloudAuthToken;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Tracking")
	ENuhoudTrackingMode TrackingMode;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionScore;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionStreak;

	/** Tasks completed (lantern hung, date served, date eaten). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionReps;

	/** Tasks started, including ones that timed out. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionAttempts;

	/** Completed only with the assisted (touch) fallback. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionAssisted;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionGraspCount;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionPinchCount;

	/** Objects picked up by each hand, for the session's limb. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionRightGrabs;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 SessionLeftGrabs;

	/** Best fist closure reached, 0..1. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	float SessionMaxGrip;

	/** Smallest thumb-to-index distance reached, cm. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	float SessionMinPinchCm;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	float SessionMaxAngle;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	float SessionAvgAngle;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	int32 AngleSampleCount;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	float SessionMaxElbowROM;

	/** The patient ended the session with the pain-stop button. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Session")
	bool bEndedByPainStop;

	/** Short status of the last cloud save, shown to the patient. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Nuhoud|Cloud")
	FString LastSyncMessage;

	bool IsSignedIn() const { return !CloudPatientId.IsEmpty() && !CloudAuthToken.IsEmpty(); }

	void ResetSession();
	void AddScore(int32 Points);
	void IncrementStreak();
	void ResetStreak();
	void IncrementReps();
	void RecordTaskAttempt(bool bAssisted);
	void RecordGrab(bool bPinch, bool bRightHand);
	void RecordGripSample(float Closure, float PinchCm);
	void UpdateMaxAngle(float Angle);
	void UpdateElbowAngle(float Angle);
	void MarkPainStop() { bEndedByPainStop = true; }

	/**
	 * Saves the finished session to Saved/LocalSessions, then sends it to the doctor's dashboard.
	 * The file is deleted only once the server has stored it, so a dropped connection or closing
	 * the game never loses a session. Runs at most once per session.
	 */
	UFUNCTION(BlueprintCallable, Category = "Nuhoud|Cloud")
	void SyncSessionToCloud();

	/** Sends every saved session of the signed-in patient that has not reached the server yet. */
	UFUNCTION(BlueprintCallable, Category = "Nuhoud|Cloud")
	void UploadPendingSessions();

	static FString LocalSessionsDir();

private:
	TSharedRef<class FJsonObject> BuildSessionPayload(float DurationSeconds) const;
	void UploadSessionFile(const FString& Path);
	void OnUploadFinished(const FString& Path, int32 Code, const FString& ResponseBody);
	void ScheduleRetry();

	double SessionStartSeconds;
	FDateTime SessionStartUtc;
	FString SessionClientId;
	FString CurrentSessionFile;
	bool bSessionSynced;

	/** Shoulder elevation over the session for the doctor's replay chart, sampled every TimelineInterval. */
	TArray<float> AngleTimeline;
	double TimelineInterval;
	double TimelineLastSample;
	float TimelinePeak;

	TSet<FString> UploadsInFlight;
	FTimerHandle RetryHandle;
	int32 RetryRound;
};
