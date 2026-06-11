"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
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

const FALLBACK_HEX = "#b8aa98";
const DISSOLVE_DURATION = 1.4; // 秒

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

// 単色釉も map として扱い、テクスチャ間ディゾルブに一本化する
function makeColorTexture(hex: string | null): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = hex ?? FALLBACK_HEX;
  ctx.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 3D simplex noise (Ashima / webgl-noise, MIT)
const DISSOLVE_PARS = /* glsl */ `
#include <map_pars_fragment>
uniform sampler2D uPrevMap;
uniform float uProgress;

vec3 glzMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 glzMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 glzPermute(vec4 x) { return glzMod289(((x * 34.0) + 1.0) * x); }
vec4 glzTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float glzSnoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = glzMod289(i);
  vec4 p = glzPermute(glzPermute(glzPermute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = glzTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

// 周方向はノイズ空間上の円に写像し、UV の継ぎ目 (u=0/1) で模様が割れないようにする
const DISSOLVE_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 glzNew = texture2D( map, vMapUv );
  vec4 glzOld = texture2D( uPrevMap, vMapUv );
  float glzTheta = vMapUv.x * 6.2831853;
  vec3 glzP = vec3( cos( glzTheta ) * 1.6, sin( glzTheta ) * 1.6, vMapUv.y * 5.0 );
  float glzN = glzSnoise( glzP ) * 0.5 + 0.5;
  glzN = ( glzN + 0.4 * ( glzSnoise( glzP * 3.7 ) * 0.5 + 0.5 ) ) / 1.4;
  float glzEdge = 0.16;
  float glzTh = mix( -glzEdge, 1.0 + glzEdge, uProgress );
  float glzMask = smoothstep( glzTh - glzEdge, glzTh + glzEdge, glzN );
  vec4 sampledDiffuseColor = mix( glzNew, glzOld, glzMask );
  float glzGlow = 1.0 - abs( glzMask * 2.0 - 1.0 );
  sampledDiffuseColor.rgb += glzGlow * 0.15;
  diffuseColor *= sampledDiffuseColor;
#endif
`;

type GlazeUniforms = {
  uPrevMap: { value: THREE.Texture | null };
  uProgress: { value: number };
};

type GlazeTransition = {
  map: THREE.Texture | null;
  uniforms: GlazeUniforms;
};

// 釉薬の変更を検知してテクスチャを読み込み、ディゾルブの進行を駆動する
function useGlazeTransition(
  texturePath: string | null,
  hex: string | null
): GlazeTransition {
  const uniforms = useMemo<GlazeUniforms>(
    () => ({
      uPrevMap: { value: null },
      uProgress: { value: 1 },
    }),
    []
  );
  const [map, setMap] = useState<THREE.Texture | null>(null);
  const mapRef = useRef<THREE.Texture | null>(null);
  const firstRef = useRef(true);
  const rawProgressRef = useRef(1);
  const hexRef = useRef(hex);
  hexRef.current = hex;

  // ディゾルブはテクスチャ⇄単色モードの切り替え時のみ。
  // 単色モード中の hex 変化は下の効果でその場再描画する（リアルタイム反映）
  useEffect(() => {
    let cancelled = false;

    const apply = (tex: THREE.Texture) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      const prev = mapRef.current;
      mapRef.current = tex;
      setMap(tex);
      if (firstRef.current) {
        firstRef.current = false;
        return;
      }
      uniforms.uPrevMap.value?.dispose();
      uniforms.uPrevMap.value = prev;
      rawProgressRef.current = 0;
      uniforms.uProgress.value = 0;
    };

    if (texturePath) {
      new THREE.TextureLoader().load(texturePath, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        apply(t);
      });
    } else {
      apply(makeColorTexture(hexRef.current));
    }

    return () => {
      cancelled = true;
    };
  }, [texturePath, uniforms]);

  useEffect(() => {
    if (texturePath) return;
    const tex = mapRef.current as THREE.CanvasTexture | null;
    if (!tex?.isCanvasTexture) return;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = hex ?? FALLBACK_HEX;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tex.needsUpdate = true;
  }, [hex, texturePath]);

  useEffect(
    () => () => {
      mapRef.current?.dispose();
      uniforms.uPrevMap.value?.dispose();
    },
    [uniforms]
  );

  useFrame((_, delta) => {
    if (rawProgressRef.current >= 1) return;
    const t = Math.min(1, rawProgressRef.current + delta / DISSOLVE_DURATION);
    rawProgressRef.current = t;
    uniforms.uProgress.value = t * t * (3 - 2 * t);
  });

  return { map, uniforms };
}

type MaterialProps = {
  transition: GlazeTransition;
  hex: string | null;
  gloss: number;
  tone: number;
};

function GlazeMaterial({ transition, hex, gloss, tone }: MaterialProps) {
  const { map, uniforms } = transition;
  const params = materialParams(gloss, tone);

  const onBeforeCompile = useMemo(
    () => (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uPrevMap = uniforms.uPrevMap;
      shader.uniforms.uProgress = uniforms.uProgress;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <map_pars_fragment>", DISSOLVE_PARS)
        .replace("#include <map_fragment>", DISSOLVE_MAP_FRAGMENT);
    },
    [uniforms]
  );

  // テクスチャ読み込み前は従来どおり単色マテリアルで表示
  if (!map) {
    const base = new THREE.Color(hex ?? FALLBACK_HEX);
    base.multiply(params.color);
    return <meshPhysicalMaterial key="plain" {...params} color={base} />;
  }

  return (
    <meshPhysicalMaterial
      key="dissolve"
      map={map}
      {...params}
      onBeforeCompile={onBeforeCompile}
      customProgramCacheKey={() => "glaze-dissolve"}
    />
  );
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

  const transition = useGlazeTransition(glaze.texturePath, glaze.hex);
  const mat = {
    transition,
    hex: glaze.hex,
    gloss: glaze.gloss,
    tone: glaze.tone,
  };

  return (
    <group scale={spec.scale} position={[0, (-spec.height * spec.scale) / 2, 0]}>
      <mesh>
        <latheGeometry args={[points, 64]} />
        <GlazeMaterial {...mat} />
      </mesh>

      {shape === "mug" && (
        <mesh position={[0.78, 0.78, 0]}>
          <torusGeometry args={[0.34, 0.075, 16, 40]} />
          <GlazeMaterial {...mat} />
        </mesh>
      )}

      {shape === "plate" && (
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[0.5, 0.52, 0.28, 48, 1, true]} />
          <GlazeMaterial {...mat} />
        </mesh>
      )}

      {shape === "bowl" && (
        <mesh position={[0, 0.05, 0]}>
          <cylinderGeometry args={[0.32, 0.34, 0.12, 48, 1, true]} />
          <GlazeMaterial {...mat} />
        </mesh>
      )}

      {shape === "teapot" && (
        <>
          {/* 蓋 */}
          <mesh position={[0, 1.3, 0]} scale={[1, 0.35, 1]}>
            <sphereGeometry args={[0.45, 32, 16]} />
            <GlazeMaterial {...mat} />
          </mesh>
          {/* つまみ */}
          <mesh position={[0, 1.52, 0]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <GlazeMaterial {...mat} />
          </mesh>
          {/* 注ぎ口 */}
          <mesh position={[1.05, 0.85, 0]} rotation={[0, 0, -0.9]}>
            <cylinderGeometry args={[0.07, 0.15, 0.75, 20]} />
            <GlazeMaterial {...mat} />
          </mesh>
          {/* 持ち手 */}
          <mesh position={[-1.05, 0.75, 0]} rotation={[0, 0, 0.2]}>
            <torusGeometry args={[0.32, 0.06, 14, 36]} />
            <GlazeMaterial {...mat} />
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
