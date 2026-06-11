"use client";

import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useTexture, ContactShadows } from "@react-three/drei";
import {
  resolveVesselSpec,
  type CustomVessel,
  type VesselShape,
} from "@/lib/vessels";

type GlazeProps = {
  texturePath: string | null;
  hex: string | null;
  gloss: number; // 0-100
  tone: number; // 0-100
};

type MaterialProps = GlazeProps & { flatBottom?: boolean };

function materialParams(gloss: number, tone: number) {
  const brightness = 0.75 + (tone / 100) * 0.5;
  return {
    roughness: 1 - (gloss / 100) * 0.85,
    clearcoat: (gloss / 100) * 0.7,
    clearcoatRoughness: 0.25,
    color: new THREE.Color(brightness, brightness, brightness),
    side: THREE.DoubleSide,
  };
}

function TexturedGlazeMaterial({ texturePath, gloss, tone }: MaterialProps) {
  const texture = useTexture(texturePath as string, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  });
  const params = materialParams(gloss, tone);
  return <meshPhysicalMaterial map={texture} {...params} />;
}

function PlainGlazeMaterial({ hex, gloss, tone }: MaterialProps) {
  const params = materialParams(gloss, tone);
  const base = new THREE.Color(hex ?? "#b8aa98");
  base.multiply(params.color);
  return <meshPhysicalMaterial {...params} color={base} />;
}

function GlazeMaterial(props: MaterialProps) {
  if (props.texturePath) {
    return (
      <Suspense fallback={<PlainGlazeMaterial {...props} texturePath={null} />}>
        <TexturedGlazeMaterial {...props} />
      </Suspense>
    );
  }
  return <PlainGlazeMaterial {...props} />;
}

function Vessel({
  shape,
  custom,
  glaze,
}: {
  shape: VesselShape;
  custom?: CustomVessel | null;
  glaze: GlazeProps;
}) {
  const spec = useMemo(() => resolveVesselSpec(shape, custom), [shape, custom]);

  const points = useMemo(() => {
    const v = spec.profile.map(([x, y]) => new THREE.Vector2(x, y));
    return spec.smooth ? new THREE.SplineCurve(v).getPoints(48) : v;
  }, [spec]);

  return (
    <group scale={spec.scale} position={[0, (-spec.height * spec.scale) / 2, 0]}>
      <mesh>
        <latheGeometry args={[points, 64]} />
        <GlazeMaterial {...glaze} />
      </mesh>

      {shape === "mug" && (
        <mesh position={[0.78, 0.78, 0]}>
          <torusGeometry args={[0.34, 0.075, 16, 40]} />
          <GlazeMaterial {...glaze} />
        </mesh>
      )}

      {shape === "plate" && (
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.5, 0.52, 0.28, 48, 1, true]} />
          <GlazeMaterial {...glaze} />
        </mesh>
      )}

      {shape === "bowl" && (
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.32, 0.34, 0.12, 48, 1, true]} />
          <GlazeMaterial {...glaze} />
        </mesh>
      )}

      {shape === "teapot" && (
        <>
          {/* 蓋 */}
          <mesh position={[0, 1.3, 0]} scale={[1, 0.35, 1]}>
            <sphereGeometry args={[0.45, 32, 16]} />
            <GlazeMaterial {...glaze} />
          </mesh>
          {/* つまみ */}
          <mesh position={[0, 1.52, 0]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <GlazeMaterial {...glaze} />
          </mesh>
          {/* 注ぎ口 */}
          <mesh position={[1.05, 0.85, 0]} rotation={[0, 0, -0.9]}>
            <cylinderGeometry args={[0.07, 0.15, 0.75, 20]} />
            <GlazeMaterial {...glaze} />
          </mesh>
          {/* 持ち手 */}
          <mesh position={[-1.05, 0.75, 0]} rotation={[0, 0, 0.2]}>
            <torusGeometry args={[0.32, 0.06, 14, 36]} />
            <GlazeMaterial {...glaze} />
          </mesh>
        </>
      )}
    </group>
  );
}

export type VesselCanvasProps = {
  shape: VesselShape;
  custom?: CustomVessel | null;
  texturePath: string | null;
  hex: string | null;
  gloss?: number;
  tone?: number;
  autoRotate?: boolean;
};

export default function VesselCanvas({
  shape,
  custom = null,
  texturePath,
  hex,
  gloss = 70,
  tone = 60,
  autoRotate = true,
}: VesselCanvasProps) {
  const spec = resolveVesselSpec(shape, custom);
  const bottomY = (-spec.height * spec.scale) / 2 - 0.02;
  return (
    <Canvas
      className="vessel-canvas"
      dpr={[1, 2]}
      camera={{ position: [0, 0.7, 4.6], fov: 32 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 2]} intensity={2.2} />
      <directionalLight position={[-3, 2, -3]} intensity={0.6} />
      <Vessel
        shape={shape}
        custom={custom}
        glaze={{ texturePath, hex, gloss, tone }}
      />
      <ContactShadows
        position={[0, bottomY, 0]}
        opacity={0.35}
        scale={6}
        blur={2.4}
        far={2}
      />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={autoRotate}
        autoRotateSpeed={1.6}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={(Math.PI * 3) / 4}
      />
    </Canvas>
  );
}
