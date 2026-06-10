'use client';
import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShaderStore, applyCompiledShader } from '@/store/useShaderStore';
import { VERTEX_SHADER, SAFE_SHADER, testShaderProgram } from '@/lib/glsl';

// When prefers-reduced-motion is on we freeze uTime at a developed frame
// (mid-animation) so the shader still looks rich but holds perfectly still.
const FROZEN_TIME = 8.0;

export function ShaderPlane() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size, gl } = useThree();

  const displayedShader = useShaderStore((s) => s.displayedShader);
  const pendingShader = useShaderStore((s) => s.pendingShader);
  const reportCompilationError = useShaderStore((s) => s.reportCompilationError);

  // Uniforms live in a ref — mutated every frame, never trigger re-renders.
  const uniformsRef = useRef({
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  });

  // The last shader that PASSED validation and is safely on the material.
  // The GPU never receives anything that isn't tracked here.
  const lastValidRef = useRef<string>(SAFE_SHADER);

  // Live prefers-reduced-motion flag.
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    uniformsRef.current.uResolution.value.set(size.width, size.height);
  }, [size.width, size.height]);

  /**
   * The ONLY path by which a fragment shader reaches the material.
   * Validates (compile + link) against the renderer's own GL context and
   * assigns to the material ONLY on success. On failure the material is left
   * untouched — it keeps the last valid shader. Always.
   */
  const applyShader = useCallback(
    (glsl: string): string | null => {
      const rawGL = gl.getContext() as WebGLRenderingContext | WebGL2RenderingContext;
      const error = testShaderProgram(rawGL, glsl);
      if (error) return error; // never assign an invalid shader to the GPU

      if (matRef.current) {
        matRef.current.fragmentShader = glsl;
        matRef.current.needsUpdate = true; // force program recompile
      }
      lastValidRef.current = glsl;
      return null;
    },
    [gl],
  );

  // Validate the DEFAULT shader on mount — it used to bypass validation and go
  // straight to the material. If it ever fails, fall back to SAFE_SHADER.
  useEffect(() => {
    const err = applyShader(displayedShader);
    if (err) {
      console.warn('[Shade.ai] default shader failed validation — using safe fallback.');
      applyShader(SAFE_SHADER);
    }
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Incoming generated / auto-fixed shader.
  useEffect(() => {
    if (!pendingShader) return;
    const err = applyShader(pendingShader);
    if (err) {
      // Real compile/link error → fire the correction loop.
      reportCompilationError(err);
    } else {
      // Valid → promote to displayedShader + history.
      applyCompiledShader(pendingShader);
    }
  }, [pendingShader, applyShader, reportCompilationError]);

  // History selection: displayedShader changed without going through pending.
  useEffect(() => {
    if (displayedShader === lastValidRef.current) return; // already on material
    const err = applyShader(displayedShader);
    if (err) {
      console.warn('[Shade.ai] selected shader failed validation — keeping previous shader.');
    }
  }, [displayedShader, applyShader]);

  useFrame(({ clock, pointer }) => {
    uniformsRef.current.uTime.value = reducedMotionRef.current
      ? FROZEN_TIME
      : clock.getElapsedTime();
    uniformsRef.current.uMouse.value.set((pointer.x + 1) / 2, (pointer.y + 1) / 2);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={SAFE_SHADER}
        uniforms={uniformsRef.current}
      />
    </mesh>
  );
}
