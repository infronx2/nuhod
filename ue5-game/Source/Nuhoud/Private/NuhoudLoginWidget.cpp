#include "NuhoudLoginWidget.h"
#include "NuhoudGameInstance.h"
#include "HttpModule.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/Spacer.h"
#include "Components/Border.h"
#include "Blueprint/WidgetTree.h"
#include "HAL/PlatformMisc.h"
#include "Misc/CommandLine.h"

namespace
{
	constexpr float LoginTimeoutSeconds = 20.f;
}

void UNuhoudLoginWidget::NativeOnInitialized()
{
	Super::NativeOnInitialized();
	bRequestInFlight = false;

	// Build the UI programmatically since we have no UMG blueprint
	UCanvasPanel* Canvas = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("RootCanvas"));
	WidgetTree->RootWidget = Canvas;

	// Dark background
	UBorder* BG = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("BG"));
	BG->SetBrushColor(FLinearColor(0.02f, 0.06f, 0.1f, 0.95f));
	UCanvasPanelSlot* BGSlot = Canvas->AddChildToCanvas(BG);
	BGSlot->SetAnchors(FAnchors(0, 0, 1, 1));
	BGSlot->SetOffsets(FMargin(0));

	// Center card
	UBorder* Card = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Card"));
	Card->SetBrushColor(FLinearColor(0.04f, 0.1f, 0.15f, 1.f));
	UCanvasPanelSlot* CardSlot = Canvas->AddChildToCanvas(Card);
	CardSlot->SetAnchors(FAnchors(0.5f, 0.5f, 0.5f, 0.5f));
	CardSlot->SetAlignment(FVector2D(0.5f, 0.5f));
	CardSlot->SetSize(FVector2D(420, 380));

	UVerticalBox* VBox = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("VBox"));
	Card->SetContent(VBox);
	Card->SetPadding(FMargin(40, 30, 40, 30));

	// Title
	TitleLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("TitleLabel"));
	TitleLabel->SetText(FText::FromString(TEXT("NUHOUD")));
	FSlateFontInfo TitleFont = TitleLabel->GetFont();
	TitleFont.Size = 32;
	TitleLabel->SetFont(TitleFont);
	TitleLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.05f, 0.7f, 0.6f)));
	TitleLabel->SetJustification(ETextJustify::Center);
	auto* TitleSlot = VBox->AddChildToVerticalBox(TitleLabel);
	TitleSlot->SetHorizontalAlignment(HAlign_Center);
	TitleSlot->SetPadding(FMargin(0, 0, 0, 5));

	// Subtitle
	UTextBlock* Subtitle = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("Subtitle"));
	Subtitle->SetText(FText::FromString(TEXT("Rehabilitation Therapy")));
	FSlateFontInfo SubFont = Subtitle->GetFont();
	SubFont.Size = 12;
	Subtitle->SetFont(SubFont);
	Subtitle->SetColorAndOpacity(FSlateColor(FLinearColor(0.5f, 0.55f, 0.6f)));
	Subtitle->SetJustification(ETextJustify::Center);
	auto* SubSlot = VBox->AddChildToVerticalBox(Subtitle);
	SubSlot->SetHorizontalAlignment(HAlign_Center);
	SubSlot->SetPadding(FMargin(0, 0, 0, 25));

	// Email label
	UTextBlock* EmailLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("EmailLabel"));
	EmailLabel->SetText(FText::FromString(TEXT("Email")));
	FSlateFontInfo LabelFont = EmailLabel->GetFont();
	LabelFont.Size = 11;
	EmailLabel->SetFont(LabelFont);
	EmailLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.6f, 0.65f, 0.7f)));
	auto* ELSlot = VBox->AddChildToVerticalBox(EmailLabel);
	ELSlot->SetPadding(FMargin(0, 0, 0, 4));

	// Email input
	EmailInput = WidgetTree->ConstructWidget<UEditableTextBox>(UEditableTextBox::StaticClass(), TEXT("EmailInput"));
	EmailInput->SetHintText(FText::FromString(TEXT("patient@nuhoud.health")));
	auto* EISlot = VBox->AddChildToVerticalBox(EmailInput);
	EISlot->SetPadding(FMargin(0, 0, 0, 12));

	// Password label
	UTextBlock* PwLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("PwLabel"));
	PwLabel->SetText(FText::FromString(TEXT("Password")));
	PwLabel->SetFont(LabelFont);
	PwLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.6f, 0.65f, 0.7f)));
	auto* PLSlot = VBox->AddChildToVerticalBox(PwLabel);
	PLSlot->SetPadding(FMargin(0, 0, 0, 4));

	// Password input
	PasswordInput = WidgetTree->ConstructWidget<UEditableTextBox>(UEditableTextBox::StaticClass(), TEXT("PasswordInput"));
	PasswordInput->SetHintText(FText::FromString(TEXT("Enter password")));
	PasswordInput->SetIsPassword(true);
	auto* PISlot = VBox->AddChildToVerticalBox(PasswordInput);
	PISlot->SetPadding(FMargin(0, 0, 0, 20));

	// Login button
	LoginButton = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), TEXT("LoginButton"));
	FButtonStyle BtnStyle = LoginButton->GetStyle();
	FSlateBrush NormalBrush;
	NormalBrush.TintColor = FSlateColor(FLinearColor(0.04f, 0.5f, 0.4f));
	BtnStyle.SetNormal(NormalBrush);
	FSlateBrush HoverBrush;
	HoverBrush.TintColor = FSlateColor(FLinearColor(0.06f, 0.6f, 0.5f));
	BtnStyle.SetHovered(HoverBrush);
	FSlateBrush PressedBrush;
	PressedBrush.TintColor = FSlateColor(FLinearColor(0.03f, 0.4f, 0.3f));
	BtnStyle.SetPressed(PressedBrush);
	LoginButton->SetStyle(BtnStyle);

	UTextBlock* BtnText = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("BtnText"));
	BtnText->SetText(FText::FromString(TEXT("Sign In")));
	FSlateFontInfo BtnFont = BtnText->GetFont();
	BtnFont.Size = 16;
	BtnText->SetFont(BtnFont);
	BtnText->SetColorAndOpacity(FSlateColor(FLinearColor::White));
	BtnText->SetJustification(ETextJustify::Center);
	LoginButton->AddChild(BtnText);

	auto* BtnSlot = VBox->AddChildToVerticalBox(LoginButton);
	BtnSlot->SetPadding(FMargin(0, 0, 0, 12));

	LoginButton->OnClicked.AddDynamic(this, &UNuhoudLoginWidget::OnLoginClicked);

	// Status label
	StatusLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("StatusLabel"));
	StatusLabel->SetText(FText::GetEmpty());
	FSlateFontInfo StatusFont = StatusLabel->GetFont();
	StatusFont.Size = 11;
	StatusLabel->SetFont(StatusFont);
	StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.9f, 0.3f, 0.2f)));
	StatusLabel->SetJustification(ETextJustify::Center);
	auto* SLSlot = VBox->AddChildToVerticalBox(StatusLabel);
	SLSlot->SetHorizontalAlignment(HAlign_Center);
}

void UNuhoudLoginWidget::NativeConstruct()
{
	Super::NativeConstruct();

#if !UE_BUILD_SHIPPING
	// QA: -NuhoudAutoLogin=<email> signs in with the password from NUHOUD_AUTOLOGIN_PASSWORD,
	// through the same request a patient's click sends.
	FString Email;
	const FString Password = FPlatformMisc::GetEnvironmentVariable(TEXT("NUHOUD_AUTOLOGIN_PASSWORD"));
	if (FParse::Value(FCommandLine::Get(), TEXT("NuhoudAutoLogin="), Email) && !Password.IsEmpty() && EmailInput && PasswordInput)
	{
		EmailInput->SetText(FText::FromString(Email));
		PasswordInput->SetText(FText::FromString(Password));
		OnLoginClicked();
	}
#endif
}

void UNuhoudLoginWidget::OnLoginClicked()
{
	if (bRequestInFlight) return;

	FString Email = EmailInput ? EmailInput->GetText().ToString().TrimStartAndEnd() : TEXT("");
	FString Password = PasswordInput ? PasswordInput->GetText().ToString() : TEXT("");

	if (Email.IsEmpty() || Password.IsEmpty())
	{
		if (StatusLabel) StatusLabel->SetText(FText::FromString(TEXT("Please enter email and password")));
		return;
	}

	bRequestInFlight = true;
	if (StatusLabel)
	{
		StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.5f, 0.55f, 0.6f)));
		StatusLabel->SetText(FText::FromString(TEXT("Signing in...")));
	}
	if (LoginButton) LoginButton->SetIsEnabled(false);

	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	FString BackendURL = GI ? GI->CloudBackendURL : TEXT("https://nuhod.vercel.app/api/v2");

	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BackendURL / TEXT("auth/login"));
	Request->SetVerb(TEXT("POST"));
	Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Request->SetTimeout(LoginTimeoutSeconds);

	TSharedPtr<FJsonObject> Body = MakeShareable(new FJsonObject());
	Body->SetStringField(TEXT("email"), Email.ToLower());
	Body->SetStringField(TEXT("password"), Password);

	FString BodyString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&BodyString);
	FJsonSerializer::Serialize(Body.ToSharedRef(), Writer);
	Request->SetContentAsString(BodyString);

	Request->OnProcessRequestComplete().BindUObject(this, &UNuhoudLoginWidget::OnLoginResponse);
	Request->ProcessRequest();
}

void UNuhoudLoginWidget::OnLoginResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSuccess)
{
	bRequestInFlight = false;
	if (LoginButton) LoginButton->SetIsEnabled(true);

	if (!bSuccess || !Response.IsValid())
	{
		if (StatusLabel)
		{
			StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.9f, 0.3f, 0.2f)));
			StatusLabel->SetText(FText::FromString(TEXT("Connection failed — check your internet")));
		}
		return;
	}

	int32 Code = Response->GetResponseCode();
	FString ResponseBody = Response->GetContentAsString();

	TSharedPtr<FJsonObject> J;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(ResponseBody);
	if (!FJsonSerializer::Deserialize(Reader, J) || !J.IsValid())
	{
		if (StatusLabel)
		{
			StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.9f, 0.3f, 0.2f)));
			StatusLabel->SetText(FText::FromString(TEXT("Server error — try again")));
		}
		return;
	}

	if (Code != 200 || !J->GetBoolField(TEXT("ok")))
	{
		FString ErrMsg = J->HasField(TEXT("error")) ? J->GetStringField(TEXT("error")) : TEXT("Invalid credentials");
		if (StatusLabel)
		{
			StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.9f, 0.3f, 0.2f)));
			StatusLabel->SetText(FText::FromString(ErrMsg));
		}
		return;
	}

	FString Token = J->GetStringField(TEXT("token"));
	const TSharedPtr<FJsonObject>* UserObj;
	FString PatientId;
	if (J->TryGetObjectField(TEXT("user"), UserObj))
	{
		PatientId = (*UserObj)->GetStringField(TEXT("id"));
	}

	if (Token.IsEmpty() || PatientId.IsEmpty())
	{
		if (StatusLabel)
		{
			StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.9f, 0.3f, 0.2f)));
			StatusLabel->SetText(FText::FromString(TEXT("Invalid server response")));
		}
		return;
	}

	// Store in GameInstance
	UNuhoudGameInstance* GI = Cast<UNuhoudGameInstance>(GetGameInstance());
	if (GI)
	{
		GI->CloudPatientId = PatientId;
		GI->CloudAuthToken = Token;
	}

	if (StatusLabel)
	{
		StatusLabel->SetColorAndOpacity(FSlateColor(FLinearColor(0.1f, 0.9f, 0.5f)));
		FString UserName;
		if (J->TryGetObjectField(TEXT("user"), UserObj))
		{
			UserName = (*UserObj)->GetStringField(TEXT("name"));
		}
		StatusLabel->SetText(FText::FromString(FString::Printf(TEXT("Welcome, %s!"), *UserName)));
	}

	UE_LOG(LogTemp, Log, TEXT("Nuhoud: Login success — Patient: %s"), *PatientId);

	OnLoginSuccess.Broadcast(PatientId, Token);
}
