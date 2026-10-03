import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
import {
	CAPTION_FONT_WEIGHT,
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "@/components/video-editor/captionStyle";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	getDefaultCaptionFontFamily,
} from "@/components/video-editor/types";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";

/** Draw the active caption using the exact same typography, shapes, and timing as preview. */
export function renderCaptions(
	ctx: CanvasRenderingContext2D,
	cues: CaptionCue[],
	settings: AutoCaptionSettings,
	width: number,
	height: number,
	timeMs: number,
) {
	if (!settings.enabled || cues.length === 0) {
		return;
	}

	ctx.save();

	const fontSize = getCaptionScaledFontSize(settings.fontSize, width, settings.maxWidth);
	const fontWeight = settings.fontWeight ?? CAPTION_FONT_WEIGHT;
	const fontStyle = settings.fontStyle ?? "normal";
	const fontFamily = settings.fontFamily || getDefaultCaptionFontFamily();
	ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
	if (settings.letterSpacing !== undefined && "letterSpacing" in ctx) {
		(ctx as unknown as { letterSpacing: string }).letterSpacing = `${settings.letterSpacing}px`;
	}

	const padding = getCaptionPadding(fontSize, settings.paddingX, settings.paddingY);

	const activeCaptionLayout = buildActiveCaptionLayout({
		cues,
		timeMs,
		settings,
		maxWidthPx: getCaptionTextMaxWidth(width, settings.maxWidth, fontSize, settings.paddingX),
		measureText: (text) => ctx.measureText(text).width,
	});
	if (!activeCaptionLayout) {
		ctx.restore();
		return;
	}

	const lineHeight = fontSize * (settings.lineHeight ?? CAPTION_LINE_HEIGHT);
	const paddingX =
		settings.backgroundStyle === "none" || settings.backgroundStyle === "wordBadge"
			? 8
			: padding.x;
	const paddingY =
		settings.backgroundStyle === "none" || settings.backgroundStyle === "wordBadge"
			? 4
			: padding.y;
	const textBlockHeight = activeCaptionLayout.visibleLines.length * lineHeight;
	const boxHeight = textBlockHeight + paddingY * 2;

	const maxMeasuredWidth = activeCaptionLayout.visibleLines.reduce(
		(largest, line) => Math.max(largest, line.width),
		0,
	);
	const boxWidth =
		settings.backgroundStyle === "fullWidth"
			? width
			: Math.min(
					width * (settings.maxWidth / 100) + paddingX * 2,
					maxMeasuredWidth + paddingX * 2,
				);

	const sideMargin = Math.max(24, width * 0.04);
	const centerX =
		settings.alignment === "left"
			? sideMargin + boxWidth / 2
			: settings.alignment === "right"
				? width - sideMargin - boxWidth / 2
				: width / 2;
	const centerY =
		settings.verticalPosition === "top"
			? (height * (settings.bottomOffset || 10)) / 100 + boxHeight / 2
			: settings.verticalPosition === "middle"
				? height / 2
				: height - (height * settings.bottomOffset) / 100 - boxHeight / 2;

	ctx.translate(centerX, centerY + activeCaptionLayout.translateY);
	ctx.scale(activeCaptionLayout.scale, activeCaptionLayout.scale);
	ctx.globalAlpha = activeCaptionLayout.opacity * (settings.textOpacity ?? 1);

	// Render background if not none / wordBadge
	if (
		settings.backgroundStyle !== "none" &&
		settings.backgroundStyle !== "wordBadge"
	) {
		ctx.save();
		if (settings.backgroundStyle === "transparent") {
			ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
		} else if (settings.backgroundColor) {
			const opacity = settings.backgroundOpacity ?? 0.9;
			ctx.fillStyle = settings.backgroundColor;
			ctx.globalAlpha = ctx.globalAlpha * opacity;
		} else {
			ctx.fillStyle = `rgba(0, 0, 0, ${settings.backgroundOpacity ?? 0.9})`;
		}

		const radius =
			settings.backgroundStyle === "pill"
				? boxHeight / 2
				: settings.backgroundStyle === "fullWidth" ||
				    settings.backgroundStyle === "box"
					? 0
					: getCaptionScaledRadius(settings.boxRadius ?? 16, fontSize);

		drawSquircleOnCanvas(ctx, {
			x: -boxWidth / 2,
			y: -boxHeight / 2,
			width: boxWidth,
			height: boxHeight,
			radius,
		});
		ctx.fill();
		ctx.restore();
	}

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";

	activeCaptionLayout.visibleLines.forEach((line, lineIndex) => {
		let cursorX =
			settings.alignment === "left"
				? -boxWidth / 2 + paddingX
				: settings.alignment === "right"
					? boxWidth / 2 - paddingX - line.width
					: -line.width / 2;
		const lineY = -boxHeight / 2 + paddingY + lineHeight * lineIndex + lineHeight / 2;

		line.words.forEach((word) => {
			let wordText = word.text;
			if (settings.textTransform === "uppercase") {
				wordText = wordText.toUpperCase();
			} else if (settings.textTransform === "lowercase") {
				wordText = wordText.toLowerCase();
			} else if (settings.textTransform === "capitalize" && wordText.length > 0) {
				wordText = wordText.charAt(0).toUpperCase() + wordText.slice(1);
			}

			const segmentText = `${word.leadingSpace ? " " : ""}${wordText}`;
			const segmentWidth = ctx.measureText(segmentText).width;
			const visualState = getCaptionWordVisualState(
				activeCaptionLayout.hasWordTimings,
				word.state,
			);

			const isWordActive = visualState.isActive;
			const wordColor = isWordActive
				? settings.activeWordColor || "#FFE600"
				: visualState.isInactive
					? settings.inactiveTextColor || "#A3A3A3"
					: settings.textColor || "#FFFFFF";

			ctx.save();
			ctx.translate(cursorX, lineY);

			// Word badge background if enabled
			if (settings.backgroundStyle === "wordBadge" && isWordActive) {
				ctx.save();
				ctx.fillStyle = settings.backgroundColor || "#000000";
				const badgeHeight = fontSize * 1.2;
				const badgeWidth = segmentWidth + 12;
				drawSquircleOnCanvas(ctx, {
					x: -6,
					y: -badgeHeight / 2,
					width: badgeWidth,
					height: badgeHeight,
					radius: 8,
				});
				ctx.fill();
				ctx.restore();
			}

			// Text Shadow
			if (
				settings.shadow &&
				(settings.shadow.blur > 0 ||
					settings.shadow.opacity > 0 ||
					(settings.shadow.offsetX ?? 0) !== 0 ||
					(settings.shadow.offsetY ?? 0) !== 0)
			) {
				ctx.shadowColor = settings.shadow.color || "#000000";
				ctx.shadowBlur = settings.shadow.blur ?? 4;
				ctx.shadowOffsetX = settings.shadow.offsetX ?? 0;
				ctx.shadowOffsetY = settings.shadow.offsetY ?? 2;
			}

			// Stroke outline
			if (settings.stroke && settings.stroke.width > 0) {
				ctx.strokeStyle = settings.stroke.color || "#000000";
				ctx.lineWidth = settings.stroke.width * 2;
				ctx.lineJoin = "round";
				ctx.strokeText(segmentText, 0, 0);
			}

			ctx.fillStyle = wordColor;
			ctx.globalAlpha =
				activeCaptionLayout.opacity *
				(settings.textOpacity ?? 1) *
				visualState.opacity;
			ctx.fillText(segmentText, 0, 0);

			if (settings.textDecoration === "underline") {
				ctx.fillRect(0, fontSize * 0.45, segmentWidth, Math.max(1, fontSize * 0.08));
			}

			ctx.restore();

			cursorX += segmentWidth;
		});
	});

	ctx.restore();
}
