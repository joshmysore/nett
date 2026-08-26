import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.6;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.22;
  vec2 drift = vec2(
    sin(t) + 0.6 * sin(t * 1.7 + 1.3),
    cos(t * 0.8) + 0.6 * cos(t * 1.3 + 2.1)
  );
  vec2 p = vec2(uv.x * 1.8, uv.y * 1.0) + drift * 0.7;
  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(3.2, 1.5) - drift));
  float f = fbm(p + 1.2 * q);
  float g = clamp(1.0 - uv.y, 0.0, 1.0);
  float shade = clamp(g + (f - 0.5) * 0.8 * smoothstep(0.0, 0.3, uv.y), 0.0, 1.0);
  vec3 white = vec3(0.99, 1.0, 1.0);
  vec3 light = mix(white, u_color, 0.5);
  vec3 col = mix(white, light, smoothstep(0.28, 0.52, shade));
  col = mix(col, u_color, smoothstep(0.58, 0.88, shade));
  float edge = smoothstep(0.5, 0.49, distance(uv, vec2(0.5)));
  gl_FragColor = vec4(col * edge, edge);
}
`;

function accentRgb(): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  document.body.appendChild(probe);
  const match = getComputedStyle(probe).color.match(/[\d.]+/g);
  probe.remove();
  if (!match || match.length < 3) return [0.34, 0.45, 0.78];
  return [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** One ceremonial orb. Never mount per person — WebGL does not scale to a grid. */
export function FluidOrb({
  size = 88,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true });
    if (!gl) return;
    const program = gl.createProgram();
    const vert = compile(gl, gl.VERTEX_SHADER, VERT);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!program || !vert || !frag) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const rgb = accentRgb();
    gl.uniform3f(gl.getUniformLocation(program, "u_color"), rgb[0], rgb[1], rgb[2]);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    gl.viewport(0, 0, px, px);
    gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), px, px);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const render = (now: number) => {
      gl.uniform1f(gl.getUniformLocation(program, "u_time"), reduce ? 0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduce) raf = requestAnimationFrame(render);
    };
    render(start);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, [size]);

  return (
    <div className={className ? `fluid-orb ${className}` : "fluid-orb"} style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
