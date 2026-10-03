import { describe, expect, it } from "vitest";
import {
	buildSpeechSegments,
	GOOGLE_SPEECH_LANG_MAP,
	parseGoogleSpeechResponse,
} from "./googleSpeech";

describe("googleSpeech", () => {
	it("maps language codes to appropriate BCP-47 tags", () => {
		expect(GOOGLE_SPEECH_LANG_MAP["ml"]).toBe("ml-IN");
		expect(GOOGLE_SPEECH_LANG_MAP["en"]).toBe("en-US");
		expect(GOOGLE_SPEECH_LANG_MAP["hi"]).toBe("hi-IN");
		expect(GOOGLE_SPEECH_LANG_MAP["ta"]).toBe("ta-IN");
	});

	it("parses Google speech json response lines", () => {
		const rawResponse = `{"result":[]}\n{"result":[{"alternative":[{"transcript":"സ്വാഗതം","confidence":0.98}],"final":true}],"result_index":0}`;
		const transcript = parseGoogleSpeechResponse(rawResponse);
		expect(transcript).toBe("സ്വാഗതം");
	});

	it("handles empty or invalid responses cleanly", () => {
		expect(parseGoogleSpeechResponse("")).toBeNull();
		expect(parseGoogleSpeechResponse("not-json")).toBeNull();
		expect(parseGoogleSpeechResponse(`{"result":[]}`)).toBeNull();
	});

	it("builds speech segments based on silences and duration", () => {
		const silences = [
			{ startMs: 3000, endMs: 4000 },
			{ startMs: 8000, endMs: 9000 },
		];
		const segments = buildSpeechSegments(12000, silences, 5000, 500);
		expect(segments.length).toBeGreaterThanOrEqual(2);
		expect(segments[0].startMs).toBe(0);
		expect(segments[0].endMs).toBe(3000);
	});
});
