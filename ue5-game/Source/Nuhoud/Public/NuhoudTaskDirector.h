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
	void EvaluateEat();
	void HangLanternOnHook();
	void ServeDate(ANuhoudGrabbable* Date);

	void OnLanternReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip);
	void OnLanternTouchLit(ANuhoudLantern* Lantern);
	void OnDateReleased(ANuhoudGrabbable* Grabbable, ENuhoudGrip Grip);

	FVector ChooseHookLocation(ENuhoudHandSide Side) const;
	FVector GetMouthLocation() const;
	float Perceived(const FVector& A, const FVector& B) const;
	bool IsOverPlate(const AActor* Date, float Radius, float MaxHeight) const;
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
	float TaskTime;
	float OnTargetTime;

	/** 0 = hooks close and low, 1 = near full reach and overhead. */
	float Difficulty;
	int32 NextSlot;

	FString Feedback;
	float FeedbackTime;
	FTimerHandle NextTaskTimer;
};
