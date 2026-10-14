#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudRiggedHand.h"
#include "NuhoudGrabbable.h"
#include "NuhoudTaskDirector.generated.h"

class ANuhoudMajlis;
class ANuhoudFirstPersonPawn;
class ANuhoudInputAdapter;
class ANuhoudLantern;
class ANuhoudTargetMarker;

/**
 * Runs the majlis hospitality session: hang a lantern on a hook (reach, grasp, lift, release),
 * serve a date on a guest plate (pinch, carry, release) and eat a date (hand to mouth).
 */
UCLASS()
class NUHOUD_API ANuhoudTaskDirector : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudTaskDirector();
	virtual void Tick(float DeltaTime) override;

	/** Places the dates, cups, dallah and the first ceiling lanterns. */
	void Setup(ANuhoudMajlis* InMajlis, ANuhoudFirstPersonPawn* InPawn);

	void StartSession(ANuhoudInputAdapter* InInputAdapter);

	/** Stops giving tasks once the session is over (finished or pain stop). */
	void EndSession();

	/** Short guidance line for the patient. */
	FString GetInstruction() const;

private:
	enum class ETask : uint8 { HangLantern, ServeDate, EatDate };

	void StartNextTask();
	void ClearTaskObjects();
	void CompleteTask(int32 Points, const FString& Message);
	void FailTask();

	void EvaluateLantern(float DeltaTime);
	void EvaluateServe(float DeltaTime);
	void EvaluateEat(float DeltaTime);
	void HangLanternOnHook(bool bAssisted);
	void ServeDate(ANuhoudGrabbable* Date, bool bAssisted);

	/** Only this task's objects can be picked up; anything else still in a hand goes back to its place. */
	void AllowOnlyTaskObjects();

	/**
	 * Targets grow slowly once a task has run a while, so every task stays reachable on a bad
	 * tracking day. A task finished only thanks to the larger target counts as assisted.
	 */
	float AssistScale() const;

	/** True every couple of seconds, for the task progress lines in the log. */
	bool ProgressLogDue(float DeltaTime);

	void OnLanternReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip);
	void OnLanternTouchLit(ANuhoudLantern* Lantern);
	void OnDateReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip);

	FVector ChooseHookLocation(ENuhoudHandSide Side) const;
	FVector GetMouthLocation() const;
	float Perceived(const FVector& A, const FVector& B) const;

	/** On-screen distance from the date to the plate centre, or a huge value outside the height band. */
	float PlateDistance(const AActor* Date, float MaxHeight) const;
	bool IsAnyDateHeld() const;
	void HangDecoration(ANuhoudLantern* Lantern, bool bInstant);
	void AfterDelay(float Seconds, TFunction<void()> Action);

	UPROPERTY()
	ANuhoudMajlis* Majlis;

	UPROPERTY()
	ANuhoudFirstPersonPawn* PatientPawn;

	UPROPERTY()
	ANuhoudInputAdapter* InputAdapter;

	UPROPERTY()
	TArray<ANuhoudDate*> Dates;

	UPROPERTY()
	TArray<ANuhoudGrabbable*> Props;

	UPROPERTY()
	TArray<ANuhoudLantern*> HangingLanterns;

	UPROPERTY()
	ANuhoudLantern* TaskLantern;

	UPROPERTY()
	ANuhoudTargetMarker* TaskMarker;

	ETask Task;
	ENuhoudHandSide TaskSide;
	int32 TaskCount;
	bool bTaskActive;
	bool bSessionOver;
	/** Seconds of the current task with a hand in view: the clock waits while the camera sees no hand. */
	float TaskTime;
	float OnTargetTime;
	float ProgressLogTimer;

	/** 0 = hooks close and low, 1 = near full reach and overhead. */
	float Difficulty;
	int32 NextSlot;

	FString Feedback;
	float FeedbackTime;
	FTimerHandle NextTaskTimer;
};
