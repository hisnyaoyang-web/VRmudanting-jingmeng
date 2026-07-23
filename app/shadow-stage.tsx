"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ShadowStageProps = {
  playing: boolean;
  cycle: number;
  onComplete: () => void;
  onProgress?: (progress: number, cue: string) => void;
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
      puppet.root.position.set(-3.8, 0.2, 0.25);
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
    const x = time < 2.8
      ? THREE.MathUtils.lerp(-3.8, -0.25, 1 - Math.pow(1 - time / 2.8, 2))
      : time < 9.3
        ? THREE.MathUtils.lerp(-0.25, 1.15, (time - 2.8) / 6.5)
        : THREE.MathUtils.lerp(1.15, 4.4, Math.pow((time - 9.3) / 3.4, 2));
    puppet.root.position.x = x;
    puppet.root.position.y = 0.22 + (time > 7.1 && time < 9.3 ? Math.sin(((time - 7.1) / 2.2) * Math.PI) * 0.75 : 0);
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
    <group ref={group} position={[-3.8, 0.2, 0.25]} rotation={[0, -0.08, 0]}>
      <pointLight position={[0, 1.2, -1]} color="#ff9f43" intensity={15} distance={4.5} />
    </group>
  );
}

function Block({
  position,
  scale,
  color,
  roughness = 0.9,
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  roughness?: number;
}) {
  return (
    <mesh castShadow receiveShadow position={position} scale={scale}>
      <boxGeometry />
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

function MoonGate() {
  const blocks = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    const radius = 1.65;
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      result.push([Math.cos(angle) * radius, Math.sin(angle) * radius + 1.72, 0]);
    }
    return result;
  }, []);

  return (
    <group position={[0.35, -0.05, 0.65]}>
      <Block position={[-2.35, 1.8, 0]} scale={[1.25, 2.25, 0.3]} color="#d8d1bc" />
      <Block position={[2.35, 1.8, 0]} scale={[1.25, 2.25, 0.3]} color="#d8d1bc" />
      <Block position={[0, 3.78, 0]} scale={[1.25, 0.28, 0.3]} color="#d8d1bc" />
      {blocks.map(([x, y, z], index) => (
        <Block key={index} position={[x, y, z - 0.34]} scale={[0.22, 0.22, 0.34]} color="#413d35" />
      ))}
      <Block position={[0, 4.18, 0]} scale={[3.7, 0.18, 0.55]} color="#202526" />
      {[-2.9, -2.3, 2.3, 2.9].map((x) => (
        <Block key={x} position={[x, 4.42, 0]} scale={[0.28, 0.12, 0.7]} color="#14191a" />
      ))}
    </group>
  );
}

function LatticeWindow({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Block position={[0, 0, 0]} scale={[1.35, 1.1, 0.16]} color="#17201f" />
      <Block position={[0, 0, 0.18]} scale={[1.15, 0.92, 0.08]} color="#aa9f82" />
      {[-0.78, -0.39, 0, 0.39, 0.78].map((x) => (
        <Block key={`v${x}`} position={[x, 0, 0.29]} scale={[0.055, 0.86, 0.08]} color="#35271d" />
      ))}
      {[-0.58, -0.29, 0, 0.29, 0.58].map((y) => (
        <Block key={`h${y}`} position={[0, y, 0.3]} scale={[1.05, 0.045, 0.08]} color="#35271d" />
      ))}
    </group>
  );
}

function GardenWorld(props: ShadowStageProps) {
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(0.2, 1.3, 0);
  }, [camera]);

  return (
    <>
      <color attach="background" args={["#071216"]} />
      <fog attach="fog" args={["#071216", 10, 24]} />
      <hemisphereLight args={["#7694a4", "#15211b", 1.4]} />
      <directionalLight position={[-6, 8, 6]} color="#9ac1d0" intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight position={[1.2, 3.1, -3]} target-position={[0, 1.4, 0]} color="#ffad55" intensity={85} angle={0.55} penumbra={0.8} castShadow />

      <Block position={[0, -0.5, 0]} scale={[8.5, 0.35, 7]} color="#27322d" />
      <Block position={[0, -0.12, 1.2]} scale={[5.8, 0.06, 1.7]} color="#172e32" roughness={0.18} />
      {[-4.4, -3.3, -2.2, -1.1, 0, 1.1, 2.2, 3.3, 4.4].map((x, index) => (
        <Block key={x} position={[x, 0.02, 4.25 - Math.abs(index - 4) * 0.1]} scale={[0.48, 0.12, 0.48]} color={index % 2 ? "#6c6555" : "#817764"} />
      ))}

      <MoonGate />
      <LatticeWindow position={[-5.1, 1.6, -1.25]} />
      <LatticeWindow position={[5.05, 1.65, -0.8]} />

      {[-5.7, -4.15, 4.25, 5.8].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Block position={[0, 1.6, 0]} scale={[0.22, 2.1, 0.22]} color="#37251a" />
          <Block position={[0, 3.75, 0]} scale={[0.42, 0.16, 0.42]} color="#ad7a39" />
        </group>
      ))}
      <Block position={[-4.9, 3.72, 0]} scale={[1.9, 0.2, 1]} color="#1b2020" />
      <Block position={[5, 3.72, 0]} scale={[1.9, 0.2, 1]} color="#1b2020" />

      <group position={[-3.6, 0, -1.3]}>
        <Block position={[0, 0.5, 0]} scale={[0.55, 0.7, 0.65]} color="#59625d" />
        <Block position={[0.4, 1.05, 0.15]} scale={[0.4, 0.7, 0.42]} color="#737b71" />
        <Block position={[-0.45, 1.15, -0.08]} scale={[0.32, 0.55, 0.38]} color="#46504b" />
      </group>
      {[[-5.7, 1.2], [-5.2, 0.4], [5.3, -1.3], [4.8, -1.9]].map(([x, z], index) => (
        <group key={index} position={[x, 0, z]}>
          <Block position={[0, 1.05, 0]} scale={[0.08, 1.5, 0.08]} color="#31523d" />
          <Block position={[0.28, 1.42, 0]} scale={[0.06, 1.15, 0.06]} color="#3b6747" />
          <Block position={[-0.23, 1.28, 0.08]} scale={[0.06, 1.25, 0.06]} color="#2f5b3d" />
        </group>
      ))}

      <Block position={[0, 1.55, -2.35]} scale={[5.7, 2.15, 0.18]} color="#d3ccb6" />
      <Block position={[0, 3.8, -2.35]} scale={[6.2, 0.18, 0.55]} color="#191e1f" />
      <pointLight position={[0, 2.2, -1.65]} color="#ff9d43" intensity={24} distance={6} />

      <PiyingPerformer {...props} />
      <ContactShadows position={[0, -0.12, 0.45]} opacity={0.65} scale={10} blur={2.4} far={5} color="#020303" />
      <Sparkles count={38} scale={[11, 5, 7]} size={1.3} speed={0.12} opacity={0.26} color="#f1d09a" />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={7.5}
        maxDistance={14}
        minPolarAngle={0.82}
        maxPolarAngle={1.5}
        minAzimuthAngle={-0.65}
        maxAzimuthAngle={0.65}
        target={[0.2, 1.25, 0]}
      />
    </>
  );
}

export default function ShadowStage(props: ShadowStageProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.45]}
      camera={{ position: [7.6, 3.5, 10.2], fov: 44 }}
      gl={{
        antialias: true,
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      <GardenWorld {...props} />
    </Canvas>
  );
}
