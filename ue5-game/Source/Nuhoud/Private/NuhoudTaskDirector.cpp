#include "NuhoudTaskDirector.h"
#include "NuhoudLantern.h"
#include "NuhoudTargetMarker.h"
#include "NuhoudMajlis.h"
#include "NuhoudFirstPersonPawn.h"
#include "NuhoudInputAdapter.h"
#include "NuhoudGameInstance.h"
#include "Engine/World.h"
#include "TimerManager.h"

namespace
{
	constexpr int32 InitialLanterns = 2;
	constexpr int32 FullPoints = 100;
	constexpr int32 AssistedPoints = 50;
	constexpr float TaskTimeoutSeconds[] = { 45.f, 60.f, 60.f };
	constexpr float TouchLightingAfterSeconds = 15.f;
	constexpr float HoldOnTargetSeconds = 0.9f;
	// Radii are on-screen distances (see ANuhoudFirstPersonPawn::PerceivedDistance).
	constexpr float HookCatchRadius = 12.f;
	constexpr float HookReleaseRadius = 16.f;
	constexpr float HookMinAboveTable = 30.f;
	constexpr float PlateRadius = 10.f;
	constexpr float PlateReleaseRadius = 12.f;
	constexpr float MouthRadius = 14.f;
	// Mouth relative to the eyes: slightly forward and below.
	const FVector MouthLocal(6.f, 0.f, -9.f);
}

ANuhoudTaskDirector::ANuhoudTaskDirector()
{
	PrimaryActorTick.bCanEverTick = true;

	Majlis = nullptr;
	PatientPawn = nullptr;
	InputAdapter = nullptr;
	TaskLantern = nullptr;
	TaskMarker = nullptr;
	Task = ETask::HangLantern;
	TaskSide = ENuhoudHandSide::Right;
	TaskCount = 0;
	bTaskActive = false;
	bSessionOver = false;
	TaskTime = 0.f;
	OnTargetTime = 0.f;
	Difficulty = 0.3f;
	NextSlot = 0;
	FeedbackTime = 0.f;
}

void ANuhoudTaskDirector::Setup(ANuhoudMajlis* InMajlis, ANuhoudFirstPersonPawn* InPawn)
{
	Majlis = InMajlis;
	PatientPawn = InPawn;

	UWorld* World = GetWorld();
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	for (const FTransform& Home : Majlis->GetDateHomes())
	{
		if (ANuhoudDate* Date = World->SpawnActor<ANuhoudDate>(ANuhoudDate::StaticClass(), Home, Params))
		{
			Date->SetHome(Home);
			Date->OnReleased.BindUObject(this, &ANuhoudTaskDirector::OnDateReleased);
			Dates.Add(Date);
		}
	}

	auto SpawnProp = [this, World, &Params](UClass* Class, const FTransform& Base)
	{
		if (ANuhoudGrabbable* Prop = World->SpawnActor<ANuhoudGrabbable>(Class, Base, Params))
		{
			FTransform Home = Base;
			Home.AddToTranslation(FVector(0.f, 0.f, Prop->GetRestHeight()));
			Prop->SetHome(Home);
			Props.Add(Prop);
		}
	};
	for (const FTransform& Base : Majlis->GetCupHomes())
	{
		SpawnProp(ANuhoudFinjan::StaticClass(), Base);
	}
	SpawnProp(ANuhoudDallah::StaticClass(), Majlis->GetDallahHome());

	// Two lanterns already burning so the room is warm before the first repetition.
	const TArray<FVector>& Slots = Majlis->GetHangSlots();
	for (int32 i = 0; i < InitialLanterns && i < Slots.Num(); i++)
	{
		const FVector Slot = Slots[Slots.Num() - 1 - i];
		if (ANuhoudLantern* Lantern = World->SpawnActor<ANuhoudLantern>(ANuhoudLantern::StaticClass(), Slot, FRotator::ZeroRotator, Params))
		{
			Lantern->HangAsDecoration(Slot, Majlis->GetCeilingZ(), true);
		}
	}
}

void ANuhoudTaskDirector::StartSession(ANuhoudInputAdapter* InInputAdapter)
{
	InputAdapter = InInputAdapter;
	TaskCount = 0;
	GetWorldTimerManager().SetTimer(NextTaskTimer, this, &ANuhoudTaskDirector::StartNextTask, 2.f, false);
}

void ANuhoudTaskDirector::EndSession()
{
	if (bSessionOver) return;
	bSessionOver = true;
	bTaskActive = false;
	GetWorldTimerManager().ClearAllTimersForObject(this);
	ClearTaskObjects();
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: tasks stopped, the session ended after %d task(s)"), TaskCount);
}

void ANuhoudTaskDirector::AfterDelay(float Seconds, TFunction<void()> Action)
{
	FTimerHandle Handle;
	GetWorldTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, MoveTemp(Action)), Seconds, false);
}

// ── Task flow ──────────────────────────────────────────────────────────────

void ANuhoudTaskDirector::StartNextTask()
{
	if (bSessionOver) return;
	ClearTaskObjects();

	Task = static_cast<ETask>(TaskCount % 3);
	TaskSide = TaskCount % 2 == 0 ? ENuhoudHandSide::Right : ENuhoudHandSide::Left;
	TaskCount++;
	TaskTime = 0.f;
	OnTargetTime = 0.f;
	bTaskActive = true;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	const bool bRight = TaskSide == ENuhoudHandSide::Right;
	const FRotator Facing(0.f, Majlis->GetPatientYaw(), 0.f);

	if (Task == ETask::HangLantern)
	{
		const FVector Spot = Majlis->GetLanternSpot(bRight);
		TaskLantern = GetWorld()->SpawnActor<ANuhoudLantern>(ANuhoudLantern::StaticClass(), Spot, Facing, Params);
		if (TaskLantern)
		{
			TaskLantern->SetHome(FTransform(Facing, Spot + FVector(0.f, 0.f, TaskLantern->GetRestHeight())));
			TaskLantern->OnReleased.BindUObject(this, &ANuhoudTaskDirector::OnLanternReleased);
			TaskLantern->OnTouchLit.BindUObject(this, &ANuhoudTaskDirector::OnLanternTouchLit);
		}
		const FVector Hook = ChooseHookLocation(TaskSide);
		TaskMarker = GetWorld()->SpawnActor<ANuhoudTargetMarker>(ANuhoudTargetMarker::StaticClass(), Hook, Facing, Params);
		if (TaskMarker) TaskMarker->BuildHook(Majlis->GetCeilingZ());
		if (PatientPawn)
		{
			const FVector Local = PatientPawn->GetBodyFrame().InverseTransformPosition(Hook);
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: hook placed at %.1f %.1f %.1f (cm from the eyes: forward right up)"), Local.X, Local.Y, Local.Z);
		}
	}
	else if (Task == ETask::ServeDate)
	{
		TaskMarker = GetWorld()->SpawnActor<ANuhoudTargetMarker>(ANuhoudTargetMarker::StaticClass(),
			Majlis->GetPlateSpot(bRight), Facing, Params);
		if (TaskMarker) TaskMarker->BuildPlate();
	}
}

void ANuhoudTaskDirector::ClearTaskObjects()
{
	if (IsValid(TaskLantern)) TaskLantern->Destroy();
	if (IsValid(TaskMarker)) TaskMarker->Destroy();
	TaskLantern = nullptr;
	TaskMarker = nullptr;
}

void ANuhoudTaskDirector::CompleteTask(int32 Points, const FString& Message)
{
	bTaskActive = false;
	OnTargetTime = 0.f;

	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->AddScore(Points);
		GI->IncrementStreak();
		GI->IncrementReps();
		GI->RecordTaskAttempt(Points < FullPoints);
	}
	if (Task == ETask::HangLantern)
	{
		const float Step = TaskTime < 10.f ? 0.08f : (TaskTime > 25.f ? -0.08f : 0.03f);
		Difficulty = FMath::Clamp(Difficulty + Step, 0.f, 1.f);
	}

	Feedback = FString::Printf(TEXT("%s   +%d"), *Message, Points);
	FeedbackTime = 2.f;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d done in %.1fs (+%d), difficulty %.2f"), TaskCount, TaskTime, Points, Difficulty);
	GetWorldTimerManager().SetTimer(NextTaskTimer, this, &ANuhoudTaskDirector::StartNextTask, 2.2f, false);
}

void ANuhoudTaskDirector::FailTask()
{
	bTaskActive = false;
	if (UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		GI->ResetStreak();
		GI->RecordTaskAttempt(false);
	}
	// Out of comfortable reach for now: ease off rather than keep failing.
	if (Task == ETask::HangLantern)
	{
		Difficulty = FMath::Max(0.f, Difficulty - 0.15f);
	}
	Feedback = TEXT("Let's try a different one");
	FeedbackTime = 2.f;
	UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d failed after %.1fs, difficulty %.2f"), TaskCount, TaskTime, Difficulty);
	ClearTaskObjects();
	GetWorldTimerManager().SetTimer(NextTaskTimer, this, &ANuhoudTaskDirector::StartNextTask, 1.5f, false);
}

void ANuhoudTaskDirector::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	FeedbackTime = FMath::Max(0.f, FeedbackTime - DeltaTime);
	if (!bTaskActive || !InputAdapter) return;

	TaskTime += DeltaTime;
	switch (Task)
	{
	case ETask::HangLantern: EvaluateLantern(DeltaTime); break;
	case ETask::ServeDate: EvaluateServe(DeltaTime); break;
	case ETask::EatDate: EvaluateEat(); break;
	}

	if (bTaskActive && TaskTime > TaskTimeoutSeconds[static_cast<int32>(Task)])
	{
		FailTask();
	}
}

// ── Lantern: reach, grasp, lift to the hook, release ───────────────────────

void ANuhoudTaskDirector::EvaluateLantern(float DeltaTime)
{
	if (!IsValid(TaskLantern) || !IsValid(TaskMarker)) return;

	TArray<FVector> Palms;
	InputAdapter->GetInteractionPoints(Palms);
	float NearestPalm = TNumericLimits<float>::Max();
	for (const FVector& Palm : Palms)
	{
		NearestPalm = FMath::Min(NearestPalm, Perceived(Palm, TaskLantern->GetActorLocation()));
	}
	TaskLantern->SetTouchLighting(TaskTime > TouchLightingAfterSeconds, NearestPalm);

	// Holding it steady at the hook also counts, for patients who cannot open the hand yet.
	const bool bHeldAtHook = TaskLantern->GetState() == ENuhoudGrabState::Held
		&& Perceived(TaskLantern->GetGrabAnchor(), TaskMarker->GetActorLocation()) < HookCatchRadius;
	OnTargetTime = bHeldAtHook ? OnTargetTime + DeltaTime : 0.f;
	if (OnTargetTime > HoldOnTargetSeconds)
	{
		HangLanternOnHook();
	}
}

void ANuhoudTaskDirector::OnLanternReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip)
{
	if (bTaskActive && Task == ETask::HangLantern && Grabbable == TaskLantern && IsValid(TaskMarker)
		&& Perceived(Grabbable->GetGrabAnchor(), TaskMarker->GetActorLocation()) < HookReleaseRadius)
	{
		HangLanternOnHook();
	}
}

void ANuhoudTaskDirector::HangLanternOnHook()
{
	ANuhoudLantern* Lantern = TaskLantern;
	ANuhoudTargetMarker* Marker = TaskMarker;
	TaskLantern = nullptr;
	TaskMarker = nullptr;

	const FRotator Upright(0.f, Lantern->GetActorRotation().Yaw, 0.f);
	Lantern->PlaceAt(FTransform(Upright, Marker->GetActorLocation() - Upright.RotateVector(Lantern->GetGrabAnchorLocal())));
	Lantern->LightUp();
	Marker->Celebrate();
	CompleteTask(FullPoints, TEXT("Beautiful! The majlis glows brighter"));

	TWeakObjectPtr<ANuhoudLantern> WeakLantern(Lantern);
	TWeakObjectPtr<ANuhoudTargetMarker> WeakMarker(Marker);
	AfterDelay(1.4f, [this, WeakLantern, WeakMarker]()
	{
		if (WeakLantern.IsValid()) HangDecoration(WeakLantern.Get(), false);
		if (WeakMarker.IsValid()) WeakMarker->Destroy();
	});
}

void ANuhoudTaskDirector::OnLanternTouchLit(ANuhoudLantern* Lantern)
{
	if (!bTaskActive || Task != ETask::HangLantern || Lantern != TaskLantern) return;

	ANuhoudTargetMarker* Marker = TaskMarker;
	TaskLantern = nullptr;
	TaskMarker = nullptr;
	if (Marker) Marker->Celebrate();
	CompleteTask(AssistedPoints, TEXT("It's lit! Next time try closing your hand around it"));

	TWeakObjectPtr<ANuhoudLantern> WeakLantern(Lantern);
	TWeakObjectPtr<ANuhoudTargetMarker> WeakMarker(Marker);
	AfterDelay(1.4f, [this, WeakLantern, WeakMarker]()
	{
		if (WeakLantern.IsValid()) HangDecoration(WeakLantern.Get(), false);
		if (WeakMarker.IsValid()) WeakMarker->Destroy();
	});
}

FVector ANuhoudTaskDirector::ChooseHookLocation(ENuhoudHandSide Side) const
{
	const FTransform Body = PatientPawn ? PatientPawn->GetBodyFrame() : FTransform(Majlis->GetPatientEyes());
	const float SideSign = Side == ENuhoudHandSide::Right ? 1.f : -1.f;
	const FVector Shoulder = InputAdapter->GetShoulderLocal(Side);
	const float Reach = InputAdapter->GetReachLength(Side);

	// Elevation 0 = arm hanging down, 90 = horizontal; Plane 0 = straight ahead, 90 = out to the side.
	const float Elevation = FMath::DegreesToRadians(FMath::FRandRange(45.f, 75.f + 45.f * Difficulty));
	const float Plane = FMath::DegreesToRadians(FMath::FRandRange(0.f, 40.f));
	const float Distance = Reach * FMath::Lerp(0.6f, 0.9f, Difficulty);

	FVector Local = Shoulder + Distance * FVector(
		FMath::Sin(Elevation) * FMath::Cos(Plane),
		SideSign * FMath::Sin(Elevation) * FMath::Sin(Plane),
		-FMath::Cos(Elevation));

	// High enough that the hanging lantern clears the table, and inside the camera's view cone.
	Local.Z = FMath::Max(Local.Z, Majlis->GetTableTopZ() + HookMinAboveTable - Body.GetLocation().Z);
	Local.X = FMath::Max3(Local.X, 25.0, FMath::Max(-Local.Z, FMath::Abs(Local.Y) * 1.2));
	return Body.TransformPosition(Local);
}

void ANuhoudTaskDirector::HangDecoration(ANuhoudLantern* Lantern, bool bInstant)
{
	const TArray<FVector>& Slots = Majlis->GetHangSlots();
	const int32 Usable = FMath::Max(1, Slots.Num() - InitialLanterns);

	// Once every hook is used, the oldest lantern makes room for the newest.
	if (HangingLanterns.Num() >= Usable)
	{
		if (IsValid(HangingLanterns[0])) HangingLanterns[0]->Destroy();
		HangingLanterns.RemoveAt(0);
	}

	Lantern->HangAsDecoration(Slots[NextSlot % Usable], Majlis->GetCeilingZ(), bInstant);
	NextSlot++;
	HangingLanterns.Add(Lantern);
}

// ── Dates: pinch, then serve on the plate or bring to the mouth ────────────

float ANuhoudTaskDirector::Perceived(const FVector& A, const FVector& B) const
{
	return PatientPawn ? PatientPawn->PerceivedDistance(A, B) : FVector::Dist(A, B);
}

bool ANuhoudTaskDirector::IsOverPlate(const AActor* Date, float Radius, float MaxHeight) const
{
	if (!IsValid(TaskMarker)) return false;
	const FVector Top = TaskMarker->GetPlateTop();
	const FVector P = Date->GetActorLocation();
	const float Height = P.Z - Top.Z;
	return Height > -3.f && Height < MaxHeight && Perceived(FVector(P.X, P.Y, Top.Z), Top) < Radius;
}

bool ANuhoudTaskDirector::IsAnyDateHeld() const
{
	for (const ANuhoudDate* Date : Dates)
	{
		if (IsValid(Date) && Date->GetState() == ENuhoudGrabState::Held) return true;
	}
	return false;
}

void ANuhoudTaskDirector::EvaluateServe(float DeltaTime)
{
	if (!IsValid(TaskMarker)) return;

	bool bHeldOverPlate = false;
	for (ANuhoudDate* Date : Dates)
	{
		if (!IsValid(Date)) continue;
		const ENuhoudGrabState S = Date->GetState();
		if (S == ENuhoudGrabState::Held && IsOverPlate(Date, PlateRadius, 12.f))
		{
			bHeldOverPlate = true;
			if (OnTargetTime + DeltaTime > HoldOnTargetSeconds)
			{
				ServeDate(Date);
				return;
			}
		}
		else if (S == ENuhoudGrabState::Free && IsOverPlate(Date, PlateRadius, 4.f) && Date->GetVelocity().Size() < 15.f)
		{
			// Dropped and came to rest on the plate.
			ServeDate(Date);
			return;
		}
	}
	OnTargetTime = bHeldOverPlate ? OnTargetTime + DeltaTime : 0.f;
}

void ANuhoudTaskDirector::OnDateReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip)
{
	if (bTaskActive && Task == ETask::ServeDate && IsOverPlate(Grabbable, PlateReleaseRadius, 20.f))
	{
		ServeDate(Grabbable);
	}
}

void ANuhoudTaskDirector::ServeDate(ANuhoudGrabbable* Date)
{
	ANuhoudTargetMarker* Marker = TaskMarker;
	TaskMarker = nullptr;

	Date->PlaceAt(FTransform(Date->GetActorRotation(), Marker->GetPlateTop() + FVector(0.f, 0.f, Date->GetRestHeight())));
	Marker->Celebrate();
	CompleteTask(FullPoints, TEXT("Thank you! Your guest is served"));

	TWeakObjectPtr<ANuhoudGrabbable> WeakDate(Date);
	TWeakObjectPtr<ANuhoudTargetMarker> WeakMarker(Marker);
	AfterDelay(1.8f, [WeakDate, WeakMarker]()
	{
		if (WeakDate.IsValid()) WeakDate->ReturnHome();
		if (WeakMarker.IsValid()) WeakMarker->Destroy();
	});
}

FVector ANuhoudTaskDirector::GetMouthLocation() const
{
	return PatientPawn
		? PatientPawn->GetBodyFrame().TransformPosition(MouthLocal)
		: Majlis->GetPatientEyes() + MouthLocal;
}

void ANuhoudTaskDirector::EvaluateEat()
{
	const FVector Mouth = GetMouthLocation();
	for (ANuhoudDate* Date : Dates)
	{
		if (IsValid(Date) && Date->GetState() == ENuhoudGrabState::Held
			&& Perceived(Date->GetActorLocation(), Mouth) < MouthRadius)
		{
			Date->Eat();
			CompleteTask(FullPoints, TEXT("Bil hana wal shifa! Enjoy your date"));
			return;
		}
	}
}

// ── Guidance ───────────────────────────────────────────────────────────────

FString ANuhoudTaskDirector::GetInstruction() const
{
	if (FeedbackTime > 0.f) return Feedback;
	if (!bTaskActive) return FString();

	switch (Task)
	{
	case ETask::HangLantern:
		if (IsValid(TaskLantern) && TaskLantern->GetState() == ENuhoudGrabState::Held)
		{
			return TEXT("Lift it to the glowing hook, then open your hand");
		}
		return TaskTime > TouchLightingAfterSeconds
			? TEXT("Close your hand around the lantern, or rest your palm on it")
			: TEXT("Grab the lantern and hang it on the glowing hook");
	case ETask::ServeDate:
		return IsAnyDateHeld()
			? TEXT("Put the date on the glowing plate and open your fingers")
			: TEXT("Pinch a date from the bowl to serve your guest");
	case ETask::EatDate:
		return IsAnyDateHeld()
			? TEXT("Bring the date to your mouth")
			: TEXT("Pinch a date from the bowl and eat it");
	}
	return FString();
}
