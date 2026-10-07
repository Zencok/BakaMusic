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
uniform float u_manual;

vec2 flowUv(vec2 point, float angle, vec2 offset) {
    float cosine = cos(angle);
    float sine = sin(angle);
    vec2 rotated = mat2(cosine, -sine, sine, cosine) * point;
    return 0.5 + 0.46 * sin(rotated + offset);
}

void main() {
    vec2 screenUv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
    vec2 p = mix(screenUv, v_uv, u_manual);
    vec2 point = (p - 0.5) * 2.4;
    point.x *= min(u_resolution.x / max(u_resolution.y, 1.0), 1.8);
    float t = u_time;
    float swell = 1.0 - clamp(u_volume, 0.0, 1.0) * 0.05;

    vec2 warp = vec2(
        sin(point.y * 1.2 + t * 0.23) + sin(point.x * 0.7 - t * 0.17),
        cos(point.x * 1.1 - t * 0.19) + cos(point.y * 0.8 + t * 0.21)
    ) * 0.32;
    vec2 slide = vec2(sin(t * 0.13), cos(t * 0.11)) * 0.65;

    vec3 primary = texture2D(
        u_texture,
        flowUv(point * swell + warp, t * 0.075, slide)
    ).rgb;
    vec3 secondary = texture2D(
        u_texture,
        flowUv(point * 0.85 * swell - warp.yx, -t * 0.055 + 2.1, -slide.yx)
    ).rgb;

    float blend = 0.5 + 0.28 * sin(t * 0.16 + point.x * 0.7 + point.y * 0.5);
    vec3 color = mix(primary, secondary, blend) * mix(vec3(1.0), v_color, u_manual);

    float edge = smoothstep(0.15, 0.92, length((screenUv - 0.5) * vec2(1.12, 1.0)));
    color *= mix(1.0, 0.9, edge);

    gl_FragColor = vec4(max(color, 0.0), 1.0);
}
