#include "NuhoudGameInstance.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/FileManager.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "TimerManager.h"

namespace
{
	constexpr float NoPinchCm = 99.f;

	/** One decimal, computed in double so the JSON says 4.3 rather than 4.300000190734863. */
	double Round1(float Value)
	{
		return FMath::RoundToDouble(static_cast<double>(Value) * 10.0) / 10.0;
	}

	// The doctor's replay chart plays 10 samples a second; the server keeps up to 5000.
	constexpr double TimelineBaseInterval = 0.1;
	constexpr int32 TimelineMaxSamples = 5000;

	constexpr float UploadTimeoutSeconds = 20.f;
	constexpr float PlanTimeoutSeconds = 10.f;
	const float RetryDelays[] = { 10.f, 30.f, 60.f };

	// Used until the doctor's plan arrives, and when the patient has none: the clinic's starter plan.
	constexpr float DefaultTargetAngle = 45.f;
}

UNuhoudGameInstance::UNuhoudGameInstance()
{
	CloudBackendURL = TEXT("https://nuhod.vercel.app/api/v2");
	CloudWebSocketURL = TEXT("ws://127.0.0.1:8001/ws/track");
	CloudPatientId = TEXT("");
	CloudAuthToken = TEXT("");
	TrackingMode = ENuhoudTrackingMode::Camera;
	PlanTargetAngle = DefaultTargetAngle;
	PlanDailyTasks = 0;
	PlanLimb = ENuhoudPlanLimb::Both;
	bPlanFromDoctor = false;
	RetryRound = 0;
	ResetSession();
}

void UNuhoudGameInstance::FetchActivePlan(TFunction<void()> OnDone)
{
	if (!IsSignedIn())
	{
		OnDone();
		return;
	}

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(CloudBackendURL / TEXT("patients") / CloudPatientId / TEXT("plans"));
	Request->SetVerb(TEXT("GET"));
	Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *CloudAuthToken));
	Request->SetTimeout(PlanTimeoutSeconds);

	TWeakObjectPtr<UNuhoudGameInstance> WeakThis(this);
	Request->OnProcessRequestComplete().BindLambda(
		[WeakThis, OnDone = MoveTemp(OnDone)](FHttpRequestPtr, FHttpResponsePtr Resp, bool bConnected)
		{
			UNuhoudGameInstance* GI = WeakThis.Get();
			if (!GI)
			{
				return;
			}
			const int32 Code = bConnected && Resp.IsValid() ? Resp->GetResponseCode() : 0;

			// GET /api/v2/patients/{id}/plans: { ok, plans: [...] }, newest first.
			TSharedPtr<FJsonObject> Json;
			const TArray<TSharedPtr<FJsonValue>>* Plans = nullptr;
			const TSharedPtr<FJsonObject>* Active = nullptr;
			if (Code == 200 && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Resp->GetContentAsString()), Json)
				&& Json.IsValid() && Json->TryGetArrayField(TEXT("plans"), Plans))
			{
				for (const TSharedPtr<FJsonValue>& Value : *Plans)
				{
					const TSharedPtr<FJsonObject>* Plan = nullptr;
					bool bActive = false;
					if (Value->TryGetObject(Plan) && (*Plan)->TryGetBoolField(TEXT("active"), bActive) && bActive)
					{
						Active = Plan;
						break;
					}
				}
			}

			if (Active)
			{
				double Angle = DefaultTargetAngle;
				double Tasks = 0.0;
				FString Limb;
				(*Active)->TryGetNumberField(TEXT("targetAngle"), Angle);
				(*Active)->TryGetNumberField(TEXT("dailyRepGoal"), Tasks);
				(*Active)->TryGetStringField(TEXT("targetLimb"), Limb);
				GI->PlanTargetAngle = FMath::Clamp(static_cast<float>(Angle), 20.f, 160.f);
				GI->PlanDailyTasks = FMath::Clamp(FMath::RoundToInt(Tasks), 0, 200);
				GI->PlanLimb = Limb.Contains(TEXT("left")) ? ENuhoudPlanLimb::Left
					: Limb.Contains(TEXT("right")) ? ENuhoudPlanLimb::Right : ENuhoudPlanLimb::Both;
				GI->bPlanFromDoctor = true;
				UE_LOG(LogTemp, Log, TEXT("Nuhoud: plan from the doctor: target %.0f deg, %d tasks, %s hand"),
					GI->PlanTargetAngle, GI->PlanDailyTasks,
					GI->PlanLimb == ENuhoudPlanLimb::Right ? TEXT("right") : GI->PlanLimb == ENuhoudPlanLimb::Left ? TEXT("left") : TEXT("either"));
			}
			else
			{
				UE_LOG(LogTemp, Warning, TEXT("Nuhoud: no active plan (HTTP %d), playing with the defaults: target %.0f deg, no task limit, either hand"),
					Code, GI->PlanTargetAngle);
			}
			OnDone();
		});
	Request->ProcessRequest();
}

void UNuhoudGameInstance::Init()
{
	Super::Init();

	// Point the game at another server (staging, a local dashboard, a pose server on another PC).
	FString Value;
	if (FParse::Value(FCommandLine::Get(), TEXT("NuhoudBackend="), Value)) CloudBackendURL = Value;
	if (FParse::Value(FCommandLine::Get(), TEXT("NuhoudPoseServer="), Value)) CloudWebSocketURL = Value;

	TArray<FString> Pending;
	IFileManager::Get().FindFiles(Pending, *(LocalSessionsDir() / TEXT("*.json")), true, false);
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: backend %s, pose server %s, %d saved session(s) waiting to upload"),
		*CloudBackendURL, *CloudWebSocketURL, Pending.Num());
}

FString UNuhoudGameInstance::LocalSessionsDir()
{
	return FPaths::ProjectSavedDir() / TEXT("LocalSessions");
}

void UNuhoudGameInstance::ResetSession()
{
	SessionScore = 0;
	SessionStreak = 0;
	SessionReps = 0;
	SessionAttempts = 0;
	SessionAssisted = 0;
	SessionGraspCount = 0;
	SessionPinchCount = 0;
	SessionRightGrabs = 0;
	SessionLeftGrabs = 0;
	SessionMaxGrip = 0.f;
	SessionMinPinchCm = NoPinchCm;
	SessionMaxAngle = 0.f;
	SessionStartSeconds = FPlatformTime::Seconds();
	SessionStartUtc = FDateTime::UtcNow();
	SessionClientId = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower);
	CurrentSessionFile.Empty();
	SessionAvgAngle = 0.f;
	AngleSampleCount = 0;
	SessionMaxElbowROM = 0.f;
	bEndedByPainStop = false;
	AngleTimeline.Reset();
	TimelineInterval = TimelineBaseInterval;
	TimelineLastSample = SessionStartSeconds;
	TimelinePeak = 0.f;
	LastSyncMessage.Empty();
	bSessionSynced = false;
}

void UNuhoudGameInstance::AddScore(int32 Points)
{
	SessionScore += Points;
}

void UNuhoudGameInstance::IncrementStreak()
{
	SessionStreak++;
}

void UNuhoudGameInstance::ResetStreak()
{
	SessionStreak = 0;
}

void UNuhoudGameInstance::IncrementReps()
{
	SessionReps++;
}

void UNuhoudGameInstance::RecordTaskAttempt(bool bAssisted)
{
	SessionAttempts++;
	if (bAssisted) SessionAssisted++;
}

void UNuhoudGameInstance::RecordGrab(bool bPinch, bool bRightHand)
{
	if (bPinch) SessionPinchCount++;
	else SessionGraspCount++;
	if (bRightHand) SessionRightGrabs++;
	else SessionLeftGrabs++;
}

void UNuhoudGameInstance::RecordGripSample(float Closure, float PinchCm)
{
	SessionMaxGrip = FMath::Max(SessionMaxGrip, Closure);
	if (PinchCm > 0.f) SessionMinPinchCm = FMath::Min(SessionMinPinchCm, PinchCm);
}

void UNuhoudGameInstance::UpdateMaxAngle(float Angle)
{
	if (Angle > SessionMaxAngle)
	{
		SessionMaxAngle = Angle;
	}
	AngleSampleCount++;
	SessionAvgAngle += (Angle - SessionAvgAngle) / AngleSampleCount;

	// Keep the higher arm of each interval: that is the one reaching.
	TimelinePeak = FMath::Max(TimelinePeak, Angle);
	const double Now = FPlatformTime::Seconds();
	if (Now - TimelineLastSample >= TimelineInterval)
	{
		TimelineLastSample = Now;
		AngleTimeline.Add(FMath::RoundToFloat(TimelinePeak * 10.f) / 10.f);
		TimelinePeak = 0.f;
		if (AngleTimeline.Num() >= TimelineMaxSamples)
		{
			// Long session: halve the resolution so the whole session still fits.
			for (int32 i = 0; i < AngleTimeline.Num() / 2; i++)
			{
				AngleTimeline[i] = FMath::Max(AngleTimeline[2 * i], AngleTimeline[2 * i + 1]);
			}
			AngleTimeline.SetNum(AngleTimeline.Num() / 2);
			TimelineInterval *= 2.0;
		}
	}
}

void UNuhoudGameInstance::UpdateElbowAngle(float Angle)
{
	if (Angle > SessionMaxElbowROM)
	{
		SessionMaxElbowROM = Angle;
	}
}

TSharedRef<FJsonObject> UNuhoudGameInstance::BuildSessionPayload(float DurationSeconds) const
{
	// Field names and types follow POST /api/v2/sessions (nhod/src/app/api/v2/sessions/route.ts).
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("patientId"), CloudPatientId);
	Body->SetStringField(TEXT("clientSessionId"), SessionClientId);
	Body->SetStringField(TEXT("sessionDate"), SessionStartUtc.ToIso8601());
	Body->SetStringField(TEXT("source"), TrackingMode == ENuhoudTrackingMode::Headset ? TEXT("ue5-vr") : TEXT("ue5"));
	if (SessionRightGrabs > 0 || SessionLeftGrabs > 0)
	{
		Body->SetStringField(TEXT("limb"), SessionRightGrabs > 0 && SessionLeftGrabs > 0
			? TEXT("bilateral") : (SessionRightGrabs > 0 ? TEXT("right") : TEXT("left")));
	}
	Body->SetNumberField(TEXT("durationSeconds"), FMath::RoundToInt(DurationSeconds));
	Body->SetNumberField(TEXT("totalReps"), SessionAttempts);
	Body->SetNumberField(TEXT("correctReps"), FMath::Max(0, SessionReps - SessionAssisted));
	Body->SetNumberField(TEXT("compensationErrors"), 0);
	Body->SetNumberField(TEXT("gamificationScore"), SessionScore);
	Body->SetNumberField(TEXT("maxAchievedAngle"), Round1(SessionMaxAngle));
	Body->SetNumberField(TEXT("avgShoulderAngle"), Round1(SessionAvgAngle));
	Body->SetNumberField(TEXT("maxElbowROM"), Round1(SessionMaxElbowROM));
	Body->SetNumberField(TEXT("gripClosureMax"), Round1(SessionMaxGrip * 100.f));
	Body->SetNumberField(TEXT("pinchMinCm"), SessionMinPinchCm < NoPinchCm ? Round1(SessionMinPinchCm) : 0.0);
	Body->SetNumberField(TEXT("graspCount"), SessionGraspCount);
	Body->SetNumberField(TEXT("pinchCount"), SessionPinchCount);
	Body->SetNumberField(TEXT("tasksAssisted"), SessionAssisted);
	Body->SetBoolField(TEXT("painStop"), bEndedByPainStop);

	TArray<TSharedPtr<FJsonValue>> Timeline;
	Timeline.Reserve(AngleTimeline.Num());
	for (float Angle : AngleTimeline)
	{
		Timeline.Add(MakeShared<FJsonValueNumber>(Round1(Angle)));
	}
	Body->SetArrayField(TEXT("angleTimeline"), Timeline);
	return Body;
}

void UNuhoudGameInstance::SyncSessionToCloud()
{
	if (bSessionSynced) return;

	const float Duration = FPlatformTime::Seconds() - SessionStartSeconds;
	if (SessionAttempts == 0 && Duration < 60.f && !bEndedByPainStop)
	{
		UE_LOG(LogTemp, Log, TEXT("Nuhoud: nothing to save yet (%.0fs, no tasks)."), Duration);
		return;
	}
	bSessionSynced = true;

	FString BodyString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&BodyString);
	FJsonSerializer::Serialize(BuildSessionPayload(Duration), Writer);

	// Written before sending, so the session survives no internet, a server error or the game closing mid-upload.
	CurrentSessionFile = LocalSessionsDir() / FString::Printf(TEXT("Session_%s_%s.json"),
		*SessionStartUtc.ToString(TEXT("%Y%m%d-%H%M%S")), *SessionClientId);
	IFileManager::Get().MakeDirectory(*LocalSessionsDir(), true);
	if (!FFileHelper::SaveStringToFile(BodyString, *CurrentSessionFile, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
	{
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: could not write %s"), *CurrentSessionFile);
	}
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: session saved to %s. Tasks=%d/%d Score=%d MaxAngle=%.1f Grip=%.0f%% PainStop=%d"),
		*FPaths::ConvertRelativePathToFull(CurrentSessionFile), SessionReps, SessionAttempts, SessionScore,
		SessionMaxAngle, SessionMaxGrip * 100.f, bEndedByPainStop ? 1 : 0);

	if (!IsSignedIn())
	{
		LastSyncMessage = TEXT("Saved on this computer - sign in to send it to your doctor");
		UE_LOG(LogTemp, Warning, TEXT("Nuhoud: not signed in, session kept locally."));
		return;
	}
	LastSyncMessage = TEXT("Saving session...");
	UploadSessionFile(CurrentSessionFile);
}

void UNuhoudGameInstance::UploadPendingSessions()
{
	if (!IsSignedIn()) return;

	TArray<FString> Files;
	IFileManager::Get().FindFiles(Files, *(LocalSessionsDir() / TEXT("*.json")), true, false);
	int32 Sent = 0;
	for (const FString& Name : Files)
	{
		const FString Path = LocalSessionsDir() / Name;
		if (UploadsInFlight.Contains(Path)) continue;

		// Only the patient who played a session may upload it.
		FString Json;
		TSharedPtr<FJsonObject> Saved;
		if (!FFileHelper::LoadFileToString(Json, *Path) ||
			!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Saved) || !Saved.IsValid() ||
			Saved->GetStringField(TEXT("patientId")) != CloudPatientId)
		{
			continue;
		}
		UploadSessionFile(Path);
		Sent++;
	}
	if (Files.Num() > 0)
	{
		UE_LOG(LogTemp, Log, TEXT("Nuhoud: %d saved session(s) on disk, sending %d for this patient"), Files.Num(), Sent);
	}
}

void UNuhoudGameInstance::UploadSessionFile(const FString& Path)
{
	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Path)) return;

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(CloudBackendURL / TEXT("sessions"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetHeader(TEXT("Authorization"), FString::Printf(TEXT("Bearer %s"), *CloudAuthToken));
	Request->SetTimeout(UploadTimeoutSeconds);
	Request->SetContentAsString(Json);

	TWeakObjectPtr<UNuhoudGameInstance> WeakThis(this);
	Request->OnProcessRequestComplete().BindLambda(
		[WeakThis, Path](FHttpRequestPtr, FHttpResponsePtr Resp, bool bConnected)
		{
			if (!WeakThis.IsValid()) return;
			const int32 Code = bConnected && Resp.IsValid() ? Resp->GetResponseCode() : 0;
			WeakThis->OnUploadFinished(Path, Code, Resp.IsValid() ? Resp->GetContentAsString() : FString());
		});

	UploadsInFlight.Add(Path);
	Request->ProcessRequest();
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: uploading %s"), *FPaths::GetCleanFilename(Path));
}

void UNuhoudGameInstance::OnUploadFinished(const FString& Path, int32 Code, const FString& ResponseBody)
{
	UploadsInFlight.Remove(Path);
	const bool bCurrent = Path == CurrentSessionFile;
	const FString Name = FPaths::GetCleanFilename(Path);

	if (Code >= 200 && Code < 300)
	{
		// The server has it (a replay of a stored session also answers 200), so the local copy can go.
		IFileManager::Get().Delete(*Path);
		RetryRound = 0;
		UE_LOG(LogTemp, Log, TEXT("Nuhoud: session sync saved (HTTP %d) %s%s"), Code, *Name,
			ResponseBody.Contains(TEXT("\"duplicate\":true")) ? TEXT(" (already on the server)") : TEXT(""));
		if (bCurrent) LastSyncMessage = TEXT("Session saved - your doctor can see it now");
		return;
	}

	if (Code == 400 || Code == 409)
	{
		// The server will never accept this file as it is: park it for a person to look at instead of retrying forever.
		const FString Rejected = LocalSessionsDir() / TEXT("Rejected") / Name;
		IFileManager::Get().Move(*Rejected, *Path);
		UE_LOG(LogTemp, Error, TEXT("Nuhoud: session sync FAILED (HTTP %d), moved to %s: %s"), Code, *Rejected, *ResponseBody.Left(300));
		if (bCurrent) LastSyncMessage = FString::Printf(TEXT("Session could not be saved (error %d)"), Code);
		return;
	}

	// No internet, server down, expired sign-in: keep the file and try again.
	UE_LOG(LogTemp, Warning, TEXT("Nuhoud: session sync FAILED (HTTP %d), kept %s for a later upload %s"), Code, *Name, *ResponseBody.Left(200));
	if (bCurrent)
	{
		LastSyncMessage = Code == 401
			? FString(TEXT("Saved on this computer - sign in again to send it to your doctor"))
			: FString(TEXT("No connection - saved on this computer, it will be sent automatically"));
	}
	if (Code != 401) ScheduleRetry();
}

void UNuhoudGameInstance::ScheduleRetry()
{
	FTimerManager& Timers = GetTimerManager();
	if (Timers.IsTimerActive(RetryHandle)) return;

	const float Delay = RetryDelays[FMath::Min(RetryRound, (int32)UE_ARRAY_COUNT(RetryDelays) - 1)];
	RetryRound++;
	Timers.SetTimer(RetryHandle, FTimerDelegate::CreateUObject(this, &UNuhoudGameInstance::UploadPendingSessions), Delay, false);
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: retrying the upload in %.0fs"), Delay);
}
