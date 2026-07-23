"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

type PuppetProps = {
  playing: boolean;
  cycle: number;
  onComplete: () => void;
};

function PuppetPart({
  size,
  position,
  rotation = [0, 0, 0],
  color = "#a62f22",
}: {
  size: [number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}) {
  return (
    <mesh castShadow position={position} rotation={rotation}>
      <boxGeometry args={[size[0], size[1], 0.035]} />
      <meshPhysicalMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.35}
        transparent
        opacity={0.74}
        transmission={0.18}
        thickness={0.12}
        roughness={0.48}
        side={THREE.DoubleSide}
        alphaTest={0.08}
        depthWrite
      />
    </mesh>
  );
}

function ShadowWarrior({ playing, cycle, onComplete }: PuppetProps) {
  const puppet = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const legFront = useRef<THREE.Group>(null);
  const legBack = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const completedCycle = useRef(-1);

  useFrame(({ clock }) => {
    if (!puppet.current) return;
    if (!playing) {
      start.current = null;
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const elapsed = clock.elapsedTime - start.current;
    const t = Math.min(elapsed / 10, 1);
    const x = THREE.MathUtils.lerp(-3.25, 3.2, t);
    const bob = Math.sin(t * Math.PI * 12) * 0.05;
    puppet.current.position.set(x, -0.42 + bob, 0.08);
    puppet.current.rotation.z = Math.sin(t * Math.PI * 3) * 0.035;
    if (arm.current) arm.current.rotation.z = -0.28 + Math.sin(t * Math.PI * 10) * 0.42;
    if (legFront.current) legFront.current.rotation.z = Math.sin(t * Math.PI * 12) * 0.34;
    if (legBack.current) legBack.current.rotation.z = -Math.sin(t * Math.PI * 12) * 0.34;
    if (t >= 1 && completedCycle.current !== cycle) {
      completedCycle.current = cycle;
      onComplete();
    }
  });

  return (
    <group ref={puppet}>
      <PuppetPart size={[0.72, 1.38]} position={[0, 0.68, 0]} color="#9f2d20" />
      <PuppetPart size={[1.02, 0.36]} position={[0, 1.22, 0.01]} color="#c28a36" />
      <mesh castShadow position={[0, 1.63, 0]}>
        <circleGeometry args={[0.36, 20]} />
        <meshPhysicalMaterial
          color="#bf6b32" emissive="#9e351e" emissiveIntensity={0.28}
          transparent opacity={0.78} transmission={0.15}
          roughness={0.55} side={THREE.DoubleSide} depthWrite
        />
      </mesh>
      <PuppetPart size={[0.12, 0.7]} position={[0.1, 2.02, 0]} rotation={[0,0,-0.28]} color="#dbad4c" />
      <group ref={arm} position={[0.42, 1.18, 0]}>
        <PuppetPart size={[0.28, 0.88]} position={[0.26, -0.32, 0]} rotation={[0,0,-0.48]} color="#b43b25" />
        <group position={[0.48, -0.7, 0]} rotation={[0,0,0.62]}>
          <PuppetPart size={[0.22, 0.82]} position={[0, -0.37, 0]} color="#d08a36" />
        </group>
      </group>
      <group ref={legBack} position={[-0.22, 0.05, 0]}>
        <PuppetPart size={[0.3, 0.95]} position={[0, -0.42, 0]} color="#7e281f" />
      </group>
      <group ref={legFront} position={[0.22, 0.05, 0.02]}>
        <PuppetPart size={[0.3, 0.95]} position={[0, -0.42, 0]} color="#bd7130" />
      </group>
      <mesh castShadow position={[0.86, 0.57, 0.01]} rotation={[0,0,-0.98]}>
        <cylinderGeometry args={[0.035, 0.035, 2.7, 8]} />
        <meshStandardMaterial color="#3b1d13" roughness={0.8} />
      </mesh>
    </group>
  );
}

function CarvedPillar({ x }: { x: number }) {
  return (
    <group position={[x, -0.08, 0.72]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.28, 4.25, 10]} />
        <meshStandardMaterial color="#3a140f" roughness={0.62} metalness={0.12} />
      </mesh>
      {[-1.55, -0.72, 0.12, 0.96, 1.78].map((y) => (
        <mesh key={y} castShadow position={[0, y, 0]}>
          <torusGeometry args={[0.27, 0.045, 8, 16]} />
          <meshStandardMaterial color="#a54e27" roughness={0.58} />
        </mesh>
      ))}
    </group>
  );
}

function Theater({ playing, cycle, onComplete }: PuppetProps) {
  return (
    <>
      <color attach="background" args={["#0b0706"]} />
      <ambientLight intensity={0.2} />
      <pointLight position={[0, 1.2, -2.5]} color="#ffc96f" intensity={55} distance={9} castShadow />
      <spotLight position={[0, 4, 4]} color="#b6472b" intensity={18} angle={0.55} penumbra={0.65} />
      <Environment preset="sunset" environmentIntensity={0.18} />

      <mesh receiveShadow position={[0, 0.38, -0.55]}>
        <boxGeometry args={[7.2, 4.55, 0.12]} />
        <meshPhysicalMaterial
          color="#f0d495" emissive="#e4a84c" emissiveIntensity={0.18}
          transparent opacity={0.78} transmission={0.42}
          thickness={0.25} roughness={0.82}
        />
      </mesh>
      <mesh receiveShadow position={[0, -2.02, 0.32]}>
        <boxGeometry args={[7.8, 0.35, 1.55]} />
        <meshStandardMaterial color="#32100d" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 2.62, 0.25]}>
        <boxGeometry args={[8.1, 0.42, 0.72]} />
        <meshStandardMaterial color="#571611" roughness={0.68} />
      </mesh>
      <CarvedPillar x={-2.05} />
      <CarvedPillar x={2.12} />
      <ShadowWarrior playing={playing} cycle={cycle} onComplete={onComplete} />
      <ContactShadows position={[0, -1.82, 0]} opacity={0.72} scale={8} blur={2.4} far={4} color="#1b0805" />
    </>
  );
}

export default function ShadowStage(props: PuppetProps) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [0, 0.25, 8.4], fov: 43 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <Theater {...props} />
    </Canvas>
  );
}
