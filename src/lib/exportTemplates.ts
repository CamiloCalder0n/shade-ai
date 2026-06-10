// Export templates: turn the current fragment shader into ready-to-use code.
// Both targets wire up the same uniforms the generated GLSL expects
// (uTime, uResolution, uMouse) and the NDC fullscreen-quad vertex shader.

const EXPORT_VERTEX_SHADER = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** GLSL never legitimately contains backticks or ${, but if a model ever
 *  emitted one it would break out of the template literal we embed it in. */
function escapeForTemplateLiteral(src: string): string {
  return src.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Self-contained React Three Fiber component. Deps: three, @react-three/fiber. */
export function toR3FComponent(glsl: string): string {
  const frag = escapeForTemplateLiteral(glsl);
  const vert = escapeForTemplateLiteral(EXPORT_VERTEX_SHADER);
  return `'use client';
// Generated with Shade.ai — https://github.com/CamiloCalder0n/shade-ai
// Deps: npm install three @react-three/fiber
import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const FRAGMENT_SHADER = \`${frag}\`;

// Fullscreen NDC quad — bypasses camera matrices entirely.
const VERTEX_SHADER = \`${vert}\`;

function ShaderPlane() {
  const { size } = useThree();
  const uniforms = useRef({
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
  });

  useFrame(({ clock, pointer, size: s }) => {
    uniforms.current.uTime.value = clock.getElapsedTime();
    uniforms.current.uResolution.value.set(s.width, s.height);
    uniforms.current.uMouse.value.set((pointer.x + 1) / 2, (pointer.y + 1) / 2);
  });

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        fragmentShader={FRAGMENT_SHADER}
        vertexShader={VERTEX_SHADER}
        uniforms={uniforms.current}
      />
    </mesh>
  );
}

export default function GeneratedShader() {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ width: '100%', height: '100%' }}
    >
      <ShaderPlane />
    </Canvas>
  );
}
`;
}

/** Standalone HTML file — Three.js from CDN, works by just opening it. */
export function toStandaloneHTML(glsl: string, title = 'Shade.ai shader'): string {
  const frag = escapeForTemplateLiteral(glsl);
  const vert = escapeForTemplateLiteral(EXPORT_VERTEX_SHADER);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- Generated with Shade.ai -->
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  canvas { display: block; }
</style>
</head>
<body>
<script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const fragmentShader = \`${frag}\`;

const vertexShader = \`${vert}\`;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Camera is unused by the NDC vertex shader, but Three requires one to render.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uMouse: { value: new THREE.Vector2(0.5, 0.5) },
};

scene.add(new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ fragmentShader, vertexShader, uniforms }),
));

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('pointermove', (e) => {
  uniforms.uMouse.value.set(
    e.clientX / window.innerWidth,
    1 - e.clientY / window.innerHeight,
  );
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  uniforms.uTime.value = clock.getElapsedTime();
  renderer.render(scene, camera);
});
</script>
</body>
</html>
`;
}
