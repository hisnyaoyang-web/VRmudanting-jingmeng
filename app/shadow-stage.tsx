"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

export type MotionPreset = "walk" | "salute" | "spear";

type PuppetProps = {
  playing: boolean;
  cycle: number;
  preset: MotionPreset;
  exploded: boolean;
  onComplete: () => void;
};

const PAPER_DEPTH = 0.055;

function PaperMaterial({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      emissive={color}
      emissiveIntensity={0.2}
      transparent
      opacity={0.88}
      transmission={0.12}
      thickness={0.18}
      roughness={0.64}
      metalness={0.03}
      side={THREE.DoubleSide}
    />
  );
}

function PaperPart({
  size,
  position,
  rotation = [0, 0, 0],
  color = "#a62f22",
  radius = 0.12,
}: {
  size: [number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
  radius?: number;
}) {
  const shape = new THREE.Shape();
  const [w, h] = size;
  const r = Math.min(radius, w / 2, h / 2);
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

  return (
    <mesh castShadow receiveShadow position={position} rotation={rotation}>
      <extrudeGeometry args={[shape, { depth: PAPER_DEPTH, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }]} />
      <PaperMaterial color={color} />
    </mesh>
  );
}

function JointPin({ position = [0, 0, 0] }: { position?: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.055, 0.055, 0.09, 18]} />
      <meshStandardMaterial color="#e3b95f" metalness={0.72} roughness={0.28} />
    </mesh>
  );
}

function ShadowWarrior({ playing, cycle, preset, exploded, onComplete }: PuppetProps) {
  const puppet = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const upperArm = useRef<THREE.Group>(null);
  const foreArm = useRef<THREE.Group>(null);
  const rearArm = useRef<THREE.Group>(null);
  const frontLeg = useRef<THREE.Group>(null);
  const backLeg = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const completedCycle = useRef(-1);

  useFrame(({ clock }, delta) => {
    if (!puppet.current) return;
    puppet.current.rotation.y = THREE.MathUtils.damp(
      puppet.current.rotation.y,
      exploded ? -0.72 : -0.08,
      4,
      delta,
    );
    if (!playing) {
      start.current = null;
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const elapsed = clock.elapsedTime - start.current;
    const duration = preset === "walk" ? 9 : 4.8;
    const t = Math.min(elapsed / duration, 1);
    const beat = Math.sin(t * Math.PI * (preset === "walk" ? 12 : 4));

    if (preset === "walk") {
      puppet.current.position.x = THREE.MathUtils.lerp(-2.8, 2.35, t);
      puppet.current.position.y = -0.38 + Math.abs(beat) * 0.045;
      if (torso.current) torso.current.rotation.z = beat * 0.025;
      if (upperArm.current) upperArm.current.rotation.z = -0.35 + beat * 0.36;
      if (foreArm.current) foreArm.current.rotation.z = 0.55 + beat * 0.16;
      if (rearArm.current) rearArm.current.rotation.z = 0.26 - beat * 0.3;
      if (frontLeg.current) frontLeg.current.rotation.z = beat * 0.34;
      if (backLeg.current) backLeg.current.rotation.z = -beat * 0.34;
    } else if (preset === "salute") {
      puppet.current.position.set(0, -0.38, 0.3);
      if (torso.current) torso.current.rotation.z = Math.sin(t * Math.PI) * 0.08;
      if (upperArm.current) upperArm.current.rotation.z = THREE.MathUtils.lerp(-0.25, 1.05, Math.sin(t * Math.PI));
      if (foreArm.current) foreArm.current.rotation.z = THREE.MathUtils.lerp(0.35, 1.2, Math.sin(t * Math.PI));
      if (rearArm.current) rearArm.current.rotation.z = 0.2;
      if (frontLeg.current) frontLeg.current.rotation.z = 0.08;
      if (backLeg.current) backLeg.current.rotation.z = -0.08;
    } else {
      puppet.current.position.set(0, -0.38, 0.25);
      const strike = Math.sin(Math.min(t * 1.2, 1) * Math.PI);
      if (torso.current) torso.current.rotation.z = -strike * 0.09;
      if (upperArm.current) upperArm.current.rotation.z = -0.5 - strike * 0.75;
      if (foreArm.current) foreArm.current.rotation.z = 0.38 - strike * 0.28;
      if (rearArm.current) rearArm.current.rotation.z = 0.5 + strike * 0.35;
      if (frontLeg.current) frontLeg.current.rotation.z = -strike * 0.28;
      if (backLeg.current) backLeg.current.rotation.z = strike * 0.24;
    }

    if (t >= 1 && completedCycle.current !== cycle) {
      completedCycle.current = cycle;
      onComplete();
    }
  });

  return (
    <group ref={puppet} position={[-2.8, -0.38, 0.22]} scale={0.94}>
      <group ref={torso}>
        <PaperPart size={[0.78, 1.34]} position={[0, 0.72, 0]} color="#a82f22" />
        <PaperPart size={[1.12, 0.35]} position={[0, 1.26, 0.01]} color="#d6a33f" />
        <mesh castShadow position={[0.02, 1.67, 0.025]}>
          <cylinderGeometry args={[0.36, 0.34, PAPER_DEPTH, 24]} />
          <PaperMaterial color="#c56930" />
        </mesh>
        <PaperPart size={[0.13, 0.72]} position={[0.1, 2.04, 0]} rotation={[0, 0, -0.28]} color="#e0b34f" radius={0.04} />
        <PaperPart size={[0.64, 0.22]} position={[-0.18, 1.83, 0.02]} rotation={[0, 0, 0.28]} color="#6d211c" />
      </group>

      <group ref={rearArm} position={[-0.42, 1.2, -0.04]} rotation={[0, 0, 0.2]}>
        <PaperPart size={[0.26, 0.82]} position={[0, -0.36, 0]} color="#7d271f" />
        <JointPin />
      </group>

      <group ref={upperArm} position={[0.43, 1.22, 0.07]} rotation={[0, 0, -0.35]}>
        <PaperPart size={[0.29, 0.86]} position={[0.12, -0.38, 0]} rotation={[0, 0, -0.18]} color="#bb3c25" />
        <JointPin />
        <group ref={foreArm} position={[0.25, -0.77, 0.03]} rotation={[0, 0, 0.55]}>
          <PaperPart size={[0.23, 0.82]} position={[0, -0.37, 0]} color="#d58a35" />
          <JointPin />
          <mesh castShadow position={[0.62, -0.88, 0.01]} rotation={[0, 0, -0.9]}>
            <cylinderGeometry args={[0.026, 0.026, 3.15, 10]} />
            <meshStandardMaterial color="#35170f" roughness={0.85} />
          </mesh>
          <mesh castShadow position={[1.86, -1.67, 0.01]} rotation={[0, 0, -0.9]}>
            <coneGeometry args={[0.12, 0.45, 4]} />
            <meshStandardMaterial color="#c8a75c" metalness={0.72} roughness={0.25} />
          </mesh>
        </group>
      </group>

      <group ref={backLeg} position={[-0.22, 0.09, -0.03]}>
        <PaperPart size={[0.31, 0.98]} position={[0, -0.43, 0]} color="#76241e" />
        <PaperPart size={[0.55, 0.2]} position={[0.12, -0.92, 0]} color="#592019" />
        <JointPin />
      </group>
      <group ref={frontLeg} position={[0.22, 0.09, 0.04]}>
        <PaperPart size={[0.31, 0.98]} position={[0, -0.43, 0]} color="#c37730" />
        <PaperPart size={[0.55, 0.2]} position={[0.12, -0.92, 0]} color="#8a341f" />
        <JointPin />
      </group>
    </group>
  );
}

function Theater(props: PuppetProps) {
  return (
    <>
      <color attach="background" args={["#090605"]} />
      <fog attach="fog" args={["#090605", 8, 15]} />
      <ambientLight intensity={0.34} />
      <pointLight position={[0, 1.1, -2.8]} color="#ffc66d" intensity={52} distance={9} castShadow />
      <spotLight position={[-3.5, 4.2, 4]} color="#c44c2d" intensity={28} angle={0.48} penumbra={0.75} castShadow />

      <mesh receiveShadow position={[0, 0.45, -0.72]}>
        <boxGeometry args={[7.4, 4.7, 0.12]} />
        <meshPhysicalMaterial color="#efd59b" emissive="#df9c3e" emissiveIntensity={0.14} transparent opacity={0.74} transmission={0.32} thickness={0.2} roughness={0.9} />
      </mesh>
      <mesh receiveShadow position={[0, -1.95, 0.2]}>
        <boxGeometry args={[8.2, 0.25, 3.4]} />
        <meshStandardMaterial color="#27100c" roughness={0.88} />
      </mesh>
      <mesh castShadow position={[0, 2.78, -0.1]}>
        <boxGeometry args={[8.35, 0.48, 0.8]} />
        <meshStandardMaterial color="#551711" roughness={0.7} />
      </mesh>
      {[-3.45, 3.45].map((x) => (
        <group key={x} position={[x, 0.28, -0.08]}>
          <mesh castShadow><cylinderGeometry args={[0.19, 0.25, 5.05, 12]} /><meshStandardMaterial color="#3b140f" roughness={0.64} /></mesh>
          {[-2, -1, 0, 1, 2].map((y) => <mesh key={y} castShadow position={[0, y, 0]}><torusGeometry args={[0.25, 0.045, 8, 18]} /><meshStandardMaterial color="#a04b28" /></mesh>)}
        </group>
      ))}
      <ShadowWarrior {...props} />
      <ContactShadows position={[0, -1.8, 0.1]} opacity={0.76} scale={8} blur={2.2} far={4} color="#160604" />
      <OrbitControls makeDefault enablePan={false} minDistance={5.8} maxDistance={10.5} minPolarAngle={0.9} maxPolarAngle={1.85} target={[0, 0.35, 0]} />
    </>
  );
}

export default function ShadowStage(props: PuppetProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [0.25, 0.35, 8.2], fov: 43 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <Theater {...props} />
    </Canvas>
  );
}
