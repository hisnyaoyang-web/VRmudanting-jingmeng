
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ShadowStageProps = {
  playing: boolean;
  cycle: number;
  onComplete: () => void;
  onProgress?: (progress: number, cue: string) => void;
  onXrCommand?: (command: PuppetCommand) => void;
  onXrPrimary?: () => void;
  onXrSessionChange?: (active: boolean, completed?: boolean) => void;
  onXrSupportChange?: (supported: boolean) => void;
  xrActive?: boolean;
  xrHud?: {
    phase: "intro" | "performance" | "outro";
    title: string;
    speaker: string;
    text: string;
    score: number;
    combo: number;
    judgment: string;
    grade: string;
    difficulty: string;
    nextCue: string;
  };
  durationMs?: number;
  clockRef?: MutableRefObject<number>;
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

const XR_RHYTHM_CUES = [
  { atMs: 4800, lane: 4, key: "J", color: "#f1c36f" },
  { atMs: 7800, lane: 3, key: "D", color: "#7eb7a1" },
  { atMs: 11200, lane: 5, key: "K", color: "#c55a38" },
  { atMs: 14100, lane: 6, key: "L", color: "#d596d8" },
  { atMs: 17300, lane: 1, key: "A", color: "#7eb7a1" },
  { atMs: 19700, lane: 4, key: "J", color: "#f1c36f" },
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

function PiyingPerformer({ playing, cycle, onComplete, onProgress, puppetInput, durationMs, clockRef }: ShadowStageProps) {
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
      // 放大到接近主线任务皮影（#puppet-layer 高度 64vh）的视觉占比
      model.scale.multiplyScalar(5.5 / Math.max(size.x, size.y));

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
      actions.walk.setLoop(THREE.LoopRepeat, Infinity).play();
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
      puppet.root.position.set(0, 1.35, 0);
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
    puppet.root.position.y = THREE.MathUtils.lerp(puppet.root.position.y, 1.35 + targetPosition.current.y, follow);
    if (!playing) return;
    const showDuration = (durationMs ?? SHOW_DURATION * 1000) / 1000;
    elapsed.current = clockRef
      ? Math.min(clockRef.current / 1000, showDuration)
      : Math.min(elapsed.current + delta, showDuration);
    const time = elapsed.current;
    let nextCue = 0;
    for (let index = 0; index < CUES.length; index += 1) {
      if (time >= CUES[index].at) nextCue = index;
    }
    cueIndex.current = nextCue;

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

  useEffect(() => {
    const controllers = [gl.xr.getController(0), gl.xr.getController(1)];
    const colors = ["#69b8ac", "#d48762"];
    const hands = controllers.map((controller, index) => {
      const hand = new THREE.Group();
      const grip = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.035, 0.11, 4, 8),
        new THREE.MeshStandardMaterial({
          color: colors[index],
          emissive: colors[index],
          emissiveIntensity: 0.45,
          roughness: 0.5,
        }),
      );
      grip.rotation.x = Math.PI / 2;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.002, 0.7, 6),
        new THREE.MeshBasicMaterial({
          color: colors[index],
          transparent: true,
          opacity: 0.45,
          toneMapped: false,
        }),
      );
      beam.rotation.x = Math.PI / 2;
      beam.position.z = -0.38;
      hand.add(grip, beam);
      controller.add(hand);
      return hand;
    });
    return () => controllers.forEach((controller, index) => {
      controller.remove(hands[index]);
      hands[index].traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      });
    });
  }, [gl]);

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

function CanvasLabel({
  text,
  position,
  width,
  height,
  fontSize = 58,
  color = "#f3dfb2",
  background = "rgba(6, 16, 18, 0.82)",
}: {
  text: string;
  position: [number, number, number];
  width: number;
  height: number;
  fontSize?: number;
  color?: string;
  background?: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.max(128, Math.round(1024 * height / width));
    const context = canvas.getContext("2d");
    if (!context) return new THREE.CanvasTexture(canvas);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(213, 172, 101, .5)";
    context.lineWidth = 5;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `${fontSize}px "Noto Serif SC", "Songti SC", serif`;
    const lines = text.split("\n").slice(0, 4);
    const lineHeight = fontSize * 1.35;
    const firstY = canvas.height / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => context.fillText(line.slice(0, 34), canvas.width / 2, firstY + index * lineHeight));
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.minFilter = THREE.LinearFilter;
    result.needsUpdate = true;
    return result;
  }, [background, color, fontSize, height, text, width]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function XrStageHud({ hud, active }: { hud?: ShadowStageProps["xrHud"]; active?: boolean }) {
  if (!hud || !active) return null;
  const header = `${hud.title} · ${hud.difficulty}`;
  const status = hud.phase === "performance"
    ? `得分 ${hud.score}   连击 ${hud.combo}${hud.judgment ? `   ${hud.judgment}` : ""}`
    : hud.phase === "outro" ? `一折既终 · ${hud.grade}` : "客人上场";
  const prompt = hud.phase === "performance"
    ? `${hud.nextCue || "听拍候场"}\n摇杆移动 · 左扳机见礼 · 右扳机飞袖 · 握键疾行`
    : `${hud.speaker}\n${hud.text}\n扳机继续`;

  return (
    <group>
      <CanvasLabel text={header} position={[0, 3.65, -4.7]} width={4.8} height={0.46} fontSize={42} />
      <CanvasLabel
        text={status}
        position={[0, 3.1, -4.55]}
        width={3.8}
        height={0.48}
        fontSize={46}
        color={hud.judgment ? "#ffd277" : "#f3dfb2"}
      />
      <CanvasLabel
        text={prompt}
        position={[0, 0.58, -2.15]}
        width={4.6}
        height={0.82}
        fontSize={36}
        background="rgba(5, 12, 14, 0.82)"
      />
    </group>
  );
}

const XR_LANE_COLORS = ["#68b3a3", "#77a6d7", "#7dc6b7", "#e2b85f", "#dc875d", "#c478a7", "#9678c7"];
const XR_HIT_Z = -1.55;
const XR_FAR_Z = -14.5;
const xrLaneX = (lane: number) => (lane - 3) * 0.62;
const xrLaneY = (lane: number) => 1.32 + Math.abs(lane - 3) * 0.075;

function XrRhythmWorld({
  active,
  playing,
  clockRef,
}: {
  active: boolean;
  playing: boolean;
  clockRef: MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const listener = useMemo(() => new THREE.AudioListener(), []);
  const audioStart = useRef<number | null>(null);
  const notes = useRef<Array<THREE.Mesh | null>>([]);
  const hitRings = useRef<Array<THREE.Mesh | null>>([]);
  const speedBars = useRef<Array<THREE.Mesh | null>>([]);
  const played = useRef(new Set<number>());
  const lastBeat = useRef(-1);

  useEffect(() => {
    camera.add(listener);
    return () => {
      camera.remove(listener);
      listener.context.suspend().catch(() => undefined);
    };
  }, [camera, listener]);

  useEffect(() => {
    if (!active || !playing) {
      audioStart.current = null;
      clockRef.current = 0;
      return;
    }
    const context = listener.context;
    void context.resume();
    audioStart.current = context.currentTime + 0.12;
    clockRef.current = 0;
    played.current = new Set();
    lastBeat.current = -1;
  }, [active, clockRef, listener, playing]);

  const pulseBeat = useCallback((beat: number) => {
    const context = listener.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2;
    panner.positionX.value = beat % 2 ? 3.2 : -3.2;
    panner.positionY.value = 2.1;
    panner.positionZ.value = 0;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(beat % 4 === 0 ? 92 : 128, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(beat % 4 === 0 ? 0.075 : 0.04, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(panner).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.14);
  }, [listener]);

  const strike = useCallback((lane: number, index: number) => {
    if (played.current.has(index)) return;
    played.current.add(index);
    const context = listener.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const panner = context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.5;
    panner.maxDistance = 16;
    panner.positionX.value = xrLaneX(lane);
    panner.positionY.value = xrLaneY(lane);
    panner.positionZ.value = XR_HIT_Z;
    oscillator.type = index % 3 === 0 ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(index % 3 === 0 ? 240 : 360 + lane * 18, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(120, context.currentTime + 0.2);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.17, context.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    oscillator.connect(gain).connect(panner).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.27);
  }, [listener]);

  useFrame(() => {
    if (!active || !playing || audioStart.current === null) return;
    const timeMs = Math.max(0, (listener.context.currentTime - audioStart.current) * 1000);
    clockRef.current = timeMs;
    const beat = Math.floor(timeMs / 600);
    if (beat !== lastBeat.current) {
      lastBeat.current = beat;
      pulseBeat(beat);
    }
    XR_RHYTHM_CUES.forEach((cue, index) => {
      const delta = cue.atMs - timeMs;
      const progress = THREE.MathUtils.clamp(1 - delta / 3200, 0, 1.14);
      const note = notes.current[index];
      if (note) {
        note.visible = delta <= 3200 && delta >= -420;
        const laneX = xrLaneX(cue.lane);
        note.position.set(
          THREE.MathUtils.lerp(laneX * 0.32, laneX, progress),
          THREE.MathUtils.lerp(1.58, xrLaneY(cue.lane), progress),
          THREE.MathUtils.lerp(XR_FAR_Z, XR_HIT_Z, progress),
        );
        note.rotation.y += 0.018;
        note.rotation.z += 0.012;
        note.scale.setScalar(Math.abs(delta) < 170 ? 1.38 : 1);
      }
      const ring = hitRings.current[cue.lane];
      if (ring) ring.scale.setScalar(Math.abs(delta) < 170 ? 1.25 : 1);
      if (delta <= 0 && delta > -160) strike(cue.lane, index);
    });
    speedBars.current.forEach((bar, index) => {
      if (!bar) return;
      const phase = ((timeMs * 0.0048 + index * 2.05) % 13);
      bar.position.z = XR_FAR_Z + phase;
      const approach = THREE.MathUtils.clamp((bar.position.z - XR_FAR_Z) / (XR_HIT_Z - XR_FAR_Z), 0, 1);
      bar.scale.x = THREE.MathUtils.lerp(0.34, 1, approach);
      const material = bar.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.lerp(0.12, 0.58, approach);
    });
  }, -1);

  if (!active) return null;
  return (
    <group>
      <mesh position={[0, 0.04, -7.8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[6.2, 14.6]} />
        <meshBasicMaterial color="#061215" transparent opacity={0.62} depthWrite={false} />
      </mesh>
      {Array.from({ length: 7 }, (_, lane) => {
        const nearX = xrLaneX(lane);
        const farX = nearX * 0.32;
        const deltaX = farX - nearX;
        const deltaZ = XR_FAR_Z - XR_HIT_Z;
        const length = Math.hypot(deltaX, deltaZ);
        return (
          <mesh
            key={`rail-${lane}`}
            position={[(nearX + farX) / 2, 0.12, (XR_HIT_Z + XR_FAR_Z) / 2]}
            rotation={[0, Math.atan2(deltaX, deltaZ), 0]}
          >
            <boxGeometry args={[0.026, 0.025, length]} />
            <meshBasicMaterial
              color={XR_LANE_COLORS[lane]}
              transparent
              opacity={0.5}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      {Array.from({ length: 7 }, (_, index) => (
        <mesh
          key={`speed-${index}`}
          ref={(value) => { speedBars.current[index] = value; }}
          position={[0, 0.13, XR_FAR_Z + index * 1.8]}
        >
          <boxGeometry args={[5.2, 0.018, 0.045]} />
          <meshBasicMaterial color="#d9b468" transparent opacity={0.2} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 1.55, XR_FAR_Z - 0.35]}>
        <ringGeometry args={[0.45, 1.05, 32]} />
        <meshBasicMaterial color="#c78b45" transparent opacity={0.42} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={`light-column-${side}`}>
          <mesh position={[side * 3.7, 2.8, -9.2]}>
            <cylinderGeometry args={[0.025, 0.09, 5.6, 8]} />
            <meshBasicMaterial color="#8d3a2c" transparent opacity={0.5} toneMapped={false} />
          </mesh>
          <pointLight position={[side * 3.7, 1.6, -7.5]} color="#a84c32" intensity={4} distance={5} />
        </group>
      ))}
      {Array.from({ length: 7 }, (_, lane) => (
        <mesh
          key={`ring-${lane}`}
          ref={(value) => { hitRings.current[lane] = value; }}
          position={[xrLaneX(lane), xrLaneY(lane), XR_HIT_Z]}
        >
          <torusGeometry args={[0.22, 0.032, 10, 24]} />
          <meshBasicMaterial
            color={XR_LANE_COLORS[lane]}
            transparent
            opacity={0.88}
            toneMapped={false}
          />
        </mesh>
      ))}
      {XR_RHYTHM_CUES.map((cue, index) => (
        <mesh
          key={`${cue.atMs}-${cue.key}`}
          ref={(value) => { notes.current[index] = value; }}
          visible={false}
        >
          <octahedronGeometry args={[0.24, 0]} />
          <meshStandardMaterial
            color={cue.color}
            emissive={cue.color}
            emissiveIntensity={1.5}
            roughness={0.4}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
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

type AudiencePlacement = {
  position: [number, number, number];
  rotation: [number, number, number];
  tier: number;
};

function AudienceCrowd({ figures }: { figures: AudiencePlacement[] }) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null);
  const leftEyes = useRef<THREE.InstancedMesh>(null);
  const rightEyes = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const bodyMesh = bodies.current;
    const headMesh = heads.current;
    const leftEyeMesh = leftEyes.current;
    const rightEyeMesh = rightEyes.current;
    if (!bodyMesh || !headMesh || !leftEyeMesh || !rightEyeMesh) return;
    const root = new THREE.Object3D();
    const part = new THREE.Object3D();
    const matrix = new THREE.Matrix4();
    const colors = ["#182224", "#251a18", "#161b1c"];

    const placePart = (
      target: THREE.InstancedMesh,
      index: number,
      localPosition: [number, number, number],
    ) => {
      part.position.set(...localPosition);
      part.rotation.set(0, 0, 0);
      part.updateMatrix();
      matrix.multiplyMatrices(root.matrix, part.matrix);
      target.setMatrixAt(index, matrix);
    };

    figures.forEach((figure, index) => {
      root.position.set(...figure.position);
      root.rotation.set(...figure.rotation);
      root.updateMatrix();
      placePart(bodyMesh, index, [0, 0.26, 0]);
      placePart(headMesh, index, [0, 0.68, 0]);
      placePart(leftEyeMesh, index, [-0.065, 0.69, 0.15]);
      placePart(rightEyeMesh, index, [0.065, 0.69, 0.15]);
      bodyMesh.setColorAt(index, new THREE.Color(colors[figure.tier % colors.length]));
    });
    [bodyMesh, headMesh, leftEyeMesh, rightEyeMesh].forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
    });
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  }, [figures]);

  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, figures.length]} castShadow>
        <coneGeometry args={[0.32, 0.82, 7]} />
        <meshStandardMaterial vertexColors roughness={0.96} />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, figures.length]} castShadow>
        <sphereGeometry args={[0.17, 10, 8]} />
        <meshStandardMaterial color="#171616" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={leftEyes} args={[undefined, undefined, figures.length]}>
        <sphereGeometry args={[0.018, 6, 5]} />
        <meshBasicMaterial color="#d6a45e" transparent opacity={0.34} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rightEyes} args={[undefined, undefined, figures.length]}>
        <sphereGeometry args={[0.018, 6, 5]} />
        <meshBasicMaterial color="#d6a45e" transparent opacity={0.34} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function RearCurtain() {
  return (
    <group position={[0, 0, 7.4]}>
      <StageBox position={[0, 4.72, 0.2]} scale={[11.8, 0.38, 0.48]} color="#231311" />
      <StageBox position={[0, 4.5, -0.04]} scale={[10.8, 0.12, 0.18]} color="#9a7440" metalness={0.16} />
      {Array.from({ length: 13 }, (_, index) => {
        const x = (index - 6) * 0.78;
        return (
          <mesh key={x} position={[x, 2.24, 0]} scale={[1, 1, 1]} receiveShadow>
            <cylinderGeometry args={[0.46, 0.53, 4.45, 12, 1, true, 0, Math.PI]} />
            <meshStandardMaterial
              color={index % 2 ? "#4e1818" : "#651f1d"}
              emissive="#260706"
              emissiveIntensity={0.12}
              roughness={0.92}
              side={THREE.DoubleSide}
              transparent
              opacity={0.9}
            />
          </mesh>
        );
      })}
      <mesh position={[0, 2.25, -0.08]}>
        <planeGeometry args={[10.3, 4.5]} />
        <meshStandardMaterial
          color="#671e1c"
          emissive="#260706"
          emissiveIntensity={0.15}
          roughness={1}
          transparent
          opacity={0.62}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight position={[0, 2.8, 1.1]} color="#9d3028" intensity={7} distance={5} />
      <group rotation={[0, Math.PI, 0]}>
        <CanvasLabel
          text="帷幕后亦有目光"
          position={[0, 4.02, 0.42]}
          width={3.2}
          height={0.4}
          fontSize={38}
          color="#c99e68"
          background="rgba(31, 8, 8, 0.42)"
        />
      </group>
    </group>
  );
}

function ImmersiveTheatre({ active }: { active?: boolean }) {
  const audience = useMemo(() => {
    const figures: AudiencePlacement[] = [];
    const tiers = [
      { radius: 6.3, y: 0.18, count: 15 },
      { radius: 7.4, y: 0.72, count: 18 },
      { radius: 8.5, y: 1.24, count: 21 },
    ];
    tiers.forEach((tier, tierIndex) => {
      for (let index = 0; index < tier.count; index += 1) {
        // Leave the main stage sightline open and wrap the seats around both sides and rear.
        const angle = THREE.MathUtils.lerp(-Math.PI * 0.47, Math.PI * 0.47, index / (tier.count - 1));
        const x = Math.sin(angle) * tier.radius;
        const z = Math.cos(angle) * tier.radius + 0.35;
        figures.push({
          position: [x, tier.y, z],
          rotation: [0, Math.atan2(-x, -z), 0],
          tier: tierIndex + index,
        });
      }
    });
    return figures;
  }, []);

  if (!active) return null;
  return (
    <group>
      <RearCurtain />
      {[
        { radius: 6.45, y: -0.2, depth: 1.05 },
        { radius: 7.55, y: 0.3, depth: 1.08 },
        { radius: 8.65, y: 0.82, depth: 1.12 },
      ].map((tier) => (
        <mesh
          key={tier.radius}
          position={[0, tier.y, 0.35]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <ringGeometry args={[tier.radius - tier.depth, tier.radius, 64, 1, 0, Math.PI]} />
          <meshStandardMaterial color="#171a1a" roughness={0.94} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <AudienceCrowd figures={audience} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <StageBox
            position={[side * 6.05, 2.15, 3.5]}
            scale={[0.22, 4.8, 7.4]}
            rotation={[0, side * -0.1, 0]}
            color="#291a18"
          />
          <pointLight
            position={[side * 5.4, 3.4, 4.4]}
            color="#b44b31"
            intensity={5}
            distance={4.5}
          />
        </group>
      ))}
      <mesh position={[0, -0.48, 2.6]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[9.5, 64]} />
        <meshStandardMaterial color="#090d0e" roughness={0.98} />
      </mesh>
    </group>
  );
}

function GardenWorld(props: ShadowStageProps) {
  const { camera } = useThree();

  useEffect(() => {
    camera.lookAt(0, 1.35, 0);
  }, [camera]);

  return (
    <>
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

      <ImmersiveTheatre active={props.xrActive} />
      <group position={props.xrActive ? [0, 0, -5.4] : [0, 0, 0]}>
        <PiyingPerformer {...props} />
      </group>
      <XrStageHud hud={props.xrHud} active={props.xrActive} />
      {props.clockRef ? (
        <XrRhythmWorld
          active={Boolean(props.xrActive)}
          playing={props.playing}
          clockRef={props.clockRef}
        />
      ) : null}
      <Sparkles
        count={props.xrActive ? 54 : 24}
        position={props.xrActive ? [0, 3.5, -6] : [0, 0, 0]}
        scale={props.xrActive ? [15, 8, 20] : [9, 4.5, 5]}
        size={1.1}
        speed={0.1}
        opacity={0.22}
        color="#f1d09a"
      />
    </>
  );
}

export default function ShadowStage(props: ShadowStageProps) {
  const { onXrCommand, onXrPrimary, onXrSessionChange, onXrSupportChange, xrHud } = props;
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [inXr, setInXr] = useState(false);
  const xrClock = useRef(0);
  const sessionRef = useRef<XRSession | null>(null);
  const completedInXr = useRef(false);

  useEffect(() => {
    const xr = (navigator as Navigator & {
      xr?: { isSessionSupported: (mode: string) => Promise<boolean> };
    }).xr;
    xr?.isSessionSupported("immersive-vr")
      .then((supported) => {
        setXrSupported(supported);
        onXrSupportChange?.(supported);
      })
      .catch(() => {
        setXrSupported(false);
        onXrSupportChange?.(false);
      });
  }, [onXrSupportChange]);

  useEffect(() => {
    if (!renderer || !onXrCommand) return;
    const left = renderer.xr.getController(0);
    const right = renderer.xr.getController(1);
    const salute = () => onXrPrimary ? onXrPrimary() : onXrCommand("hi");
    const fly = () => onXrCommand("flying");
    const rightSelect = () => xrHud?.phase === "performance" ? fly() : salute();
    const run = () => onXrCommand("run");
    left.addEventListener("selectstart", salute);
    right.addEventListener("selectstart", rightSelect);
    left.addEventListener("squeezestart", run);
    right.addEventListener("squeezestart", run);
    return () => {
      left.removeEventListener("selectstart", salute);
      right.removeEventListener("selectstart", rightSelect);
      left.removeEventListener("squeezestart", run);
      right.removeEventListener("squeezestart", run);
    };
  }, [onXrCommand, onXrPrimary, renderer, xrHud?.phase]);

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
      const xrSession = session as {
        addEventListener(type: "end", listener: () => void, options?: { once?: boolean }): void;
      };
      const onEnd = () => {
        sessionRef.current = null;
        xrClock.current = 0;
        setInXr(false);
        onXrSessionChange?.(false, completedInXr.current);
      };
      xrSession.addEventListener("end", onEnd, { once: true });
      await renderer.xr.setSession(
        session as Parameters<typeof renderer.xr.setSession>[0],
      );
      sessionRef.current = session as XRSession;
      completedInXr.current = false;
      setInXr(true);
      onXrSessionChange?.(true);
    }
  };

  const handleComplete = useCallback(() => {
    completedInXr.current = true;
    props.onComplete();
    const session = sessionRef.current;
    if (session) void session.end();
  }, [props]);

  return (
    <div className="stage-canvas">
      <Canvas
        shadows
        dpr={[1, 1.35]}
        camera={{ position: [0, 2.25, 11.8], fov: 43, near: 0.1, far: 40 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.08,
        }}
        onCreated={({ gl }) => {
          gl.xr.enabled = true;
          gl.xr.setReferenceSpaceType("local-floor");
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          setRenderer(gl);
        }}
      >
        <Suspense fallback={null}>
          <GardenWorld
            {...props}
            xrActive={inXr}
            clockRef={inXr ? xrClock : undefined}
            onComplete={handleComplete}
          />
          <XrInputBridge onCommand={onXrCommand} />
        </Suspense>
      </Canvas>
      {xrSupported && !inXr && xrHud?.phase === "performance" ? (
        <button className="webxr-entry" onClick={enterWebXr}>
          <span aria-hidden="true">◉</span>
          进入 XR 剧场
        </button>
      ) : null}
    </div>
  );
}
