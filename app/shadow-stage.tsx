"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Sparkles, useTexture } from "@react-three/drei";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ShadowStageProps = {
  playing: boolean;
  cycle: number;
  onComplete: () => void;
  onProgress?: (progress: number, cue: string) => void;
  onXrCommand?: (command: PuppetCommand) => void;
  durationMs?: number;
  puppetInput?: {
    x: number;
    y: number;
    action: PuppetAction;
    nonce: number;
  };
};

export type PuppetAction = "hi" | "run" | "flying" | "walk";
export type PuppetCommand = "left" | "right" | "up" | "down" | PuppetAction;

type LoadedPuppet = {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
};

const SHOW_DURATION = 12.7;
const CUES = [
  { at: 0, name: "walk", label: "穿廊入园" },
  { at: 2.8, name: "hi", label: "月门亮相" },
  { at: 5.3, name: "run", label: "逐影过桥" },
  { at: 7.1, name: "flying", label: "临水飞袖" },
  { at: 9.3, name: "walk", label: "循廊归隐" },
] as const;

function retargetClip(
  clip: THREE.AnimationClip,
  sourceRoot: THREE.Object3D,
  targets: Map<string, THREE.Object3D>,
) {
  const sourceByUuid = new Map<string, THREE.Object3D>();
  sourceRoot.traverse((node) => sourceByUuid.set(node.uuid, node));
  const tracks: THREE.KeyframeTrack[] = [];

  for (const track of clip.tracks) {
    const separator = track.name.lastIndexOf(".");
    if (separator < 0) continue;
    const sourceId = track.name.slice(0, separator);
    const property = track.name.slice(separator + 1);
    if (property !== "quaternion") continue;
    const source = sourceRoot.getObjectByName(sourceId) ?? sourceByUuid.get(sourceId);
    const target = targets.get(source?.name || sourceId);
    if (!source || !target) continue;

    const values = new Float32Array(track.values.length);
    const restInverse = source.quaternion.clone().invert();
    const sourceKey = new THREE.Quaternion();
    const delta = new THREE.Quaternion();
    const targetKey = new THREE.Quaternion();
    for (let index = 0; index < track.values.length; index += 4) {
      sourceKey.fromArray(track.values, index).normalize();
      delta.copy(restInverse).multiply(sourceKey);
      targetKey.copy(target.quaternion).multiply(delta).normalize();
      targetKey.toArray(values, index);
    }
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${target.uuid}.quaternion`,
        Array.from(track.times),
        Array.from(values),
        track.getInterpolation(),
      ),
    );
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function preparePuppetMaterial(material: THREE.Material, texture: THREE.Texture) {
  const mapped = material as THREE.MeshStandardMaterial;
  mapped.map = texture;
  mapped.transparent = true;
  mapped.opacity = 0.94;
  mapped.depthWrite = true;
  mapped.side = THREE.DoubleSide;
  mapped.roughness = 0.72;
  mapped.metalness = 0.02;
  mapped.emissive = new THREE.Color("#7d210f");
  mapped.emissiveIntensity = 0.13;
  mapped.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      float piyingMax = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
      float piyingMin = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
      float piyingLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      bool rigGreen = diffuseColor.g > 0.72 && diffuseColor.r < 0.34 && diffuseColor.b < 0.34;
      bool rigYellow = diffuseColor.r > 0.9 && diffuseColor.g > 0.78 && diffuseColor.b < 0.14;
      bool editorGrey = piyingLuma > 0.18 && piyingLuma < 0.97 && piyingMax - piyingMin < 0.15;
      if (rigGreen || rigYellow || editorGrey || piyingLuma > 0.965) discard;`,
    );
  };
  mapped.customProgramCacheKey = () => "garden-piying-cutout-v1";
  mapped.needsUpdate = true;
}

function PiyingPerformer({ playing, cycle, onComplete, onProgress, puppetInput, durationMs }: ShadowStageProps) {
  const group = useRef<THREE.Group>(null);
  const loaded = useRef<LoadedPuppet | null>(null);
  const elapsed = useRef(0);
  const lastProgressReport = useRef(-1);
  const cueIndex = useRef(-1);
  const completedCycle = useRef(-1);
  const targetPosition = useRef({ x: 0, y: 0 });
  const puppetX = puppetInput?.x;
  const puppetY = puppetInput?.y;
  const puppetAction = puppetInput?.action;
  const puppetNonce = puppetInput?.nonce;

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const textureLoader = new THREE.TextureLoader();

    Promise.all([
      loader.loadAsync("/piying/piying-man-rig-hi.glb"),
      loader.loadAsync("/piying/piying-man-walk.glb"),
      loader.loadAsync("/piying/piying-man-run.glb"),
      loader.loadAsync("/piying/piying-man-flying.glb"),
      textureLoader.loadAsync("/piying/yaoling-puppet-atlas.png"),
    ]).then(([rig, walk, run, flying, texture]) => {
      if (cancelled || !group.current) return;
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
        child.castShadow = false;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if ("map" in material) preparePuppetMaterial(material, texture);
        });
      });

      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      model.scale.multiplyScalar(2.75 / Math.max(size.x, size.y));

      const hiClip = rig.animations.find((clip) => clip.name === "piying_man_hi");
      const walkClip = walk.animations.find((clip) => clip.name === "piying_man_walk");
      const runClip = run.animations.find((clip) => clip.name === "run");
      const flyingClip = flying.animations.find((clip) => clip.name === "flying");
      if (!hiClip || !walkClip || !runClip || !flyingClip) {
        throw new Error("皮影动作资源不完整");
      }

      const mixer = new THREE.AnimationMixer(model);
      const actions = {
        hi: mixer.clipAction(hiClip, model),
        walk: mixer.clipAction(walkClip, model),
        run: mixer.clipAction(retargetClip(runClip, run.scene, targets), model),
        flying: mixer.clipAction(retargetClip(flyingClip, flying.scene, targets), model),
      };
      Object.values(actions).forEach((action) => {
        action.clampWhenFinished = true;
      });

      group.current.add(model);
      loaded.current = { root: group.current, model, mixer, actions };
    }).catch((error) => console.error("皮影加载失败", error));

    return () => {
      cancelled = true;
      loaded.current?.mixer.stopAllAction();
      loaded.current = null;
    };
  }, []);

  useEffect(() => {
    elapsed.current = 0;
    lastProgressReport.current = -1;
    cueIndex.current = -1;
    completedCycle.current = -1;
    const puppet = loaded.current;
    if (puppet) {
      puppet.mixer.stopAllAction();
      puppet.root.position.set(0, 0.2, 0);
    }
  }, [cycle]);

  useEffect(() => {
    if (puppetX === undefined || puppetY === undefined) return;
    targetPosition.current = { x: puppetX, y: puppetY };
  }, [puppetX, puppetY]);

  useEffect(() => {
    const puppet = loaded.current;
    if (!puppet || !puppetAction) return;
    const action = puppet.actions[puppetAction];
    Object.values(puppet.actions).forEach((candidate) => candidate.fadeOut(0.12));
    action.reset();
    action.setLoop(
      puppetAction === "walk" || puppetAction === "run" ? THREE.LoopRepeat : THREE.LoopOnce,
      puppetAction === "walk" || puppetAction === "run" ? Infinity : 1,
    );
    action.fadeIn(0.12).play();
  }, [puppetAction, puppetNonce]);

  useFrame((_, delta) => {
    const puppet = loaded.current;
    if (!puppet) return;
    const follow = 1 - Math.exp(-delta * 12);
    puppet.root.position.x = THREE.MathUtils.lerp(puppet.root.position.x, targetPosition.current.x, follow);
    puppet.root.position.y = THREE.MathUtils.lerp(puppet.root.position.y, 0.2 + targetPosition.current.y, follow);
    if (!playing) return;
    const showDuration = (durationMs ?? SHOW_DURATION * 1000) / 1000;
    elapsed.current = Math.min(elapsed.current + delta, showDuration);
    const time = elapsed.current;
    let nextCue = 0;
    for (let index = 0; index < CUES.length; index += 1) {
      if (time >= CUES[index].at) nextCue = index;
    }
    if (nextCue !== cueIndex.current) {
      const cue = CUES[nextCue];
      Object.values(puppet.actions).forEach((action) => action.fadeOut(0.18));
      const action = puppet.actions[cue.name];
      action.reset();
      action.setLoop(cue.name === "walk" || cue.name === "run" ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.fadeIn(0.18).play();
      cueIndex.current = nextCue;
    }

    const progress = time / showDuration;
    puppet.mixer.update(delta);
    const reportBucket = Math.floor(time * 10);
    if (reportBucket !== lastProgressReport.current) {
      lastProgressReport.current = reportBucket;
      onProgress?.(progress, CUES[nextCue].label);
    }

    if (time >= showDuration && completedCycle.current !== cycle) {
      completedCycle.current = cycle;
      onComplete();
    }
  });

  return (
    <group ref={group} position={[0, 0.2, 0]} rotation={[0, -0.08, 0]}>
      <pointLight position={[0, 1.2, -1]} color="#ff9f43" intensity={15} distance={4.5} />
    </group>
  );
}

function XrInputBridge({ onCommand }: { onCommand?: (command: PuppetCommand) => void }) {
  const { gl } = useThree();
  const lastMove = useRef(0);

  useFrame(({ clock }) => {
    if (!onCommand || clock.elapsedTime - lastMove.current < 0.24) return;
    const session = gl.xr.getSession();
    for (const source of session?.inputSources ?? []) {
      const axes = source.gamepad?.axes;
      if (!axes?.length) continue;
      const x = axes[axes.length - 2] ?? 0;
      const y = axes[axes.length - 1] ?? 0;
      if (Math.abs(x) > 0.55) {
        onCommand(x > 0 ? "right" : "left");
        lastMove.current = clock.elapsedTime;
      } else if (Math.abs(y) > 0.55) {
        onCommand(y > 0 ? "down" : "up");
        lastMove.current = clock.elapsedTime;
      }
    }
  });
  return null;
}

function StageBox({
  position,
  scale,
  color,
  rotation = [0, 0, 0],
  metalness = 0,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  rotation?: [number, number, number];
  metalness?: number;
}) {
  return (
    <mesh position={position} scale={scale} rotation={rotation} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={0.72} metalness={metalness} />
    </mesh>
  );
}

function Lantern({ x }: { x: number }) {
  return (
    <group position={[x, 3.15, 0.7]}>
      <StageBox position={[0, 0.78, 0]} scale={[0.025, 0.78, 0.025]} color="#7c5b31" />
      <mesh castShadow>
        <cylinderGeometry args={[0.23, 0.31, 0.62, 10]} />
        <meshStandardMaterial
          color="#9f321f"
          emissive="#ff6b2d"
          emissiveIntensity={1.15}
          roughness={0.7}
        />
      </mesh>
      <pointLight color="#ff7b32" intensity={7} distance={2.6} decay={2} />
      <StageBox position={[0, -0.45, 0]} scale={[0.035, 0.26, 0.035]} color="#b58a4d" />
    </group>
  );
}

function TheatreStage({ backdrop }: { backdrop: THREE.Texture }) {
  return (
    <group>
      <StageBox position={[0, -0.42, 0]} scale={[11.7, 0.68, 5.1]} color="#171b1b" />
      <StageBox position={[0, -0.05, 2.25]} scale={[11.9, 0.32, 0.56]} color="#6d291f" />
      <StageBox position={[0, -0.12, 2.55]} scale={[10.9, 0.18, 0.68]} color="#b08a4e" metalness={0.12} />
      {[-4.8, -1.6, 1.6, 4.8].map((x) => (
        <StageBox key={x} position={[x, -0.28, 2.58]} scale={[0.065, 0.22, 0.36]} color="#2b1512" />
      ))}

      {[-5.15, 5.15].map((x) => (
        <group key={x}>
          <StageBox position={[x, 2.15, -0.12]} scale={[0.5, 5.1, 0.6]} color="#3c211b" />
          <StageBox position={[x, 2.15, -0.12]} scale={[0.26, 4.84, 0.78]} color="#842e20" />
          <mesh position={[x, 4.78, -0.12]} castShadow>
            <cylinderGeometry args={[0.36, 0.36, 0.24, 8]} />
            <meshStandardMaterial color="#a98248" roughness={0.55} metalness={0.18} />
          </mesh>
        </group>
      ))}

      <StageBox position={[0, 4.58, -0.18]} scale={[10.9, 0.56, 0.84]} color="#3a201a" />
      <StageBox position={[0, 4.47, 0.25]} scale={[9.5, 0.22, 0.22]} color="#b28a4c" metalness={0.12} />
      <StageBox
        position={[0, 5.02, -0.26]}
        scale={[12.1, 0.34, 1.64]}
        rotation={[0.06, 0, 0]}
        color="#101719"
      />
      <StageBox position={[0, 5.18, -0.62]} scale={[10.9, 0.22, 1.24]} color="#24302e" />
      {[-5.75, -3.45, -1.15, 1.15, 3.45, 5.75].map((x) => (
        <StageBox
          key={x}
          position={[x, 4.93, 0.45]}
          scale={[0.5, 0.11, 1.05]}
          rotation={[0, 0, x < 0 ? -0.08 : 0.08]}
          color="#111819"
        />
      ))}

      <mesh position={[0, 2.08, -2.42]} receiveShadow>
        <planeGeometry args={[9.6, 5.4]} />
        <meshBasicMaterial map={backdrop} toneMapped={false} />
      </mesh>
      <StageBox position={[-4.95, 2.15, -2.25]} scale={[0.32, 4.9, 0.36]} color="#b18a50" />
      <StageBox position={[4.95, 2.15, -2.25]} scale={[0.32, 4.9, 0.36]} color="#b18a50" />

      <group position={[-5.2, 1.9, 0.85]} rotation={[0, -0.2, 0]}>
        <StageBox position={[0, 0, 0]} scale={[0.84, 4.2, 2.4]} color="#401d19" />
        <StageBox position={[0.43, 0, 0]} scale={[0.07, 4, 2.24]} color="#a23b29" />
      </group>
      <group position={[5.2, 1.9, 0.85]} rotation={[0, 0.2, 0]}>
        <StageBox position={[0, 0, 0]} scale={[0.84, 4.2, 2.4]} color="#401d19" />
        <StageBox position={[-0.43, 0, 0]} scale={[0.07, 4, 2.24]} color="#a23b29" />
      </group>

      <Lantern x={-4.1} />
      <Lantern x={4.1} />
    </group>
  );
}

function GardenWorld(props: ShadowStageProps) {
  const { camera } = useThree();
  const backdrop = useTexture("/stage/moongate-backdrop.webp");

  useEffect(() => {
    camera.lookAt(0, 1.35, 0);
  }, [camera]);

  return (
    <>
      <color attach="background" args={["#050b0d"]} />
      <fog attach="fog" args={["#050b0d", 9, 18]} />
      <ambientLight color="#9e8060" intensity={0.62} />
      <hemisphereLight args={["#6f8790", "#17100c", 0.65]} />
      <directionalLight
        position={[-4, 7, 5]}
        color="#ffd08a"
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={6}
        shadow-camera-bottom={-2}
      />
      <spotLight position={[0, 5.4, 4]} color="#ffb45d" intensity={62} angle={0.58} penumbra={0.88} castShadow />

      <TheatreStage backdrop={backdrop} />
      <mesh position={[0, 1.6, -2.25]}>
        <planeGeometry args={[8.8, 4.95]} />
        <meshPhysicalMaterial color="#f4c77d" transparent opacity={0.075} roughness={1} transmission={0.12} />
      </mesh>

      <PiyingPerformer {...props} />
      <ContactShadows position={[0, -0.12, 0.45]} opacity={0.65} scale={10} blur={2.4} far={5} color="#020303" />
      <Sparkles count={24} scale={[9, 4.5, 5]} size={1.1} speed={0.1} opacity={0.22} color="#f1d09a" />
    </>
  );
}

export default function ShadowStage(props: ShadowStageProps) {
  const { onXrCommand } = props;
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [inXr, setInXr] = useState(false);

  useEffect(() => {
    const xr = (navigator as Navigator & {
      xr?: { isSessionSupported: (mode: string) => Promise<boolean> };
    }).xr;
    xr?.isSessionSupported("immersive-vr").then(setXrSupported).catch(() => setXrSupported(false));
  }, []);

  useEffect(() => {
    if (!renderer || !onXrCommand) return;
    const left = renderer.xr.getController(0);
    const right = renderer.xr.getController(1);
    const salute = () => onXrCommand("hi");
    const fly = () => onXrCommand("flying");
    const run = () => onXrCommand("run");
    left.addEventListener("selectstart", salute);
    right.addEventListener("selectstart", fly);
    left.addEventListener("squeezestart", run);
    right.addEventListener("squeezestart", run);
    return () => {
      left.removeEventListener("selectstart", salute);
      right.removeEventListener("selectstart", fly);
      left.removeEventListener("squeezestart", run);
      right.removeEventListener("squeezestart", run);
    };
  }, [onXrCommand, renderer]);

  const enterWebXr = async () => {
    if (!renderer) return;
    const xr = (navigator as Navigator & {
      xr?: { requestSession: (mode: string, options?: object) => Promise<unknown> };
    }).xr;
    if (!xr) return;
    const session = await xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
    });
    if (session) {
      await renderer.xr.setSession(
        session as Parameters<typeof renderer.xr.setSession>[0],
      );
    }
    setInXr(true);
  };

  return (
    <div className="stage-canvas">
      <Canvas
        shadows
        dpr={[1, 1.35]}
        camera={{ position: [0, 2.25, 11.8], fov: 43, near: 0.1, far: 40 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.08,
        }}
        onCreated={({ gl }) => {
          gl.xr.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          setRenderer(gl);
        }}
      >
        <Suspense fallback={null}>
          <GardenWorld {...props} />
          <XrInputBridge onCommand={onXrCommand} />
        </Suspense>
      </Canvas>
      {xrSupported && !inXr ? (
        <button className="webxr-entry" onClick={enterWebXr}>进入 WebXR</button>
      ) : null}
    </div>
  );
}
