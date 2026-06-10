export { NEBULA_SHADER as DEFAULT_FRAGMENT_SHADER } from './shaderDefaults';

// Fullscreen quad: position.xy already spans [-1,1] on a PlaneGeometry(2,2).
// Bypassing camera matrices puts vertices directly in NDC → fills screen exactly.
export const VERTEX_SHADER = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export function extractGLSL(text: string): string | null {
  // Match ```glsl, ```c, ```cpp, or plain ``` blocks
  const match = text.match(/```(?:glsl|c|cpp|GLSL)?\s*\n([\s\S]*?)```/);
  if (match) return match[1].trim();

  // Fallback: if text itself looks like a shader
  if (text.includes('void main') && text.includes('gl_FragColor')) {
    return text.trim();
  }

  return null;
}

// Trivially-valid fallback. The material is initialised with this and falls
// back to it if a shader ever fails validation — guarantees the GPU never
// receives source that didn't compile + link.
export const SAFE_SHADER = `precision mediump float;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(0.04, 0.03, 0.09, 1.0);
}`;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

// Standalone twin of VERTEX_SHADER: Three.js auto-injects `position`/`uv`
// attributes into ShaderMaterial, but a raw WebGL program must declare them.
// The `varying vec2 vUv` interface must match the fragment shader for linking.
const TEST_VERTEX_SHADER = `attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function compileShader(
  gl: GL,
  type: number,
  src: string,
): { shader: WebGLShader | null; error: string | null } {
  const shader = gl.createShader(type);
  if (!shader) return { shader: null, error: 'Could not allocate shader object' };

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  // COMPILE_STATUS gate — a mix() with the wrong arity, a dimension mismatch,
  // an undeclared identifier, etc. fails HERE, before we ever attempt to link.
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) || 'Unknown compilation error';
    gl.deleteShader(shader);
    return { shader: null, error };
  }
  return { shader, error: null };
}

/**
 * Validates a fragment shader exactly the way Three.js will, using the SAME
 * live WebGL context the renderer uses (no throwaway contexts — those leak and
 * eventually return null, silently letting broken shaders through after ~16
 * generations). Steps:
 *   1. compile the vertex shader   (COMPILE_STATUS)
 *   2. compile the fragment shader (COMPILE_STATUS)  ← catches bad mix() etc.
 *   3. link both into a program    (LINK_STATUS)     ← catches varying/limit issues
 *
 * Returns the full info log on ANY failure (incl. unusable context) so the
 * caller can route it to the correction loop, or null when the shader is valid.
 * It never returns null for a broken shader — "no validation possible" counts
 * as failure, so an unvalidated shader is never assigned to the material.
 */
export function testShaderProgram(gl: GL | null | undefined, fragmentSource: string): string | null {
  if (!gl || (gl.isContextLost && gl.isContextLost())) {
    return 'WebGL context unavailable for shader validation';
  }

  try {
    const vs = compileShader(gl, gl.VERTEX_SHADER, TEST_VERTEX_SHADER);
    if (vs.error) return vs.error;

    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (fs.error) {
      if (vs.shader) gl.deleteShader(vs.shader);
      return fs.error; // fragment failed to COMPILE — never reaches link
    }

    const program = gl.createProgram();
    if (!program || !vs.shader || !fs.shader) {
      if (vs.shader) gl.deleteShader(vs.shader);
      if (fs.shader) gl.deleteShader(fs.shader);
      if (program) gl.deleteProgram(program);
      return 'Could not allocate WebGL program for validation';
    }

    gl.attachShader(program, vs.shader);
    gl.attachShader(program, fs.shader);
    gl.linkProgram(program);

    let linkError: string | null = null;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      linkError =
        gl.getProgramInfoLog(program) ||
        'Program failed to link (vertex and fragment shaders are incompatible)';
    }

    // Detach + delete only the objects WE created — never touches Three's state.
    gl.detachShader(program, vs.shader);
    gl.detachShader(program, fs.shader);
    gl.deleteShader(vs.shader);
    gl.deleteShader(fs.shader);
    gl.deleteProgram(program);

    return linkError;
  } catch (e) {
    return `Shader validation threw: ${(e as Error).message}`;
  }
}
