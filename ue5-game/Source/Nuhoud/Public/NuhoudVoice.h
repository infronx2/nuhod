#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudVoice.generated.h"

class USoundWaveProcedural;
class UAudioComponent;

/**
 * Mu'in's voice in the majlis: short recorded Arabic lines played on session events.
 *
 * Lines are plain WAV files (16-bit PCM, mono or stereo) in Content/Nuhoud/Voice, named
 * <event>_<n>.wav (e.g. task_done_3.wav); tools/voice/make_voice.py generates them from
 * lines.json. Each Say picks one of the event's files at random, avoiding the one played last.
 * An event without files is silent, so the game runs the same before the voice is generated.
 */
UCLASS()
class NUHOUD_API ANuhoudVoice : public AActor
{
	GENERATED_BODY()

public:
	ANuhoudVoice();

	/** Event names: session_start, task_lantern, task_serve, task_eat, task_done, task_done_fast, task_assisted, task_fail, encourage, goal_reached, pain_stop, session_end. */
	void Say(const FString& Event, bool bInterrupt = false);

	bool IsSpeaking() const;

	/** Seconds since the last line ended (large if nothing played yet). */
	float SecondsSinceLastLine() const;

protected:
	virtual void BeginPlay() override;

private:
	void ScanLines();
	USoundWaveProcedural* LoadWav(const FString& Path) const;

	/** Event name to the WAV files for it. */
	TMap<FString, TArray<FString>> Lines;
	TMap<FString, int32> LastPicked;

	UPROPERTY()
	UAudioComponent* Audio;

	/** Keeps the playing wave alive. */
	UPROPERTY()
	USoundWaveProcedural* CurrentWave;

	double LineEndsAt = -1000.0;
	bool bDisabled = false;
};
