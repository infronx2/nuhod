// ============================================================================
// NuhoudAudioManager.h
// ============================================================================
// A singleton-style actor that manages all game audio:
//   - Spatial 3D sounds for target hits, compensation errors, level-ups.
//   - Ambient background music whose tempo scales with the dynamic level.
//   - Spawns at the player's location for correct 3D positioning.
//
// Blueprint hookup:
//   Create a Blueprint child of this actor and assign the SoundCue assets
//   in the defaults panel. The GameMode spawns an instance at BeginPlay
//   and calls the Play* methods via delegates.
// ============================================================================

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "NuhoudAudioManager.generated.h"

class UAudioComponent;
class USoundBase;

// ---------------------------------------------------------------------------
// Audio Manager
// ---------------------------------------------------------------------------

UCLASS(Blueprintable, BlueprintType)
class NUHOUD_API ANuhoudAudioManager : public AActor
{
    GENERATED_BODY()

public:
    ANuhoudAudioManager();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaSeconds) override;

    // -----------------------------------------------------------------------
    // One-shot spatial sounds (3D positioned at the target/player)
    // -----------------------------------------------------------------------

    /**
     * Play the "success hit" sound — a soft chime / coin ping.
     * Called when a target is hit cleanly (no compensation).
     * @param Location  World position to play the sound at (the target's location).
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void PlaySuccessHit(FVector Location);

    /**
     * Play a mild error buzz — not too harsh to avoid frustration.
     * Called when compensation is detected.
     * @param Location  World position (usually the player's head).
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void PlayCompensationError(FVector Location);

    /**
     * Play a pleasant "level up" fanfare — a short ascending chime.
     * Called when the dynamic difficulty increases.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void PlayLevelUp();

    /**
     * Play a gentle "session complete" melody.
     * Called when EndSession() fires.
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void PlaySessionComplete();

    // -----------------------------------------------------------------------
    // Ambient background music
    // -----------------------------------------------------------------------

    /** Start the ambient background music loop. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void StartAmbientMusic();

    /** Stop the ambient background music. */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void StopAmbientMusic();

    /**
     * Adjust the ambient music tempo based on the current difficulty level.
     * Level 1 = calm (0.8x speed), Level 5 = energetic (1.5x speed).
     *
     * @param Level  0-4 (Level1=0, Level5=4)
     */
    UFUNCTION(BlueprintCallable, Category = "Nuhoud|Audio")
    void SetAmbientTempo(int32 LevelIndex);

    // -----------------------------------------------------------------------
    // Config — assign these in the Blueprint defaults
    // -----------------------------------------------------------------------

    /** The success hit sound (soft chime / coin ping). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Audio|Assets")
    USoundBase* SuccessHitSound;

    /** The compensation error sound (mild buzz — not harsh). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Audio|Assets")
    USoundBase* CompensationErrorSound;

    /** The level-up fanfare (short ascending chime). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Audio|Assets")
    USoundBase* LevelUpSound;

    /** The session-complete melody. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Audio|Assets")
    USoundBase* SessionCompleteSound;

    /** The ambient background music loop (SoundCue with loop). */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Nuhoud|Audio|Assets")
    USoundBase* AmbientMusic;

protected:
    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /** The ambient music audio component (for continuous playback + tempo control). */
    UPROPERTY()
    UAudioComponent* AmbientAudioComp;

    /** Current tempo multiplier (0.8 to 1.5). */
    float CurrentTempo = 1.0f;

    /** Target tempo (interpolated toward). */
    float TargetTempo = 1.0f;

    /** Map difficulty level index (0-4) → tempo multiplier. */
    static constexpr float TempoTable[] = { 0.8f, 0.95f, 1.1f, 1.3f, 1.5f };
};
