using UnrealBuildTool;

public class Nuhoud : ModuleRules
{
	public Nuhoud(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"WebSockets",
			"HTTP",
			"Json",
			"JsonUtilities",
			"UMG",
			"Niagara",
			"RenderCore",
			"RHI",
			"HeadMountedDisplay",
			"PhysicsCore",
			"ProceduralMeshComponent"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Slate",
			"SlateCore",
			"XRBase"
		});
	}
}
