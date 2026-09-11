import * as THREE from 'three';

/** Shared with the home simulator's native follow-camera calibration. */
export const DST_PIXELS_PER_WORLD_UNIT = 160;
export function nativeCameraOffset(distance: number, rotation = -45): THREE.Vector3 {
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(rotation)) throw new Error('Invalid camera settings');
  const progress = THREE.MathUtils.clamp((Math.min(distance, 30) - 15) / 35, 0, 1);
  const pitch = THREE.MathUtils.degToRad(30 + 30 * progress);
  const angle = THREE.MathUtils.degToRad(rotation);
  return new THREE.Vector3(Math.sin(angle) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(angle) * Math.cos(pitch) * distance);
}
export type PreviewBounds = { left: number; top: number; width: number; height: number };
export function billboardMetrics(bounds: PreviewBounds, pixelsPerWorldUnit = DST_PIXELS_PER_WORLD_UNIT, offsetX = 0) {
  if (![bounds.left, bounds.top, bounds.width, bounds.height, pixelsPerWorldUnit, offsetX].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || pixelsPerWorldUnit <= 0) throw new Error('Invalid preview bounds');
  return { x: (bounds.left + bounds.width / 2 + offsetX) / pixelsPerWorldUnit, y: -(bounds.top + bounds.height / 2) / pixelsPerWorldUnit, width: bounds.width / pixelsPerWorldUnit, height: bounds.height / pixelsPerWorldUnit };
}

/** Canvas-backed billboards retain native pixel origins; host owns the animation clock. */
export class DstPreviewScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
  private scene = new THREE.Scene();
  private surfaces = new Map<string, { root: THREE.Group; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; texture: THREE.CanvasTexture }>();
  private lutBytes = new Uint8Array(1024 * 32 * 4);
  private lut = new THREE.DataTexture(this.lutBytes, 1024, 32);
  private graded = false;
  private grid = new THREE.GridHelper(12, 12, 0x72806b, 0x354034);
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#20291f');
    this.scene.add(this.grid);
    this.lut.minFilter = this.lut.magFilter = THREE.LinearFilter;
    this.lut.generateMipmaps = false;
    this.setZoom(1);
  }
  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom) || zoom < .25 || zoom > 8) throw new Error('Invalid zoom');
    const focus = new THREE.Vector3(0, .8, 0);
    this.camera.position.copy(focus).add(nativeCameraOffset(15 / zoom));
    this.camera.lookAt(focus); this.camera.updateMatrixWorld();
    for (const surface of this.surfaces.values()) surface.root.quaternion.copy(this.camera.quaternion);
  }
  setCube(cube: Float32Array | null): void {
    if (cube && (cube.length !== 1024 * 32 * 4 || cube.some(value => !Number.isFinite(value)))) throw new Error('Invalid colour cube');
    this.graded = cube !== null;
    if (cube) { this.lutBytes.set(Uint8Array.from(cube, value => Math.round(Math.max(0, Math.min(255, value))))); this.lut.needsUpdate = true; }
    for (const surface of this.surfaces.values()) surface.mesh.material.uniforms.graded!.value = this.graded;
  }
  setSurface(id: string, canvas: HTMLCanvasElement, bounds: PreviewBounds, options: { opacity?: number; offsetX?: number; visible?: boolean; order?: number; pixelsPerWorldUnit?: number } = {}): void {
    const m = billboardMetrics(bounds, options.pixelsPerWorldUnit, options.offsetX);
    let surface = this.surfaces.get(id);
    if (surface && surface.texture.image !== canvas) { this.removeSurface(id); surface = undefined; }
    if (!surface) {
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
      const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: texture }, cube: { value: this.lut }, graded: { value: this.graded }, opacity: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `uniform sampler2D map; uniform sampler2D cube; uniform bool graded; uniform float opacity; varying vec2 vUv;
          vec3 grade(vec3 c) { vec3 p=clamp(c,0.,1.)*31.; float b=floor(p.b); vec2 uv=vec2((b*32.+p.r+.5)/1024.,(p.g+.5)/32.); vec3 a=texture2D(cube,uv).rgb; uv.x=(min(b+1.,31.)*32.+p.r+.5)/1024.; return mix(a,texture2D(cube,uv).rgb,p.b-b); }
          void main(){vec4 s=texture2D(map,vUv);if(s.a<.001)discard; vec3 c=sRGBTransferOETF(s).rgb; if(graded)c=grade(c);gl_FragColor=sRGBTransferEOTF(vec4(c,s.a*opacity));
          #include <colorspace_fragment>
          }`,
        transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const root = new THREE.Group(); root.add(mesh); this.scene.add(root);
      surface = { root, mesh, texture }; this.surfaces.set(id, surface);
    }
    surface.root.quaternion.copy(this.camera.quaternion);
    surface.mesh.position.set(m.x, m.y, 0);
    surface.mesh.scale.set(m.width, m.height, 1);
    surface.mesh.renderOrder = options.order ?? 1;
    surface.mesh.material.uniforms.opacity!.value = options.opacity ?? 1;
    surface.root.visible = options.visible ?? true;
    surface.texture.needsUpdate = true;
  }
  removeSurface(id: string): void {
    const s = this.surfaces.get(id); if (!s) return;
    this.scene.remove(s.root); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.texture.dispose(); this.surfaces.delete(id);
  }
  render(width: number, height: number): void {
    if (width < 1 || height < 1) return;
    const canvas = this.renderer.domElement;
    if (canvas.clientWidth !== width || canvas.clientHeight !== height || canvas.width !== Math.round(width * this.renderer.getPixelRatio()) || canvas.height !== Math.round(height * this.renderer.getPixelRatio())) this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.render(this.scene, this.camera);
  }
  dispose(): void { for (const id of [...this.surfaces.keys()]) this.removeSurface(id); this.grid.geometry.dispose(); const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]; materials.forEach(m => m.dispose()); this.lut.dispose(); this.renderer.dispose(); }
}
