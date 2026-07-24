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
  onStrike?: () => void;
};

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

function PiyingPerformer({ playing, cycle, onComplete, onProgress }: ShadowStageProps) {
  const group = useRef<THREE.Group>(null);
  const loaded = useRef<LoadedPuppet | null>(null);
  const elapsed = useRef(0);
  const lastProgressReport = useRef(-1);
  const cueIndex = useRef(-1);
  const completedCycle = useRef(-1);

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

  useFrame((_, delta) => {
    const puppet = loaded.current;
    if (!puppet || !playing) return;
    elapsed.current = Math.min(elapsed.current + delta, SHOW_DURATION);
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

    const progress = time / SHOW_DURATION;
    puppet.mixer.update(delta);
    const reportBucket = Math.floor(time * 10);
    if (reportBucket !== lastProgressReport.current) {
      lastProgressReport.current = reportBucket;
      onProgress?.(progress, CUES[nextCue].label);
    }

    if (time >= SHOW_DURATION && completedCycle.current !== cycle) {
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
      <ambientLight color="#ba8a53" intensity={0.85} />
      <spotLight position={[0, 4.8, 4]} color="#ffb45d" intensity={72} angle={0.68} penumbra={0.9} />

      <mesh position={[0, 1.65, -2.5]} receiveShadow>
        <planeGeometry args={[10.67, 6]} />
        <meshBasicMaterial map={backdrop} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.48, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[13, 9]} />
        <meshStandardMaterial color="#101719" roughness={0.82} />
      </mesh>
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
  const { onStrike } = props;
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
    if (!renderer || !onStrike) return;
    const left = renderer.xr.getController(0);
    const right = renderer.xr.getController(1);
    const strike = () => onStrike();
    left.addEventListener("selectstart", strike);
    right.addEventListener("selectstart", strike);
    return () => {
      left.removeEventListener("selectstart", strike);
      right.removeEventListener("selectstart", strike);
    };
  }, [onStrike, renderer]);

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
        shadows="basic"
        dpr={[1, 1.35]}
        camera={{ position: [0, 2.15, 10.4], fov: 42 }}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        onCreated={({ gl }) => {
          gl.xr.enabled = true;
          setRenderer(gl);
        }}
      >
        <Suspense fallback={null}>
          <GardenWorld {...props} />
        </Suspense>
      </Canvas>
      {xrSupported && !inXr ? (
        <button className="webxr-entry" onClick={enterWebXr}>进入 WebXR</button>
      ) : null}
    </div>
  );
}
