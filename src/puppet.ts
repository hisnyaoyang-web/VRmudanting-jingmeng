import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type PuppetState = "idle" | "hi" | "walk" | "run" | "flying";

const ASSETS = {
  rig: "/piying/piying-man-rig-hi.glb",
  walk: "/piying/piying-man-walk.glb",
  run: "/piying/piying-man-run.glb",
  flying: "/piying/piying-man-flying.glb",
  atlas: "/piying/yaoling-puppet-atlas.png",
} as const;

/** 人物身高（世界单位），决定屏幕上的大小 */
const TARGET_HEIGHT = 3.4;
const CAMERA_DIST = 9;
/** z=0 平面的可视高度 */
const VIEW_HEIGHT = 2 * CAMERA_DIST * Math.tan(THREE.MathUtils.degToRad(34 / 2));
/** 脚底在画布内的高度占比（与 #puppet-layer 的 bottom 配合对齐地板线） */
const FEET_FRACTION = 0.125;

/**
 * 把动捕 GLB 里的四元数轨道按「静止姿态差值」重定向到主模型骨架。
 * 与参考实现 shadowplay-webspatial / 原项目一致。
 */
function retargetClip(
  clip: THREE.AnimationClip,
  sourceRoot: THREE.Object3D,
  targets: Map<string, THREE.Object3D>,
) {
  const sourceByUuid = new Map<string, THREE.Object3D>();
  sourceRoot.traverse((node) => sourceByUuid.set(node.uuid, node));
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const sep = track.name.lastIndexOf(".");
    if (sep < 0) continue;
    const sourceId = track.name.slice(0, sep);
    const property = track.name.slice(sep + 1);
    if (property !== "quaternion") continue;
    const source = sourceRoot.getObjectByName(sourceId) ?? sourceByUuid.get(sourceId);
    const target = targets.get(source?.name || sourceId);
    if (!source || !target) continue;

    const values = new Float32Array(track.values.length);
    const restInverse = source.quaternion.clone().invert();
    const sourceKey = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const targetKey = new THREE.Quaternion();
    for (let i = 0; i < track.values.length; i += 4) {
      sourceKey.fromArray(track.values, i).normalize();
      delta.copy(restInverse).multiply(sourceKey);
      targetKey.copy(target.quaternion).multiply(delta).normalize();
      targetKey.toArray(values, i);
    }
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        target.uuid + ".quaternion",
        Array.from(track.times),
        Array.from(values),
        track.getInterpolation(),
      ),
    );
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** 皮影材质：暗背光 + 滤色（丢掉绀骨辅助色与纯白） */
function preparePuppetMaterial(material: THREE.Material, texture: THREE.Texture) {
  const m = material as THREE.MeshStandardMaterial;
  m.map = texture;
  m.transparent = true;
  m.opacity = 0.96;
  m.depthWrite = true;
  m.side = THREE.DoubleSide;
  m.roughness = 0.68;
  m.metalness = 0.02;
  m.emissive = new THREE.Color("#8a2a10");
  m.emissiveIntensity = 0.32;
  m.onBeforeCompile = (shader) => {
    const cutoutGLSL = [
      "#include <map_fragment>",
      "float piyingMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));",
      "float piyingMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));",
      "float piyingLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));",
      "bool rigGreen = diffuseColor.g > 0.72 && diffuseColor.r < 0.34 && diffuseColor.b < 0.34;",
      "bool rigYellow = diffuseColor.r > 0.9 && diffuseColor.g > 0.78 && diffuseColor.b < 0.14;",
      "bool editorGrey = piyingLuma > 0.18 && piyingLuma < 0.97 && piyingMax - piyingMin < 0.15;",
      "if (rigGreen || rigYellow || editorGrey || piyingLuma > 0.965) discard;",
    ].join("\n");
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      cutoutGLSL,
    );
  };
  m.customProgramCacheKey = () => "piying-cutout-flat-v1";
  m.needsUpdate = true;
}

/**
 * 皮影人偶渲染器：透明背景的 Three.js 画布，叠在平面场景之上。
 * 模型与动作沿用原 GLB 资源（shadowplay-webspatial）。
 */
export class Puppet {
  readonly group = new THREE.Group();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<PuppetState, THREE.AnimationAction>> = {};
  private model: THREE.Object3D | null = null;
  private current: PuppetState | null = null;
  private facing = 1;
  private flip = 1;
  private baseScaleX = 1;
  private clock = new THREE.Clock();
  private floatY = 0;
  private ready = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    const lookY = VIEW_HEIGHT * (0.5 - FEET_FRACTION);
    this.camera.position.set(0, lookY + 0.15, CAMERA_DIST);
    this.camera.lookAt(0, lookY, 0);

    // 皮影自带的暖光（皮影戏的灯箱背光感）
    const hemi = new THREE.HemisphereLight("#6b4a3a", "#1a0a08", 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight("#ffb070", 1.8);
    dir.position.set(3, 5, 4);
    this.scene.add(dir);
    const back = new THREE.PointLight("#ff7a30", 18, 9, 1.8);
    back.position.set(0, 2.2, -1.5);
    this.scene.add(back);

    this.scene.add(this.group);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };
    onResize();
    window.addEventListener("resize", onResize);
  }

  async load() {
    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    const [rig, walk, run, flying, texture] = await Promise.all([
      loader.loadAsync(ASSETS.rig),
      loader.loadAsync(ASSETS.walk),
      loader.loadAsync(ASSETS.run),
      loader.loadAsync(ASSETS.flying),
      texLoader.loadAsync(ASSETS.atlas),
    ]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;

    const model = rig.scene;
    const targets = new Map<string, THREE.Object3D>();
    model.traverse((child) => {
      if (child.name === "Plane" || child.name.startsWith("a0")) {
        child.visible = false;
        return;
      }
      if (!(child instanceof THREE.Mesh)) {
        if (child.name && !targets.has(child.name)) targets.set(child.name, child);
        return;
      }
      child.frustumCulled = false;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if ("map" in mat) preparePuppetMaterial(mat, texture);
      });
    });

    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.visible) {
        child.geometry.computeBoundingBox();
        if (child.geometry.boundingBox) {
          tmpBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
          box.union(tmpBox);
        }
      }
    });
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = TARGET_HEIGHT / size.y;
    model.position.sub(center);
    model.scale.multiplyScalar(scale);
    model.position.y += (size.y * scale) / 2;

    const hiClip = rig.animations.find((c) => c.name === "piying_man_hi");
    const walkClip = walk.animations.find((c) => c.name === "piying_man_walk");
    const runClip = run.animations.find((c) => c.name === "run");
    const flyingClip = flying.animations.find((c) => c.name === "flying");
    if (!hiClip || !walkClip || !runClip || !flyingClip) {
      throw new Error("piying animation assets incomplete");
    }

    this.mixer = new THREE.AnimationMixer(model);
    const hiAction = this.mixer.clipAction(hiClip, model);
    this.actions = {
      idle: hiAction,
      hi: hiAction,
      walk: this.mixer.clipAction(walkClip, model),
      run: this.mixer.clipAction(retargetClip(runClip, run.scene, targets), model),
      flying: this.mixer.clipAction(retargetClip(flyingClip, flying.scene, targets), model),
    };
    Object.values(this.actions).forEach((a) => a && (a.clampWhenFinished = true));
    this.mixer.addEventListener("finished", () => {
      if (this.current === "hi" || this.current === "flying") this.setState("idle");
    });

    this.group.add(model);
    this.model = model;
    this.baseScaleX = model.scale.x;
    this.setState("idle");
    this.ready = true;
  }

  setState(state: PuppetState, fade = 0.16) {
    if (!this.mixer) return;
    if (this.current === state) return;
    const next = this.actions[state];
    if (!next) return;
    for (const [, a] of Object.entries(this.actions)) {
      if (a && a !== next) a.fadeOut(fade);
    }
    next.reset();
    next.paused = false;
    next.setLoop(state === "walk" || state === "run" ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    if (state === "idle") {
      next.timeScale = 0;
      next.time = 0;
    } else {
      next.timeScale = 1;
    }
    next.fadeIn(fade).play();
    if (state === "idle") this.mixer.update(0.0001);
    this.current = state;
  }

  setFacing(dir: number) {
    this.facing = dir >= 0 ? 1 : -1;
  }

  setMoveRate(speed: number) {
    const walk = this.actions.walk;
    if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / 2.4, 0.6, 1.8);
    const run = this.actions.run;
    if (run) run.timeScale = THREE.MathUtils.clamp(speed / 5.2, 0.55, 1.6);
  }

  setFloatY(y: number) {
    this.floatY = y;
  }

  render() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.mixer) this.mixer.update(dt);
    this.flip = THREE.MathUtils.damp(this.flip, this.facing, 14, dt);
    if (this.model) this.model.scale.x = this.baseScaleX * this.flip;
    this.group.position.y = this.floatY;
    this.renderer.render(this.scene, this.camera);
  }

  get isReady() {
    return this.ready;
  }
}
