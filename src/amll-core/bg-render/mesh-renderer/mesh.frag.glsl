#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec3 v_color;
varying vec2 v_uv;

uniform sampler2D u_texture;
uniform float u_time;
uniform float u_volume;
uniform vec2 u_resolution;

vec2 flowUv(vec2 uv, float scale, vec2 slide, vec2 warp) {
    vec2 centered = (uv - 0.5) * scale + 0.5 + slide + warp;
    return clamp(centered, 0.018, 0.982);
}

void main() {
    vec2 p = v_uv;
    float t = u_time;
    float swell = 1.0 - clamp(u_volume, 0.0, 1.0) * 0.05;

    vec2 warp = vec2(
        sin(p.y * 2.0 + t * 0.18) + sin(p.x * 1.35 - t * 0.13),
        cos(p.x * 1.8 - t * 0.16) + cos(p.y * 1.2 + t * 0.15)
    ) * 0.014;
    vec2 slide = vec2(sin(t * 0.075), cos(t * 0.06)) * 0.018;

    vec3 primary = texture2D(
        u_texture,
        flowUv(p, 0.78 * swell, slide, warp)
    ).rgb;
    vec3 secondary = texture2D(
        u_texture,
        flowUv(p, 0.84 * swell, slide.yx * 0.55, -warp.yx * 0.65)
    ).rgb;

    float blend = 0.5 + 0.5 * sin(t * 0.11 + p.x * 0.42 + p.y * 0.31);
    blend = smoothstep(0.08, 0.92, blend);
    vec3 color = mix(primary, secondary, blend) * v_color;

    vec2 screenUv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
    float edge = smoothstep(0.15, 0.92, length((screenUv - 0.5) * vec2(1.12, 1.0)));
    color *= mix(1.0, 0.9, edge);

    gl_FragColor = vec4(max(color, 0.0), 1.0);
}
