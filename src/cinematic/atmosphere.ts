import * as THREE from 'three';
import gsap from 'gsap';

const vertexShader = `
  uniform float uTime;
  uniform float uProgress;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPosition;
  void main() {
    vec3 p = position;
    float breathing = sin(position.y * 2.4 + uTime * 0.35) * 0.015;
    p += normal * breathing;
    p.x += sin(p.y * 1.8 + uTime * 0.18) * 0.08 * uProgress;
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    vPosition = p;
    vNormal = normalize(normalMatrix * normal);
    vViewPosition = -viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uProgress;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vPosition;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 eye = normalize(vViewPosition);
    float rim = pow(1.0 - abs(dot(n, eye)), 2.5);
    float light = max(dot(n, normalize(vec3(-0.4, 0.7, 1.0))), 0.0);
    float bands = sin(vPosition.y * 13.0 + vPosition.x * 4.0 + uTime * 0.13) * 0.5 + 0.5;
    vec3 teal = vec3(0.23, 0.56, 0.47);
    vec3 cream = vec3(0.85, 0.77, 0.53);
    vec3 color = mix(cream, teal, clamp(vPosition.y * 0.35 + 0.45 + uProgress * 0.35, 0.0, 1.0));
    color *= 0.2 + light * 0.7;
    color += mix(vec3(0.64, 0.90, 0.76), vec3(0.77, 0.95, 0.85), uProgress) * rim * 0.9;
    color += bands * 0.03;
    gl_FragColor = vec4(color, 0.83 + rim * 0.17);
  }
`;

export function createAtmosphere(host: HTMLDivElement, progress: { value: number }, reducedMotion: boolean) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30);
  camera.position.set(0, 0, 6.8);
  const group = new THREE.Group();
  scene.add(group);

  const uniforms = { uTime: { value: 0 }, uProgress: { value: 0 } };
  const geometry = new THREE.TorusKnotGeometry(1.15, 0.13, 220, 16, 2, 3);
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true });
  const knot = new THREE.Mesh(geometry, material);
  knot.rotation.set(-0.3, -0.5, -0.1);
  group.add(knot);

  const orbitGeometry = new THREE.TorusGeometry(1.8, 0.003, 3, 180);
  const orbitMaterial = new THREE.MeshBasicMaterial({ color: 0x8bbaa5, transparent: true, opacity: 0.26 });
  const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial);
  orbit.rotation.set(1.2, -0.4, -0.4);
  group.add(orbit);

  const particleGeometry = new THREE.BufferGeometry();
  const particles = new Float32Array(140 * 3);
  // A fixed seed prevents visual jumps when React remounts the scene in development.
  let seed = 23;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < particles.length; i += 3) {
    const angle = random() * Math.PI * 2;
    const radius = 1.7 + random() * 1.35;
    particles[i] = Math.cos(angle) * radius;
    particles[i + 1] = Math.sin(angle) * radius;
    particles[i + 2] = (random() - 0.5) * 2;
  }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
  const particleMaterial = new THREE.PointsMaterial({ color: 0xc7e3ca, size: 0.012, transparent: true, opacity: 0.4, sizeAttenuation: true });
  const constellation = new THREE.Points(particleGeometry, particleMaterial);
  group.add(constellation);

  let frame = 0;
  let visible = true;
  let disposed = false;
  let contextLost = false;
  let lastTime = 0;
  let sceneTime = 0;
  const pointer = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();
  const pointerMove = (event: PointerEvent) => {
    pointer.set((event.clientX / window.innerWidth - 0.5) * 2, (event.clientY / window.innerHeight - 0.5) * 2);
  };
  const pointerReset = () => pointer.set(0, 0);

  const render = (timestamp: number) => {
    if (disposed || contextLost || !visible || document.hidden) return;
    const delta = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.05) : 0;
    lastTime = timestamp;
    sceneTime += delta;
    const phase = reducedMotion ? 0 : progress.value;
    uniforms.uTime.value = reducedMotion ? 0 : sceneTime;
    uniforms.uProgress.value = phase;
    if (!reducedMotion) pointerCurrent.lerp(pointer, 0.025);
    group.rotation.y = pointerCurrent.x * 0.22 + sceneTime * (reducedMotion ? 0 : 0.035);
    group.rotation.x = pointerCurrent.y * 0.14;
    group.rotation.z = -phase * 0.24;
    camera.position.z = 6.8 - phase * 1.05;
    camera.position.x = pointerCurrent.x * 0.07;
    group.position.y = reducedMotion ? 0 : Math.sin(sceneTime * 0.4) * 0.055;
    material.opacity = 1;
    renderer.render(scene, camera);
  };
  const tick = (time: number) => render(time * 1000);

  const resume = () => {
    window.cancelAnimationFrame(frame);
    gsap.ticker.remove(tick);
    lastTime = 0;
    if (!disposed && !contextLost && visible && !document.hidden) {
      if (reducedMotion) frame = window.requestAnimationFrame(render);
      else gsap.ticker.add(tick);
    }
  };
  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (reducedMotion) resume();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    resume();
  });
  intersectionObserver.observe(host);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    host.dataset.contextLost = 'true';
    window.cancelAnimationFrame(frame);
    gsap.ticker.remove(tick);
  };
  const onContextRestored = () => {
    contextLost = false;
    delete host.dataset.contextLost;
    resume();
  };

  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  document.addEventListener('visibilitychange', resume);
  if (!reducedMotion) {
    window.addEventListener('pointermove', pointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', pointerReset);
  }
  resize();
  resume();

  return {
    dispose() {
      disposed = true;
      window.cancelAnimationFrame(frame);
      gsap.ticker.remove(tick);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('pointermove', pointerMove);
      document.documentElement.removeEventListener('pointerleave', pointerReset);
      document.removeEventListener('visibilitychange', resume);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      for (const resource of [geometry, orbitGeometry, particleGeometry, material, orbitMaterial, particleMaterial]) resource.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
