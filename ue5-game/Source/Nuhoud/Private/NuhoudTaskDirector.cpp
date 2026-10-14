#include "NuhoudTaskDirector.h"
#include "NuhoudLantern.h"
#include "NuhoudTargetMarker.h"
#include "NuhoudMajlis.h"
#include "NuhoudFirstPersonPawn.h"
#include "NuhoudInputAdapter.h"
#include "NuhoudGameInstance.h"
#include "NuhoudPlayerController.h"
#include "Engine/World.h"
#include "TimerManager.h"

namespace
{
	constexpr int32 InitialLanterns = 2;
	constexpr int32 FullPoints = 100;
	constexpr int32 AssistedPoints = 50;
	constexpr float TaskTimeoutSeconds[] = { 45.f, 60.f, 60.f };
	constexpr float TouchLightingAfterSeconds = 10.f;
	constexpr float HoldOnTargetSeconds = 0.6f;
	// Radii are on-screen distances (see ANuhoudFirstPersonPawn::PerceivedDistance). Sized from the
	// 2026-10-14 real-camera session, where dates were carried for 6-13 s without ever meeting the
	// old 10 cm plate radius and 12 cm height band.
	constexpr float HookCatchRadius = 16.f;
	constexpr float HookReleaseRadius = 20.f;
	constexpr float HookMinAboveTable = 30.f;
	constexpr float PlateRadius = 14.f;
	constexpr float PlateReleaseRadius = 18.f;
	constexpr float PlateHeldMaxHeight = 20.f;
	constexpr float PlateBelowTolerance = 6.f;
	constexpr float MouthRadius = 16.f;
	// Targets start growing after AssistAfterSeconds and reach MaxAssistScale AssistRampSeconds later.
	constexpr float AssistAfterSeconds = 15.f;
	constexpr float AssistRampSeconds = 20.f;
	constexpr float MaxAssistScale = 1.8f;
	constexpr float ProgressLogSeconds = 2.f;
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
	ProgressLogTimer = 0.f;
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

	// Tell the patient what today's plan asks for before the first task appears.
	if (const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance()))
	{
		const TCHAR* Hand = GI->PlanLimb == ENuhoudPlanLimb::Right ? TEXT("your right hand")
			: GI->PlanLimb == ENuhoudPlanLimb::Left ? TEXT("your left hand") : TEXT("either hand");
		Feedback = GI->PlanDailyTasks > 0
			? FString::Printf(TEXT("Today: %d tasks with %s"), GI->PlanDailyTasks, Hand)
			: FString::Printf(TEXT("Today: as many tasks as you like, with %s"), Hand);
		FeedbackTime = 4.f;
	}
	GetWorldTimerManager().SetTimer(NextTaskTimer, this, &ANuhoudTaskDirector::StartNextTask, 4.f, false);
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

void ANuhoudTaskDirector::AllowOnlyTaskObjects()
{
	const bool bDateTask = Task != ETask::HangLantern;
	auto Allow = [](ANuhoudGrabbable* Object, bool bAllowed)
	{
		if (!IsValid(Object)) return;
		Object->SetGrabEnabled(bAllowed);
		if (!bAllowed && Object->GetState() == ENuhoudGrabState::Held)
		{
			// Frees the hand for the new task (the 2026-10-14 session held a cup through a whole lantern task).
			Object->ReturnHome();
		}
	};
	for (ANuhoudDate* Date : Dates) Allow(Date, bDateTask);
	for (ANuhoudGrabbable* Prop : Props) Allow(Prop, false);
	Allow(TaskLantern, true);
}

float ANuhoudTaskDirector::AssistScale() const
{
	const float Ramp = FMath::Clamp((TaskTime - AssistAfterSeconds) / AssistRampSeconds, 0.f, 1.f);
	return 1.f + Ramp * (MaxAssistScale - 1.f);
}

bool ANuhoudTaskDirector::ProgressLogDue(float DeltaTime)
{
	ProgressLogTimer += DeltaTime;
	if (ProgressLogTimer < ProgressLogSeconds) return false;
	ProgressLogTimer = 0.f;
	return true;
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

	// The plan's hand gets every task; a plan for both hands alternates them.
	const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const ENuhoudPlanLimb Limb = GI ? GI->PlanLimb : ENuhoudPlanLimb::Both;
	Task = static_cast<ETask>(TaskCount % 3);
	TaskSide = Limb == ENuhoudPlanLimb::Right ? ENuhoudHandSide::Right
		: Limb == ENuhoudPlanLimb::Left ? ENuhoudHandSide::Left
		: (TaskCount % 2 == 0 ? ENuhoudHandSide::Right : ENuhoudHandSide::Left);
	TaskCount++;
	TaskTime = 0.f;
	OnTargetTime = 0.f;
	ProgressLogTimer = 0.f;
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
	AllowOnlyTaskObjects();
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

	// The doctor's daily goal ends the session: saved and sent like a finish with Esc.
	const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	if (GI && GI->PlanDailyTasks > 0 && GI->SessionReps >= GI->PlanDailyTasks)
	{
		Feedback = FString::Printf(TEXT("Today's goal is done: %d tasks. Well done!"), GI->SessionReps);
		FeedbackTime = 6.f;
		UE_LOG(LogTemp, Log, TEXT("Nuhoud: daily goal of %d tasks reached, finishing the session"), GI->PlanDailyTasks);
		AfterDelay(3.f, [this]()
		{
			if (ANuhoudPlayerController* PC = Cast<ANuhoudPlayerController>(GetWorld()->GetFirstPlayerController()))
			{
				PC->FinishSession();
			}
		});
		return;
	}
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

	// The clock only runs while the camera sees a hand: in the 2026-10-14 session the first task
	// timed out while the patient was still settling in front of the camera.
	if (!InputAdapter->IsHandVisible(ENuhoudHandSide::Right) && !InputAdapter->IsHandVisible(ENuhoudHandSide::Left))
	{
		return;
	}

	TaskTime += DeltaTime;
	switch (Task)
	{
	case ETask::HangLantern: EvaluateLantern(DeltaTime); break;
	case ETask::ServeDate: EvaluateServe(DeltaTime); break;
	case ETask::EatDate: EvaluateEat(DeltaTime); break;
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

	// Palm to the lantern's surface: the old centre point needed the palm inside the lantern.
	TArray<FVector> Palms;
	InputAdapter->GetInteractionPoints(Palms);
	float NearestPalm = TNumericLimits<float>::Max();
	for (const FVector& Palm : Palms)
	{
		NearestPalm = FMath::Min(NearestPalm, Perceived(Palm, TaskLantern->ClosestSurfacePoint(Palm)));
	}
	TaskLantern->SetTouchLighting(TaskTime > TouchLightingAfterSeconds, NearestPalm);

	// Holding it steady at the hook also counts, for patients who cannot open the hand yet.
	const bool bHeld = TaskLantern->GetState() == ENuhoudGrabState::Held;
	const float HookDistance = Perceived(TaskLantern->GetGrabAnchor(), TaskMarker->GetActorLocation());
	const bool bHeldAtHook = bHeld && HookDistance < HookCatchRadius * AssistScale();
	OnTargetTime = bHeldAtHook ? OnTargetTime + DeltaTime : 0.f;
	TaskMarker->SetProgress(OnTargetTime / HoldOnTargetSeconds);

	if (ProgressLogDue(DeltaTime))
	{
		if (bHeld)
		{
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d lantern held, %.0fcm from the hook (counts under %.0f)"),
				TaskCount, HookDistance, HookCatchRadius * AssistScale());
		}
		else
		{
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d lantern not held, nearest palm %.0fcm from it (touch lights it under %.0f after %.0fs)"),
				TaskCount, NearestPalm, TaskLantern->TouchRadius, TouchLightingAfterSeconds);
		}
	}

	if (OnTargetTime > HoldOnTargetSeconds)
	{
		HangLanternOnHook(HookDistance >= HookCatchRadius);
	}
}

void ANuhoudTaskDirector::OnLanternReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip)
{
	if (!bTaskActive || Task != ETask::HangLantern || Grabbable != TaskLantern || !IsValid(TaskMarker)) return;

	const float HookDistance = Perceived(Grabbable->GetGrabAnchor(), TaskMarker->GetActorLocation());
	if (HookDistance < HookReleaseRadius * AssistScale())
	{
		HangLanternOnHook(HookDistance >= HookReleaseRadius);
	}
}

void ANuhoudTaskDirector::HangLanternOnHook(bool bAssisted)
{
	ANuhoudLantern* Lantern = TaskLantern;
	ANuhoudTargetMarker* Marker = TaskMarker;
	TaskLantern = nullptr;
	TaskMarker = nullptr;

	const FRotator Upright(0.f, Lantern->GetActorRotation().Yaw, 0.f);
	Lantern->PlaceAt(FTransform(Upright, Marker->GetActorLocation() - Upright.RotateVector(Lantern->GetGrabAnchorLocal())));
	Lantern->LightUp();
	Marker->Celebrate();
	CompleteTask(bAssisted ? AssistedPoints : FullPoints, TEXT("Beautiful! The majlis glows brighter"));

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
	// The doctor's target angle centres the hooks; difficulty moves them from 15 below it to 10 above.
	const UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	const float Target = GI ? GI->PlanTargetAngle : 60.f;
	const float Low = FMath::Clamp(Target - 15.f + 10.f * Difficulty, 20.f, 160.f);
	const float High = FMath::Clamp(Target + 10.f * Difficulty, Low, 165.f);
	const float Elevation = FMath::DegreesToRadians(FMath::FRandRange(Low, High));
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

float ANuhoudTaskDirector::PlateDistance(const AActor* Date, float MaxHeight) const
{
	if (!IsValid(TaskMarker)) return TNumericLimits<float>::Max();
	const FVector Top = TaskMarker->GetPlateTop();
	const FVector P = Date->GetActorLocation();
	const float Height = P.Z - Top.Z;
	if (Height < -PlateBelowTolerance || Height > MaxHeight) return TNumericLimits<float>::Max();
	return Perceived(FVector(P.X, P.Y, Top.Z), Top);
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

	const float Radius = PlateRadius * AssistScale();
	bool bHeldOverPlate = false;
	const ANuhoudDate* HeldDate = nullptr;
	for (ANuhoudDate* Date : Dates)
	{
		if (!IsValid(Date)) continue;
		const ENuhoudGrabState S = Date->GetState();
		if (S == ENuhoudGrabState::Held)
		{
			HeldDate = Date;
			const float Distance = PlateDistance(Date, PlateHeldMaxHeight);
			if (Distance < Radius)
			{
				bHeldOverPlate = true;
				if (OnTargetTime + DeltaTime > HoldOnTargetSeconds)
				{
					ServeDate(Date, Distance >= PlateRadius);
					return;
				}
			}
		}
		else if (S == ENuhoudGrabState::Free && Date->GetVelocity().Size() < 15.f)
		{
			// Dropped and came to rest on the plate.
			const float Distance = PlateDistance(Date, 4.f);
			if (Distance < Radius)
			{
				ServeDate(Date, Distance >= PlateRadius);
				return;
			}
		}
	}
	OnTargetTime = bHeldOverPlate ? OnTargetTime + DeltaTime : 0.f;
	TaskMarker->SetProgress(OnTargetTime / HoldOnTargetSeconds);

	if (ProgressLogDue(DeltaTime))
	{
		if (HeldDate)
		{
			const FVector Top = TaskMarker->GetPlateTop();
			const FVector P = HeldDate->GetActorLocation();
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d date held %.0fcm from the plate, %.0fcm above it (counts under %.0f, %.0f..%.0f above)"),
				TaskCount, Perceived(FVector(P.X, P.Y, Top.Z), Top), P.Z - Top.Z, Radius, -PlateBelowTolerance, PlateHeldMaxHeight);
		}
		else
		{
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d no date held yet"), TaskCount);
		}
	}
}

void ANuhoudTaskDirector::OnDateReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip)
{
	if (!bTaskActive || Task != ETask::ServeDate) return;

	const float Distance = PlateDistance(Grabbable, 20.f);
	if (Distance < PlateReleaseRadius * AssistScale())
	{
		ServeDate(Grabbable, Distance >= PlateReleaseRadius);
	}
}

void ANuhoudTaskDirector::ServeDate(ANuhoudGrabbable* Date, bool bAssisted)
{
	ANuhoudTargetMarker* Marker = TaskMarker;
	TaskMarker = nullptr;

	Date->PlaceAt(FTransform(Date->GetActorRotation(), Marker->GetPlateTop() + FVector(0.f, 0.f, Date->GetRestHeight())));
	Marker->Celebrate();
	CompleteTask(bAssisted ? AssistedPoints : FullPoints, TEXT("Thank you! Your guest is served"));

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

void ANuhoudTaskDirector::EvaluateEat(float DeltaTime)
{
	const FVector Mouth = GetMouthLocation();
	float Nearest = TNumericLimits<float>::Max();
	for (ANuhoudDate* Date : Dates)
	{
		if (!IsValid(Date) || Date->GetState() != ENuhoudGrabState::Held) continue;
		const float Distance = Perceived(Date->GetActorLocation(), Mouth);
		Nearest = FMath::Min(Nearest, Distance);
		if (Distance < MouthRadius * AssistScale())
		{
			Date->Eat();
			CompleteTask(Distance >= MouthRadius ? AssistedPoints : FullPoints, TEXT("Bil hana wal shifa! Enjoy your date"));
			return;
		}
	}

	if (ProgressLogDue(DeltaTime))
	{
		if (Nearest < TNumericLimits<float>::Max())
		{
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d date held %.0fcm from the mouth (counts under %.0f)"),
				TaskCount, Nearest, MouthRadius * AssistScale());
		}
		else
		{
			UE_LOG(LogTemp, Log, TEXT("Nuhoud: task %d no date held yet"), TaskCount);
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
