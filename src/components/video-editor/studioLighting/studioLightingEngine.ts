import type { StudioLightingSettings } from "./studioLightingTypes";

export function hexToRgb(hex: string): [number, number, number] {
	const clean = hex.replace("#", "").trim();
	if (clean.length === 3) {
		const r = parseInt(clean[0] + clean[0], 16) / 255;
		const g = parseInt(clean[1] + clean[1], 16) / 255;
		const b = parseInt(clean[2] + clean[2], 16) / 255;
		return [r, g, b];
	}
	if (clean.length === 6) {
		const r = parseInt(clean.substring(0, 2), 16) / 255;
		const g = parseInt(clean.substring(2, 4), 16) / 255;
		const b = parseInt(clean.substring(4, 6), 16) / 255;
		return [r, g, b];
	}
	return [1, 1, 1];
}

const VS_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_webcam;
uniform vec2 u_resolution;

const int MAX_LIGHTS = 8;
uniform int u_numLights;
uniform vec3 u_lightPos[MAX_LIGHTS];       // (x, y, z)
uniform vec3 u_lightColor[MAX_LIGHTS];     // (r, g, b)
uniform vec4 u_lightParams[MAX_LIGHTS];    // (x: intensity, y: radius, z: castShadow, w: specular)

uniform float u_ambientIntensity;
uniform vec3 u_ambientColor;
uniform float u_depthResponse;
uniform float u_normalSmoothness;
uniform float u_shadowSoftness;
uniform float u_specularShininess;
uniform float u_exposure;
uniform float u_contrast;
uniform int u_mirror;

// Smooth multi-scale low-pass depth sampling to completely eliminate micro-texture noise (beards, pores, glasses)
float sampleLowPassDepth(vec2 uv, vec2 px) {
    float centerLum = dot(texture(u_webcam, uv).rgb, vec3(0.299, 0.587, 0.114));
    
    // Wide Gaussian blur kernel for smooth macro geometry
    float blur = 0.0;
    float totalW = 0.0;
    
    float kernelDist = max(12.0, u_normalSmoothness * 24.0);
    vec2 stepX = vec2(px.x * kernelDist, 0.0);
    vec2 stepY = vec2(0.0, px.y * kernelDist);
    
    blur += dot(texture(u_webcam, clamp(uv - stepX, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114)) * 0.25;
    blur += dot(texture(u_webcam, clamp(uv + stepX, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114)) * 0.25;
    blur += dot(texture(u_webcam, clamp(uv - stepY, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114)) * 0.25;
    blur += dot(texture(u_webcam, clamp(uv + stepY, 0.0, 1.0)).rgb, vec3(0.299, 0.587, 0.114)) * 0.25;
    
    float smoothLum = blur * 0.7 + centerLum * 0.3;
    
    // Smooth portrait dome prior (center-weighted subject volume)
    vec2 centerOffset = (uv - vec2(0.5, 0.45)) * vec2(1.0, 1.2);
    float portraitDome = max(0.0, 1.0 - length(centerOffset) * 1.4);
    portraitDome = smoothstep(0.0, 1.0, portraitDome);
    
    return clamp(smoothLum * 0.45 + portraitDome * 0.55, 0.0, 1.0);
}

// Reconstruct ultra-smooth volumetric normals combining smooth portrait geometry and gradient curvature
vec3 reconstructSmoothNormal(vec2 uv, vec2 px, float depthResponse) {
    float k = max(16.0, u_normalSmoothness * 28.0);
    vec2 offX = vec2(px.x * k, 0.0);
    vec2 offY = vec2(0.0, px.y * k);
    
    float dLeft  = sampleLowPassDepth(clamp(uv - offX, 0.0, 1.0), px);
    float dRight = sampleLowPassDepth(clamp(uv + offX, 0.0, 1.0), px);
    float dUp    = sampleLowPassDepth(clamp(uv - offY, 0.0, 1.0), px);
    float dDown  = sampleLowPassDepth(clamp(uv + offY, 0.0, 1.0), px);
    
    float dX = (dRight - dLeft) * depthResponse * 1.8;
    float dY = (dDown - dUp) * depthResponse * 1.8;
    
    // Volumetric 3D dome normal
    vec2 pCenter = vec2(0.5, 0.45);
    vec2 pVec = (uv - pCenter) * vec2(1.1, 1.3);
    float pLen = length(pVec);
    vec3 domeN = normalize(vec3(-pVec.x * 1.2, -pVec.y * 1.2, sqrt(max(0.05, 1.0 - pLen * pLen * 1.2))));
    
    // Blend luminance gradient normal with 3D subject dome normal
    vec3 gradN = normalize(vec3(-dX, -dY, 1.0));
    return normalize(mix(gradN, domeN, 0.65));
}

void main() {
    vec2 uv = v_texCoord;
    if (u_mirror == 1) {
        uv.x = 1.0 - uv.x;
    }
    
    vec4 srcColor = texture(u_webcam, uv);
    vec3 albedo = srcColor.rgb;
    
    vec2 px = 1.0 / max(u_resolution, vec2(1.0));
    
    // Smooth reconstructed surface normal and depth
    float dCenter = sampleLowPassDepth(uv, px);
    vec3 N = reconstructSmoothNormal(uv, px, u_depthResponse);
    vec3 V = vec3(0.0, 0.0, 1.0); // View direction
    
    vec3 diffuseAccum = vec3(0.0);
    vec3 specularAccum = vec3(0.0);
    vec3 rimAccum = vec3(0.0);
    
    for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= u_numLights) break;
        
        vec3 lPos = u_lightPos[i];
        vec3 lCol = u_lightColor[i];
        vec4 lParams = u_lightParams[i];
        
        float intensity = lParams.x;
        float radius = max(0.2, lParams.y);
        bool castShadow = lParams.z > 0.5;
        float specStrength = lParams.w;
        
        if (intensity <= 0.001) continue;
        
        // Light vector in 3D studio space
        vec3 lightVec = vec3(lPos.x - uv.x, lPos.y - uv.y, lPos.z - dCenter * 0.5);
        float dist = length(lightVec);
        vec3 L = normalize(lightVec);
        
        // Flattering studio soft falloff (wide softbox falloff profile)
        float normDist = clamp(dist / radius, 0.0, 1.0);
        float falloff = (1.0 - normDist * normDist);
        falloff = falloff * falloff / (1.0 + dist * 0.8);
        
        // Studio Half-Lambert Diffuse with skin scattering wrap
        float NdotL = dot(N, L);
        float softDiffuse = pow(clamp((NdotL + 0.4) / 1.4, 0.0, 1.0), 1.1);
        
        // Directional soft shadow / contact occlusion
        float shadow = 1.0;
        if (castShadow) {
            float shadowOcclusion = clamp((dCenter - lPos.z) * 1.5, 0.0, 0.6);
            shadow = 1.0 - shadowOcclusion * (1.0 - u_shadowSoftness * 0.5);
        }
        
        // Soft Blinn-Phong specular catchlight
        vec3 H = normalize(L + V);
        float NdotH = max(0.0, dot(N, H));
        float specular = pow(NdotH, u_specularShininess) * specStrength * falloff * shadow;
        
        // Professional Rim/Edge Fresnel separation
        float fresnel = pow(clamp(1.0 - max(0.0, dot(N, V)), 0.0, 1.0), 3.0);
        float rimAlign = max(0.0, dot(-L.xy, N.xy) * 0.7 + 0.3);
        float rim = fresnel * rimAlign * falloff * intensity * 0.6;
        
        diffuseAccum += lCol * (softDiffuse * intensity * falloff * shadow);
        specularAccum += lCol * (specular * intensity);
        rimAccum += lCol * rim;
    }
    
    // Studio Ambient & Baseline Camera Retention
    // The base video remains clear and naturally exposed (85% - 100% baseline), while studio lights illuminate & model the scene
    vec3 ambient = u_ambientColor * (u_ambientIntensity * 0.5);
    float basePresence = clamp(0.8 + u_ambientIntensity * 0.25, 0.7, 1.0);
    vec3 baseLit = albedo * basePresence + ambient * albedo;
    
    // Additive & Soft-Light studio layer
    vec3 lightingContribution = albedo * diffuseAccum * 0.65 + diffuseAccum * albedo * 0.35;
    vec3 litColor = baseLit + lightingContribution + specularAccum * 0.75 + rimAccum;
    
    // Exposure and contrast tuning
    litColor = litColor * u_exposure;
    litColor = pow(max(vec3(0.0), litColor), vec3(u_contrast));
    
    // Clean clamp
    fragColor = vec4(clamp(litColor, 0.0, 1.0), srcColor.a);
}
`;

export class StudioLightingEngine {
	private gl: WebGL2RenderingContext | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private program: WebGLProgram | null = null;
	private vao: WebGLVertexArrayObject | null = null;
	private positionBuffer: WebGLBuffer | null = null;
	private texCoordBuffer: WebGLBuffer | null = null;
	private texture: WebGLTexture | null = null;

	// Uniform locations
	private uWebcamLoc: WebGLUniformLocation | null = null;
	private uResolutionLoc: WebGLUniformLocation | null = null;
	private uNumLightsLoc: WebGLUniformLocation | null = null;
	private uLightPosLoc: WebGLUniformLocation | null = null;
	private uLightColorLoc: WebGLUniformLocation | null = null;
	private uLightParamsLoc: WebGLUniformLocation | null = null;
	private uAmbientIntensityLoc: WebGLUniformLocation | null = null;
	private uAmbientColorLoc: WebGLUniformLocation | null = null;
	private uDepthResponseLoc: WebGLUniformLocation | null = null;
	private uNormalSmoothnessLoc: WebGLUniformLocation | null = null;
	private uShadowSoftnessLoc: WebGLUniformLocation | null = null;
	private uSpecularShininessLoc: WebGLUniformLocation | null = null;
	private uExposureLoc: WebGLUniformLocation | null = null;
	private uContrastLoc: WebGLUniformLocation | null = null;
	private uMirrorLoc: WebGLUniformLocation | null = null;

	private initialized = false;

	public initialize(canvas?: HTMLCanvasElement): boolean {
		try {
			if (typeof document === "undefined") return false;
			this.canvas = canvas || document.createElement("canvas");
			const gl = this.canvas.getContext("webgl2", {
				alpha: true,
				premultipliedAlpha: false,
				preserveDrawingBuffer: true,
				antialias: false,
				powerPreference: "high-performance",
			}) as WebGL2RenderingContext | null;

			if (!gl) {
				console.warn("[StudioLightingEngine] WebGL2 not supported, falling back to 2D Canvas");
				return false;
			}
			this.gl = gl;

			const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
			const fs = this.compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
			if (!vs || !fs) return false;

			const program = gl.createProgram();
			if (!program) return false;
			gl.attachShader(program, vs);
			gl.attachShader(program, fs);
			gl.linkProgram(program);

			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				console.error("[StudioLightingEngine] Program link error:", gl.getProgramInfoLog(program));
				return false;
			}
			this.program = program;

			// Uniforms
			this.uWebcamLoc = gl.getUniformLocation(program, "u_webcam");
			this.uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
			this.uNumLightsLoc = gl.getUniformLocation(program, "u_numLights");
			this.uLightPosLoc = gl.getUniformLocation(program, "u_lightPos");
			this.uLightColorLoc = gl.getUniformLocation(program, "u_lightColor");
			this.uLightParamsLoc = gl.getUniformLocation(program, "u_lightParams");
			this.uAmbientIntensityLoc = gl.getUniformLocation(program, "u_ambientIntensity");
			this.uAmbientColorLoc = gl.getUniformLocation(program, "u_ambientColor");
			this.uDepthResponseLoc = gl.getUniformLocation(program, "u_depthResponse");
			this.uNormalSmoothnessLoc = gl.getUniformLocation(program, "u_normalSmoothness");
			this.uShadowSoftnessLoc = gl.getUniformLocation(program, "u_shadowSoftness");
			this.uSpecularShininessLoc = gl.getUniformLocation(program, "u_specularShininess");
			this.uExposureLoc = gl.getUniformLocation(program, "u_exposure");
			this.uContrastLoc = gl.getUniformLocation(program, "u_contrast");
			this.uMirrorLoc = gl.getUniformLocation(program, "u_mirror");

			// Setup Fullscreen Quad VAO
			const vao = gl.createVertexArray();
			gl.bindVertexArray(vao);
			this.vao = vao;

			const aPosLoc = gl.getAttribLocation(program, "a_position");
			const aTexLoc = gl.getAttribLocation(program, "a_texCoord");

			const positions = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
			this.positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
			if (aPosLoc >= 0) {
				gl.enableVertexAttribArray(aPosLoc);
				gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
			}

			const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]);
			this.texCoordBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
			if (aTexLoc >= 0) {
				gl.enableVertexAttribArray(aTexLoc);
				gl.vertexAttribPointer(aTexLoc, 2, gl.FLOAT, false, 0, 0);
			}

			// Texture
			this.texture = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, this.texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

			this.initialized = true;
			return true;
		} catch (e) {
			console.error("[StudioLightingEngine] Failed to initialize WebGL2:", e);
			return false;
		}
	}

	private compileShader(type: number, source: string): WebGLShader | null {
		if (!this.gl) return null;
		const shader = this.gl.createShader(type);
		if (!shader) return null;
		this.gl.shaderSource(shader, source);
		this.gl.compileShader(shader);
		if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
			console.error("[StudioLightingEngine] Shader compile error:", this.gl.getShaderInfoLog(shader));
			this.gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	public renderToCanvas(
		source: CanvasImageSource | ImageData | VideoFrame,
		settings: StudioLightingSettings,
		mirror = false,
	): HTMLCanvasElement | null {
		if (!this.initialized && !this.initialize()) {
			return null;
		}
		if (!this.gl || !this.program || !this.canvas) {
			return null;
		}

		const gl = this.gl;
		let width = 640;
		let height = 480;

		if (source instanceof ImageData) {
			width = source.width;
			height = source.height;
		} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
			width = source.displayWidth || source.codedWidth || 640;
			height = source.displayHeight || source.codedHeight || 480;
		} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
			width = source.videoWidth || source.width || 640;
			height = source.videoHeight || source.height || 480;
		} else {
			const cs = source as { width?: number; height?: number };
			width = cs.width || 640;
			height = cs.height || 480;
		}

		if (width <= 0 || height <= 0) {
			return null;
		}

		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}

		gl.viewport(0, 0, width, height);
		gl.useProgram(this.program);

		// Bind texture
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		if (source instanceof ImageData) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
		}
		gl.uniform1i(this.uWebcamLoc, 0);
		gl.uniform2f(this.uResolutionLoc, width, height);

		// Lights
		const activeLights = (settings.lights || []).filter((l) => l.enabled).slice(0, 8);
		gl.uniform1i(this.uNumLightsLoc, activeLights.length);

		const lightPositions: number[] = [];
		const lightColors: number[] = [];
		const lightParams: number[] = [];

		for (let i = 0; i < 8; i++) {
			const light = activeLights[i];
			if (light) {
				lightPositions.push(light.x, light.y, light.z);
				const [r, g, b] = hexToRgb(light.color);
				lightColors.push(r, g, b);
				lightParams.push(light.intensity, light.radius, light.castShadow ? 1.0 : 0.0, light.specular);
			} else {
				lightPositions.push(0, 0, 0);
				lightColors.push(0, 0, 0);
				lightParams.push(0, 0, 0, 0);
			}
		}

		gl.uniform3fv(this.uLightPosLoc, new Float32Array(lightPositions));
		gl.uniform3fv(this.uLightColorLoc, new Float32Array(lightColors));
		gl.uniform4fv(this.uLightParamsLoc, new Float32Array(lightParams));

		// Ambient and globals
		const [ar, ag, ab] = hexToRgb(settings.ambientColor || "#202028");
		gl.uniform1f(this.uAmbientIntensityLoc, settings.ambientIntensity ?? 0.5);
		gl.uniform3f(this.uAmbientColorLoc, ar, ag, ab);
		gl.uniform1f(this.uDepthResponseLoc, settings.depthResponse ?? 1.0);
		gl.uniform1f(this.uNormalSmoothnessLoc, settings.normalSmoothness ?? 1.0);
		gl.uniform1f(this.uShadowSoftnessLoc, settings.shadowSoftness ?? 0.5);
		gl.uniform1f(this.uSpecularShininessLoc, settings.specularShininess ?? 24.0);
		gl.uniform1f(this.uExposureLoc, settings.exposure ?? 1.0);
		gl.uniform1f(this.uContrastLoc, settings.contrast ?? 1.0);
		gl.uniform1i(this.uMirrorLoc, mirror ? 1 : 0);

		// Draw
		gl.bindVertexArray(this.vao);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.bindVertexArray(null);

		return this.canvas;
	}

	public render(
		source: CanvasImageSource | ImageData | VideoFrame,
		settings: StudioLightingSettings,
		mirror = false,
	): boolean {
		return Boolean(this.renderToCanvas(source, settings, mirror));
	}

	public dispose() {
		if (!this.gl) return;
		const gl = this.gl;
		if (this.program) gl.deleteProgram(this.program);
		if (this.vao) gl.deleteVertexArray(this.vao);
		if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
		if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
		if (this.texture) gl.deleteTexture(this.texture);
		this.initialized = false;
		this.gl = null;
		this.canvas = null;
	}
}

/**
 * Global shared renderer instance for off-screen / export frame processing
 */
let sharedEngineInstance: StudioLightingEngine | null = null;

export function renderStudioLightingToCanvas(
	source: CanvasImageSource | ImageData | VideoFrame,
	targetCanvas: HTMLCanvasElement,
	settings: StudioLightingSettings,
	mirror = false,
): boolean {
	let width = 640;
	let height = 480;

	if (source instanceof ImageData) {
		width = source.width;
		height = source.height;
	} else if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
		width = source.displayWidth || source.codedWidth || 640;
		height = source.displayHeight || source.codedHeight || 480;
	} else if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
		width = source.videoWidth || source.width || 640;
		height = source.videoHeight || source.height || 480;
	} else {
		const cs = source as { width?: number; height?: number };
		width = cs.width || 640;
		height = cs.height || 480;
	}

	if (targetCanvas.width !== width || targetCanvas.height !== height) {
		targetCanvas.width = width;
		targetCanvas.height = height;
	}

	if (!settings.enabled) {
		const ctx = targetCanvas.getContext("2d");
		if (!ctx) return false;
		ctx.save();
		if (mirror) {
			ctx.translate(width, 0);
			ctx.scale(-1, 1);
		}
		if (source instanceof ImageData) {
			ctx.putImageData(source, 0, 0);
		} else {
			ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
		}
		ctx.restore();
		return true;
	}

	if (!sharedEngineInstance) {
		sharedEngineInstance = new StudioLightingEngine();
		sharedEngineInstance.initialize();
	}

	const glCanvas = sharedEngineInstance.renderToCanvas(source, settings, mirror);
	if (!glCanvas) {
		const ctx = targetCanvas.getContext("2d");
		if (ctx && !(source instanceof ImageData)) {
			ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
		}
		return false;
	}

	if (targetCanvas === glCanvas) {
		return true;
	}

	const ctx = targetCanvas.getContext("2d");
	if (!ctx) return false;
	ctx.clearRect(0, 0, width, height);
	ctx.drawImage(glCanvas, 0, 0, width, height);
	return true;
}

