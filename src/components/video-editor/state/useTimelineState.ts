import { useState } from "react";
import type { SourceAudioTrackSettings } from "../audio/audioTypes";
import type {
	FingerGestureRegion,
	GestureTrackingSettings,
} from "../gestures/gestureTypes";
import { DEFAULT_GESTURE_TRACKING_SETTINGS } from "../gestures/gestureTypes";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../types";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "../types";

export function useTimelineState() {
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [cursorTelemetrySourcePath, setCursorTelemetrySourcePath] = useState<string | null>(null);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
	const [gestureRegions, setGestureRegions] = useState<FingerGestureRegion[]>([]);
	const [selectedGestureId, setSelectedGestureId] = useState<string | null>(null);
	const [gestureSettings, setGestureSettings] = useState<GestureTrackingSettings>(
		DEFAULT_GESTURE_TRACKING_SETTINGS,
	);
	const [sourceAudioTrackSettingsByClip, setSourceAudioTrackSettingsByClip] = useState<
		Record<string, SourceAudioTrackSettings>
	>({});
	const [defaultSourceAudioTrackSettings, setDefaultSourceAudioTrackSettings] =
		useState<SourceAudioTrackSettings>({});
	const [sourceAudioFallbackRefreshKey, setSourceAudioFallbackRefreshKey] = useState(0);
	const [hasClipSourceAudio, setHasClipSourceAudio] = useState(false);
	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);

	const updateGestureRegion = (id: string, patch: Partial<FingerGestureRegion>) => {
		setGestureRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, ...patch } : region)),
		);
	};

	const removeGestureRegion = (id: string) => {
		setGestureRegions((prev) => prev.filter((region) => region.id !== id));
		setSelectedGestureId((prev) => (prev === id ? null : prev));
	};

	return {
		zoomRegions,
		setZoomRegions,
		cursorTelemetry,
		setCursorTelemetry,
		cursorTelemetrySourcePath,
		setCursorTelemetrySourcePath,
		selectedZoomId,
		setSelectedZoomId,
		trimRegions,
		setTrimRegions,
		clipRegions,
		setClipRegions,
		selectedClipId,
		setSelectedClipId,
		speedRegions,
		setSpeedRegions,
		annotationRegions,
		setAnnotationRegions,
		selectedAnnotationId,
		setSelectedAnnotationId,
		audioRegions,
		setAudioRegions,
		selectedAudioId,
		setSelectedAudioId,
		selectedCaptionId,
		setSelectedCaptionId,
		gestureRegions,
		setGestureRegions,
		updateGestureRegion,
		removeGestureRegion,
		selectedGestureId,
		setSelectedGestureId,
		gestureSettings,
		setGestureSettings,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
		sourceAudioFallbackRefreshKey,
		setSourceAudioFallbackRefreshKey,
		hasClipSourceAudio,
		setHasClipSourceAudio,
		autoCaptions,
		setAutoCaptions,
		autoCaptionSettings,
		setAutoCaptionSettings,
	};
}
