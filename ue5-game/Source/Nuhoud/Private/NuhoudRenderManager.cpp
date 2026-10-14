#include "NuhoudRenderManager.h"
#include "RHI.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/World.h"
#include "IHeadMountedDisplay.h"
#include "IXRTrackingSystem.h"
#include "Kismet/GameplayStatics.h"

ANuhoudRenderManager::ANuhoudRenderManager()
{
	PrimaryActorTick.bCanEverTick = true;
	CurrentTier = ENuhoudQualityTier::High;
	bEnableAdaptiveScaling = true;
	CinematicPPV = nullptr;
	FrameTimeAccumulator = 0.f;
	FrameSampleCount = 0;
	TargetFrameTime = 1.f / 60.f;
}

void ANuhoudRenderManager::BeginPlay()
{
	Super::BeginPlay();

	DetectHardwareTier();
	ApplyQualitySettings();
	SpawnCinematicPostProcess();

	UE_LOG(LogTemp, Log, TEXT("Nuhoud RenderManager: Tier=%s"),
		CurrentTier == ENuhoudQualityTier::Ultra ? TEXT("Ultra") :
		CurrentTier == ENuhoudQualityTier::High ? TEXT("High") :
		CurrentTier == ENuhoudQualityTier::Medium ? TEXT("Medium") : TEXT("Low"));
}

void ANuhoudRenderManager::DetectHardwareTier()
{
	bool bHasVR = false;
	if (GEngine && GEngine->XRSystem.IsValid())
	{
		IHeadMountedDisplay* HMD = GEngine->XRSystem->GetHMDDevice();
		bHasVR = HMD && HMD->IsHMDConnected();
	}

	// Check GPU capability via RHI name
	FString RHIName = GDynamicRHI ? GDynamicRHI->GetName() : TEXT("Unknown");
	bool bHasRayTracing = RHIName.Contains(TEXT("D3D12"));

	if (bHasRayTracing && !bHasVR)
	{
		CurrentTier = ENuhoudQualityTier::Ultra;
	}
	else if (bHasVR)
	{
		CurrentTier = ENuhoudQualityTier::Medium;
	}
	else
	{
		CurrentTier = ENuhoudQualityTier::High;
	}
}

void ANuhoudRenderManager::SetQualityTier(ENuhoudQualityTier Tier)
{
	CurrentTier = Tier;
	ApplyQualitySettings();
}

static void SafeSetCVar(const TCHAR* Name, int32 Value)
{
	if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name))
	{
		Var->Set(Value);
	}
}

static void SafeSetCVarFloat(const TCHAR* Name, float Value)
{
	if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name))
	{
		Var->Set(Value);
	}
}

void ANuhoudRenderManager::ApplyQualitySettings()
{
	switch (CurrentTier)
	{
	case ENuhoudQualityTier::Ultra:
		SafeSetCVar(TEXT("r.Lumen.DiffuseIndirectLighting.Enable"), 1);
		SafeSetCVar(TEXT("r.Lumen.Reflections.Enable"), 1);
		SafeSetCVar(TEXT("r.Shadow.Virtual.Enable"), 1);
		SafeSetCVar(TEXT("r.ScreenPercentage"), 100);
		SafeSetCVar(TEXT("r.AntiAliasingMethod"), 4);
		SafeSetCVarFloat(TEXT("r.Tonemapper.Sharpen"), 0.6f);
		UE_LOG(LogTemp, Log, TEXT("Nuhoud Render: Ultra — Lumen + Virtual Shadows + TSR"));
		break;

	case ENuhoudQualityTier::High:
		SafeSetCVar(TEXT("r.Lumen.DiffuseIndirectLighting.Enable"), 1);
		SafeSetCVar(TEXT("r.Lumen.Reflections.Enable"), 1);
		SafeSetCVar(TEXT("r.Shadow.Virtual.Enable"), 1);
		SafeSetCVar(TEXT("r.ScreenPercentage"), 85);
		SafeSetCVar(TEXT("r.AntiAliasingMethod"), 4);
		SafeSetCVarFloat(TEXT("r.Tonemapper.Sharpen"), 0.8f);
		UE_LOG(LogTemp, Log, TEXT("Nuhoud Render: High — Lumen at 85%% scale"));
		break;

	case ENuhoudQualityTier::Medium:
		SafeSetCVar(TEXT("r.Lumen.DiffuseIndirectLighting.Enable"), 0);
		SafeSetCVar(TEXT("r.Lumen.Reflections.Enable"), 0);
		SafeSetCVar(TEXT("r.Shadow.Virtual.Enable"), 0);
		SafeSetCVar(TEXT("r.ScreenPercentage"), 80);
		SafeSetCVar(TEXT("r.AntiAliasingMethod"), 2);
		UE_LOG(LogTemp, Log, TEXT("Nuhoud Render: Medium (VR) — No Lumen, TAA, 80%%"));
		break;

	case ENuhoudQualityTier::Low:
		SafeSetCVar(TEXT("r.Lumen.DiffuseIndirectLighting.Enable"), 0);
		SafeSetCVar(TEXT("r.Lumen.Reflections.Enable"), 0);
		SafeSetCVar(TEXT("r.Shadow.Virtual.Enable"), 0);
		SafeSetCVar(TEXT("r.ScreenPercentage"), 70);
		SafeSetCVar(TEXT("r.AntiAliasingMethod"), 1);
		SafeSetCVar(TEXT("r.MobileHDR"), 1);
		SafeSetCVar(TEXT("r.ForwardShading"), 1);
		UE_LOG(LogTemp, Log, TEXT("Nuhoud Render: Low (Mobile) — Forward Shading, FXAA, 70%%"));
		break;
	}
}

void ANuhoudRenderManager::SpawnCinematicPostProcess()
{
	UWorld* World = GetWorld();
	if (!World) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	CinematicPPV = World->SpawnActor<APostProcessVolume>(
		APostProcessVolume::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator, Params);

	if (!CinematicPPV) return;

	CinematicPPV->bUnbound = true;
	CinematicPPV->Priority = 10.f;

	FPostProcessSettings& S = CinematicPPV->Settings;

	// First-person rehab: the hands and the objects they handle sit 25-60 cm from the eyes and must
	// stay sharp and true to colour, so no depth of field, motion blur, fringing or saturation boost.
	S.bOverride_BloomIntensity = true;
	S.BloomIntensity = 0.5f;
	S.bOverride_BloomThreshold = true;
	S.BloomThreshold = 1.0f;

	S.bOverride_DepthOfFieldFstop = true;
	S.DepthOfFieldFstop = 32.f;
	S.bOverride_DepthOfFieldFocalDistance = true;
	S.DepthOfFieldFocalDistance = 0.f;

	S.bOverride_MotionBlurAmount = true;
	S.MotionBlurAmount = 0.f;

	S.bOverride_VignetteIntensity = true;
	S.VignetteIntensity = 0.25f;

	// Keep exposure steady when the patient's hands or a bright window enter the view.
	S.bOverride_AutoExposureBias = true;
	S.AutoExposureBias = -0.3f;
	S.bOverride_AutoExposureMinBrightness = true;
	S.AutoExposureMinBrightness = 0.6f;
	S.bOverride_AutoExposureMaxBrightness = true;
	S.AutoExposureMaxBrightness = 1.4f;

	// Gentle warm grade, neutral saturation.
	S.bOverride_ColorSaturation = true;
	S.ColorSaturation = FVector4(0.95f, 0.95f, 0.95f, 1.f);
	S.bOverride_ColorGain = true;
	S.ColorGain = FVector4(1.03f, 1.0f, 0.96f, 1.f);

	S.bOverride_SceneFringeIntensity = true;
	S.SceneFringeIntensity = 0.f;
}

void ANuhoudRenderManager::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	if (!bEnableAdaptiveScaling) return;

	MonitorPerformance();
}

void ANuhoudRenderManager::MonitorPerformance()
{
	// Lowering the resolution only helps when the GPU is the bottleneck. When the CPU is busy
	// (pose tracking runs on it) a lower resolution just blurs the hands without any speed-up.
	FrameTimeAccumulator += FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles());
	FrameSampleCount++;

	if (FrameSampleCount < 60) return;

	const float AvgGpuMs = FrameTimeAccumulator / FrameSampleCount;
	FrameTimeAccumulator = 0.f;
	FrameSampleCount = 0;

	IConsoleVariable* ScreenPct = IConsoleManager::Get().FindConsoleVariable(TEXT("r.ScreenPercentage"));
	if (!ScreenPct) return;

	const int32 Current = ScreenPct->GetInt();
	if (AvgGpuMs > 30.f && Current > 85)
	{
		ScreenPct->Set(Current - 5);
		UE_LOG(LogTemp, Warning, TEXT("Nuhoud Render: GPU %.1f ms — scaling down to %d%%"), AvgGpuMs, Current - 5);
	}
	else if (AvgGpuMs < 22.f && Current < 100)
	{
		ScreenPct->Set(Current + 5);
	}
}
