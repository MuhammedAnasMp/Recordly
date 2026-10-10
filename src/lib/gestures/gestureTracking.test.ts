import { describe, expect, it } from "vitest";
import {
	calculateNormalizedPxPerCm,
	computeFingertipAnchor,
	dist2D,
	LANDMARK,
	type Landmark,
} from "./anchorMath";
import { classifyFingersForHand } from "./fingerClassifier";
import { type FrameFingerDetection, segmentFingerDetections } from "./fingerSegmenter";
import { evaluateGestureObject } from "./gestureMotion";
import { OneEuroFilter2D } from "./oneEuroFilter";

function createMockLandmarks(openFingers: ("index" | "middle" | "ring" | "pinky" | "thumb")[]): Landmark[] {
	const landmarks: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
	// Wrist
	landmarks[LANDMARK.WRIST] = { x: 0.5, y: 0.8 };
	// MCPs
	landmarks[LANDMARK.INDEX_MCP] = { x: 0.45, y: 0.6 };
	landmarks[LANDMARK.MIDDLE_MCP] = { x: 0.5, y: 0.58 };
	landmarks[LANDMARK.RING_MCP] = { x: 0.55, y: 0.6 };
	landmarks[LANDMARK.PINKY_MCP] = { x: 0.6, y: 0.62 };
	landmarks[LANDMARK.THUMB_MCP] = { x: 0.4, y: 0.7 };

	// Closed positions (folded down)
	landmarks[LANDMARK.INDEX_PIP] = { x: 0.45, y: 0.65 };
	landmarks[LANDMARK.INDEX_TIP] = { x: 0.45, y: 0.7 };
	landmarks[LANDMARK.MIDDLE_PIP] = { x: 0.5, y: 0.65 };
	landmarks[LANDMARK.MIDDLE_TIP] = { x: 0.5, y: 0.7 };
	landmarks[LANDMARK.RING_PIP] = { x: 0.55, y: 0.65 };
	landmarks[LANDMARK.RING_TIP] = { x: 0.55, y: 0.7 };
	landmarks[LANDMARK.PINKY_PIP] = { x: 0.6, y: 0.65 };
	landmarks[LANDMARK.PINKY_TIP] = { x: 0.6, y: 0.7 };
	landmarks[LANDMARK.THUMB_IP] = { x: 0.42, y: 0.68 };
	landmarks[LANDMARK.THUMB_TIP] = { x: 0.45, y: 0.68 };

	// Extended positions for open fingers
	if (openFingers.includes("index")) {
		landmarks[LANDMARK.INDEX_PIP] = { x: 0.45, y: 0.45 };
		landmarks[LANDMARK.INDEX_TIP] = { x: 0.45, y: 0.3 };
	}
	if (openFingers.includes("middle")) {
		landmarks[LANDMARK.MIDDLE_PIP] = { x: 0.5, y: 0.42 };
		landmarks[LANDMARK.MIDDLE_TIP] = { x: 0.5, y: 0.25 };
	}
	if (openFingers.includes("ring")) {
		landmarks[LANDMARK.RING_PIP] = { x: 0.55, y: 0.45 };
		landmarks[LANDMARK.RING_TIP] = { x: 0.55, y: 0.3 };
	}
	if (openFingers.includes("pinky")) {
		landmarks[LANDMARK.PINKY_PIP] = { x: 0.6, y: 0.5 };
		landmarks[LANDMARK.PINKY_TIP] = { x: 0.6, y: 0.38 };
	}
	if (openFingers.includes("thumb")) {
		landmarks[LANDMARK.THUMB_IP] = { x: 0.3, y: 0.65 };
		landmarks[LANDMARK.THUMB_TIP] = { x: 0.2, y: 0.6 };
	}

	return landmarks;
}

describe("Gesture Tracking Core", () => {
	it("calibrates normalized pxPerCm scale and computes 1cm anchor above fingertip", () => {
		const landmarks = createMockLandmarks(["index"]);
		const pxPerCm = calculateNormalizedPxPerCm(landmarks);
		expect(pxPerCm).toBeGreaterThan(0.01);
		expect(pxPerCm).toBeLessThan(0.15);

		const anchor = computeFingertipAnchor({
			tipX: 0.5,
			tipY: 0.4,
			dirX: 0,
			dirY: -1, // pointing upwards
			offsetCm: 1.0,
			pxPerCm,
		});

		// 1cm above means Y decreases (upwards) by exactly pxPerCm
		expect(anchor.x).toBeCloseTo(0.5);
		expect(anchor.y).toBeCloseTo(0.4 - pxPerCm);
	});

	it("classifies only open fingers correctly", () => {
		// 1 finger raised: Index ☝️
		const oneFingerLandmarks = createMockLandmarks(["index"]);
		const oneFingerResults = classifyFingersForHand(oneFingerLandmarks, "right");
		const openFingers1 = oneFingerResults.filter((r) => r.isOpen).map((r) => r.finger);
		expect(openFingers1).toEqual(["index"]);

		// 2 fingers raised: Index + Middle ✌️
		const twoFingerLandmarks = createMockLandmarks(["index", "middle"]);
		const twoFingerResults = classifyFingersForHand(twoFingerLandmarks, "right");
		const openFingers2 = twoFingerResults.filter((r) => r.isOpen).map((r) => r.finger);
		expect(openFingers2).toContain("index");
		expect(openFingers2).toContain("middle");
		expect(openFingers2).not.toContain("ring");
	});

	it("segments multi-finger open/close sessions into independent split regions", () => {
		const frames: FrameFingerDetection[] = [];

		// Frame 0-300ms: Raise 1 finger (Index)
		for (let t = 0; t <= 300; t += 33) {
			frames.push({
				tMs: t,
				pxPerCm: 0.04,
				detections: classifyFingersForHand(createMockLandmarks(["index"]), "right"),
			});
		}

		// Frame 333-600ms: Also raise 2nd finger (Index + Middle)
		for (let t = 333; t <= 600; t += 33) {
			frames.push({
				tMs: t,
				pxPerCm: 0.04,
				detections: classifyFingersForHand(createMockLandmarks(["index", "middle"]), "right"),
			});
		}

		// Frame 633-800ms: Close Index, Middle remains open
		for (let t = 633; t <= 800; t += 33) {
			frames.push({
				tMs: t,
				pxPerCm: 0.04,
				detections: classifyFingersForHand(createMockLandmarks(["middle"]), "right"),
			});
		}

		// Frame 833-1100ms: Close all fingers
		for (let t = 833; t <= 1100; t += 33) {
			frames.push({
				tMs: t,
				pxPerCm: 0.04,
				detections: classifyFingersForHand(createMockLandmarks([]), "right"),
			});
		}

		// Frame 1133-1400ms: Raise Index finger again (split session)
		for (let t = 1133; t <= 1400; t += 33) {
			frames.push({
				tMs: t,
				pxPerCm: 0.04,
				detections: classifyFingersForHand(createMockLandmarks(["index"]), "right"),
			});
		}

		const regions = segmentFingerDetections(frames, { minHoldMs: 150, releaseMs: 100 });

		// Should have 3 distinct regions:
		// 1. First index session (0 - 600ms)
		// 2. Middle session (333 - 800ms)
		// 3. Second index session (1133 - 1400ms)
		expect(regions.length).toBe(3);

		const indexRegions = regions.filter((r) => r.finger === "index");
		const middleRegions = regions.filter((r) => r.finger === "middle");

		expect(indexRegions.length).toBe(2);
		expect(middleRegions.length).toBe(1);

		expect(indexRegions[0].startMs).toBe(0);
		expect(indexRegions[0].endMs).toBeCloseTo(600, -2);

		expect(middleRegions[0].startMs).toBeCloseTo(333, -2);
		expect(middleRegions[0].endMs).toBeCloseTo(800, -2);

		expect(indexRegions[1].startMs).toBeCloseTo(1133, -2);
		expect(indexRegions[1].endMs).toBeCloseTo(1400, -2);
	});

	it("evaluates object motion deterministically with smooth pop entrance and shrink exit", () => {
		const region = {
			id: "test-reg",
			hand: "right" as const,
			finger: "index" as const,
			startMs: 1000,
			endMs: 3000,
			samples: [
				{
					tMs: 1000,
					x: 0.5,
					y: 0.4,
					tipX: 0.5,
					tipY: 0.45,
					directionX: 0,
					directionY: -1,
					pxPerCm: 0.05,
					confidence: 0.9,
				},
				{
					tMs: 3000,
					x: 0.5,
					y: 0.35,
					tipX: 0.5,
					tipY: 0.4,
					directionX: 0,
					directionY: -1,
					pxPerCm: 0.05,
					confidence: 0.9,
				},
			],
			attachment: {
				kind: "sticker" as const,
				content: "✨",
				sizePct: 15,
				offsetCm: 1.0,
				offsetAngleDeg: 0,
				followRotation: true,
				scaleWithHand: false,
				enterAnimation: "pop" as const,
				exitAnimation: "shrink" as const,
				idleAnimation: "float" as const,
				enterDurationMs: 300,
				exitDurationMs: 200,
				followLag: 0,
			},
		};

		// Before region
		expect(evaluateGestureObject(region, undefined, 500).visible).toBe(false);

		// During entrance pop (t = 1150ms)
		const enterState = evaluateGestureObject(region, undefined, 1150);
		expect(enterState.visible).toBe(true);
		expect(enterState.scale).toBeGreaterThan(0.5);

		// Mid-session (t = 2000ms)
		const midState = evaluateGestureObject(region, undefined, 2000);
		expect(midState.visible).toBe(true);
		expect(midState.opacity).toBeCloseTo(1);
		expect(midState.x).toBeCloseTo(0.5);

		// Near exit (t = 2950ms)
		const exitState = evaluateGestureObject(region, undefined, 2950);
		expect(exitState.visible).toBe(true);
		expect(exitState.scale).toBeLessThan(1.0);

		// After region
		expect(evaluateGestureObject(region, undefined, 3500).visible).toBe(false);
	});
});
