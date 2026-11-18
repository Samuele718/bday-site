/* cake3d.js — 3D 生日蛋糕 (three.js)
   设计基线（静华·静奢）: 单色奶油、极简装饰、暖金烛火、缓慢自转 */
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const CREAM = 0xf7efe2;
const CREAM_DEEP = 0xe8d9c3;
const BERRY = 0x8c2f39;
const GOLD = 0xd4a574;
/* 分层的第二种奶油：极淡的蜜桃粉，与米白形成层次而非撞色 */
const CREAM_PINK = 0xf0c9bd;
const CREAM_SAGE = 0xd2dcc2;
const SPRINKLE_COLS = [0xd98f9b, 0x8fa5b8, 0xd9b06e, 0x9db08a, 0xc98a6e, 0xe8dcc4];

let renderer, scene, camera, controls, cakeGroup, raf = 0;
let flames = [], candleLights = [], running = false;
let extinguished = false, resizeHandler = null;
const clock = new THREE.Clock();
const FLAME_VERT = `uniform float uTime;
uniform float uStrength;
varying float vH;
varying vec2 vUv;
float rnd(vec2 st){ return fract(sin(dot(st.xy, vec2(12.9898,78.233)))*43758.5453123); }
float noise(vec2 st){
  vec2 i=floor(st), f=fract(st);
  float a=rnd(i), b=rnd(i+vec2(1.,0.)), c=rnd(i+vec2(0.,1.)), d=rnd(i+vec2(1.,1.));
  vec2 u=f*f*(3.-2.*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
}
void main(){
  vUv = uv;
  vec3 pos = position;
  float s = uStrength;
  /* 水滴形：底部鼓、中段收、顶部尖 */
  float hh = clamp(position.y, 0.0, 1.0);
  float waist = mix(1.0, 0.34, smoothstep(0.10, 1.0, hh));
  pos.xz *= waist;
  pos *= vec3(0.80, 1.58 * s, 0.80);
  vH = position.y;
  float len = length(position.xz);
  pos.y *= 1.0 + (cos((len + 0.25) * 3.1415926) * 0.22
                + noise(vec2(0.0, uTime)) * 0.10
                + noise(vec2(position.x + uTime, position.z + uTime)) * 0.42) * position.y * s;
  pos.x += noise(vec2(uTime * 1.7, (position.y - uTime) * 3.6)) * vH * 0.030 * s;
  pos.z += noise(vec2((position.y - uTime) * 3.6, uTime * 1.7)) * vH * 0.030 * s;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;
const FLAME_FRAG = `varying float vH;
varying vec2 vUv;
void main(){
  float t = clamp(vH, 0.0, 1.0);
  vec3 core = vec3(1.0, 0.97, 0.86);
  vec3 mid  = vec3(1.0, 0.78, 0.36);
  vec3 edge = vec3(0.95, 0.52, 0.14);
  vec3 col = mix(core, mid, smoothstep(0.05, 0.55, t));
  col = mix(col, edge, smoothstep(0.55, 1.0, t));
  float side = smoothstep(0.0, 0.45, 1.0 - abs(vUv.x - 0.5) * 2.0);
  col = mix(edge, col, side);
  float a = smoothstep(1.0, 0.62, t);
  a *= smoothstep(0.0, 0.08, vUv.y);
  gl_FragColor = vec4(col, a * 0.95);
}`;

function makeFlame() {
  const geo = new THREE.SphereGeometry(0.5, 24, 32);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uStrength: { value: 1 } },
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(0.30, 0.255, 0.30);
  return m;
}

function makeCandle() {
  const g = new THREE.Group();
  const R = 0.062, H = 0.62;
  /* 蜡体：带细微蜡纹 */
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fdf6ea'; cx.fillRect(0, 0, S, S);
  /* 蜡烛纹理极轻，几乎只剩一点暖色不匀，避免出现竖条纹 */
  // 添加微妙的横向蜡纹
  for(let i=0; i<8; i++){
    const y = (i/8)*S + Math.random()*10;
    cx.strokeStyle = 'rgba(230,210,180,' + (0.03 + Math.random()*0.04) + ')';
    cx.lineWidth = 2 + Math.random()*4;
    cx.beginPath();
    cx.moveTo(0, y);
    cx.bezierCurveTo(S*0.3, y + Math.random()*3, S*0.7, y - Math.random()*3, S, y);
    cx.stroke();
  }
  for (let i = 0; i < 26; i++) {
    cx.strokeStyle = 'rgba(240,228,208,' + (0.03 + Math.random() * 0.04) + ')';
    cx.lineWidth = 4 + Math.random() * 9;
    cx.beginPath();
    const y0 = Math.random() * S;
    cx.moveTo(-20, y0);
    cx.bezierCurveTo(S * 0.3, y0 + (Math.random() - 0.5) * 22, S * 0.7, y0 + (Math.random() - 0.5) * 22, S + 20, y0 + (Math.random() - 0.5) * 16);
    cx.stroke();
  }
  const waxTex = new THREE.CanvasTexture(cv);
  waxTex.wrapS = waxTex.wrapT = THREE.RepeatWrapping;
  waxTex.repeat.set(1, 1);
  waxTex.colorSpace = THREE.SRGBColorSpace;

  const waxMat = new THREE.MeshStandardMaterial({
    color: 0xfdf6ea, roughness: 0.58, metalness: 0.02, map: waxTex,
    emissive: 0x1a0f08, emissiveIntensity: 0.015
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.02, H, 32), waxMat);
  body.position.y = H / 2; body.castShadow = true; g.add(body);

  /* 顶面凹陷：中心比边缘低，燃烧过才有 */
  const well = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.012, 32),
    new THREE.MeshStandardMaterial({ color: 0xece0cc, roughness: 0.75, metalness: 0.05 })
  );
  well.position.y = H - 0.004; g.add(well);

  /* 顶部融化的唇边 */
  const melt = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.06, R * 0.94, 0.030, 32), 
    new THREE.MeshStandardMaterial({ color: 0xf5e6d3, roughness: 0.5, metalness: 0.03, map: waxTex })
  );
  melt.position.y = H - 0.016; melt.castShadow = true; g.add(melt);

  /* 侧壁流蜡：几滴沿柱身挂下，粗细长短不一 */
  let seed = 99173;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  /* 顶唇溢出的蜡：贴着蜡烛外壁流下的一段，从唇口起、短而饱满 */
  /* 蜡流：上粗下细的水滴，贴着柱面缓缓流下 */
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.6 + rnd() * 0.5;
    const len = 0.045 + rnd() * 0.05;
    const rad = 0.008 + rnd() * 0.004;
    const rOff = R * 1.012;
    const lipY = H - 0.012;
    // 锥形流痕：上宽下窄
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.55, len, 8, 1), waxMat);
    cone.scale.z = 0.55;
    cone.position.set(Math.cos(a) * rOff, lipY - len * 0.5, Math.sin(a) * rOff);
    cone.rotation.y = -a;
    cone.castShadow = true;
    g.add(cone);
    // 末端收成一颗小珠
    const bead = new THREE.Mesh(new THREE.SphereGeometry(rad * 0.72, 10, 8), waxMat);
    bead.scale.set(1, 1.25, 0.62);
    bead.position.set(Math.cos(a) * rOff, lipY - len - rad * 0.4, Math.sin(a) * rOff);
    bead.rotation.y = -a;
    g.add(bead);
  }

  /* 烛芯：烧黑的头 */
  const wickMat = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 1 });
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0075, 0.070, 8), wickMat);
  wick.position.y = H + 0.048; g.add(wick);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.0085, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1310, roughness: 1 })
  );
  tip.position.y = H + 0.082; g.add(tip);

  const flame = makeFlame();
  flame.position.y = H + 0.085;   // 略高于烛芯顶端，让芯头露出来
  g.add(flame); flames.push(flame);
  const light = new THREE.PointLight(0xffb757, 2.6, 4.2, 2);
  light.position.y = H + 0.1; g.add(light);
  candleLights.push({ light: light, base: 2.6 });
  return g;
}

/* 奶油表面纹理：极轻的起伏，让柱面不是死平的 */
function creamTexture(swirl) {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
  /* 螺旋抹面痕：围绕轴心的浅色弧带，是手抹奶油的真实痕迹 */
  if (swirl) {
    x.save();
    x.translate(S / 2, S / 2);
    for (let i = 0; i < 26; i++) {
      const rr = 18 + i * 9.5;
      x.strokeStyle = 'rgba(' + (swirl[0]) + ',' + (swirl[1]) + ',' + (swirl[2]) + ',' + (0.030 + (i % 3) * 0.016) + ')';
      x.lineWidth = 5 + (i % 4) * 3;
      x.beginPath();
      x.arc(0, 0, rr, i * 0.55, i * 0.55 + 2.3);
      x.stroke();
    }
    x.restore();
  }
  let seed = 20240117;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // 大块柔斑：奶油抹开的痕迹
  for (let i = 0; i < 90; i++) {
    const px = rnd() * S, py = rnd() * S, r = 18 + rnd() * 52;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    const a = 0.012 + rnd() * 0.026;
    g.addColorStop(0, 'rgba(214,196,168,' + a + ')');
    g.addColorStop(1, 'rgba(214,196,168,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.284); x.fill();
  }
  // 细抹痕：短弧线
  x.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const px = rnd() * S, py = rnd() * S, len = 8 + rnd() * 26;
    const ang = rnd() * 6.284;
    x.strokeStyle = 'rgba(' + (196 + Math.floor(rnd() * 30)) + ',' + (180 + Math.floor(rnd() * 26)) + ',' + (152 + Math.floor(rnd() * 26)) + ',' + (0.05 + rnd() * 0.07) + ')';
    x.lineWidth = 0.6 + rnd() * 1.4;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 6, py + Math.sin(ang) * len * 0.5 + (rnd() - 0.5) * 6,
                       px + Math.cos(ang) * len, py + Math.sin(ang) * len);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  t.anisotropy = 4;
  return t;
}

/* 螺旋裱花边（piping rope）：沿圆周起伏的管状奶油 */
/* 螺旋裱花边：一条连续的波浪管，绕圆周起伏（真正的 rope piping） */
function ropedEdge(radius, y, mat, tubeR, turns) {
  const N = Math.max(480, turns * 44);
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * Math.PI * 2;
    const wob = Math.sin(a * turns) * tubeR * 0.9;      // 上下起伏
    const rad = radius + Math.cos(a * turns) * tubeR * 0.30; // 内外微摆
    pts.push(new THREE.Vector3(Math.cos(a) * rad, y + wob, Math.sin(a) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const geo = new THREE.TubeGeometry(curve, N * 2, tubeR, 16, true);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* 竖向棱纹：真蛋糕侧面常有的分瓣痕 */
/* 竖向棱纹：奶油挂痕，上粗下细、微微弯曲，两端收尖 */
function fluteRidges(radius, height, y, mat, count, thick) {
  const g = new THREE.Group();
  let sd = 77213;
  const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const t = thick * (0.62 + rnd() * 0.62);       // 粗细不一
    const hh = height * (0.58 + rnd() * 0.34);     // 长短不一
    // 细长锥体：顶端粗根部细，两端自然收
    const geo = new THREE.CylinderGeometry(t * 0.42, t, hh, 7, 1);
    const m = new THREE.Mesh(geo, mat);
    const off = radius * 0.998;
    m.position.set(Math.cos(a) * off, y + hh / 2 + height * 0.03, Math.sin(a) * off);
    m.rotation.y = -a;
    // 外倾一点，像顺着柱面流下
    m.rotation.z = Math.sin(a) * 0.03;
    m.rotation.x = -Math.cos(a) * 0.03;
    m.castShadow = true;
    g.add(m);
    // 顶端圆头，避免切口生硬
    const cap = new THREE.Mesh(new THREE.SphereGeometry(t * 0.44, 8, 6), mat);
    cap.position.set(Math.cos(a) * off, y + hh + height * 0.03, Math.sin(a) * off);
    cap.scale.y = 0.7;
    g.add(cap);
  }
  return g;
}

/* 糖粒：贴在各层侧面的细密彩色短棒，是「有花纹」最直接的一层 */
function sprinkles(radius, height, y, count, size) {
  const grp = new THREE.Group();
  let sd = 91377;
  const rnd = () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mats = SPRINKLE_COLS.map(function (c) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.30, metalness: 0.10, emissive: c, emissiveIntensity: 0.10 });
  });
  const geo = new THREE.CylinderGeometry(size * 0.52, size * 0.52, size * 4.0, 7, 1);
  for (let i = 0; i < count; i++) {
    // 三层侧面随机散布：上中下各有，避开最顶端被裱花压住的位置
    const a = rnd() * Math.PI * 2;
    const hFrac = 0.10 + rnd() * 0.82;
    const yy = y + height * hFrac;
    const rr = radius * 1.014;
    const m = new THREE.Mesh(geo, mats[Math.floor(rnd() * mats.length)]);
    m.position.set(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    // 让它几乎贴壁：绕 Y 对齐切线，再随机一点倾角
    m.rotation.set((rnd() - 0.5) * 1.5, -a + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 1.5);
    m.castShadow = false;
    grp.add(m);
  }
  return grp;
}

function tier(radius, height, y, mat) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.005, height, 96, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y + height / 2;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function dripRing(radius, y, count, mat) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 14, 10);
  // 固定伪随机，保证每次刷新一致（不能闪）
  let seed = 1337;
  const rnd = function () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.05;
    const d = new THREE.Mesh(geo, mat);
    // 尺寸、下垂长度、粗细都带随机，像真的淋上去的
    const base = 0.050 + rnd() * 0.022;
    const hang = 0.85 + rnd() * 1.25;          // 下垂倍数
    d.scale.set(base * (0.80 + rnd() * 0.26), base * hang, base * (0.80 + rnd() * 0.26));
    d.position.set(
      Math.cos(a) * radius,
      y - base * hang * 0.82,
      Math.sin(a) * radius
    );
    d.rotation.y = a;
    d.castShadow = true;
    g.add(d);
  }
  return g;
}
export function buildCake() {
  const g = new THREE.Group();
  const tex = creamTexture();
  tex.colorSpace = THREE.SRGBColorSpace;
  /* 三套抹面纹理：白 / 蜜桃 / 鼠尾草，让三层各有自己的花 */
  const texA = tex;
  const texB = creamTexture([232, 196, 186]); texB.colorSpace = THREE.SRGBColorSpace;
  const texC = creamTexture([196, 204, 186]); texC.colorSpace = THREE.SRGBColorSpace;
  texA.wrapS = texA.wrapT = THREE.RepeatWrapping;
  texB.wrapS = texB.wrapT = THREE.RepeatWrapping;
  texC.wrapS = texC.wrapT = THREE.RepeatWrapping;
  texB.repeat.set(2, 1.6); texC.repeat.set(2, 1.6);
  const creamMat = new THREE.MeshStandardMaterial({
    color: CREAM, roughness: 0.82, metalness: 0.0, map: texA,
    bumpMap: texA, bumpScale: 0.006
  });
  const creamMatB = new THREE.MeshStandardMaterial({
    color: CREAM_PINK, roughness: 0.80, metalness: 0.0, map: texB,
    bumpMap: texB, bumpScale: 0.005
  });
  const creamMatC = new THREE.MeshStandardMaterial({
    color: CREAM_SAGE, roughness: 0.80, metalness: 0.0, map: texC,
    bumpMap: texC, bumpScale: 0.005
  });
  const creamDeep = new THREE.MeshStandardMaterial({ color: CREAM_DEEP, roughness: 0.88, metalness: 0.0, map: texA });
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0xfbf4e8, roughness: 0.68, metalness: 0.0, map: texA });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xf2e6d3, roughness: 0.85, metalness: 0.0, map: texA });
  const pipeMatB = new THREE.MeshStandardMaterial({ color: 0xf3d3c8, roughness: 0.66, metalness: 0.0, map: texB });
  const pipeMatC = new THREE.MeshStandardMaterial({ color: 0xdde4cd, roughness: 0.66, metalness: 0.0, map: texC });

  const R1 = 1.30, H1 = 0.78;
  const R2 = 0.98, H2 = 0.62;
  const R3 = 0.66, H3 = 0.50;

  let y = 0;
  // 第一层：米白 + 蜜桃粉裱花
  g.add(tier(R1, H1, y, creamMat));
  g.add(fluteRidges(R1 * 0.995, H1, y, ridgeMat, 30, 0.026));
  g.add(dripRing(R1, y + H1 + 0.012, 44, creamDeep));
  g.add(ropedEdge(R1 * 0.975, y + H1 + 0.036, pipeMatB, 0.042, 30));
  g.add(sprinkles(R1 * 0.985, H1, y, 54, 0.020));
  y += H1;
  // 第二层：蜜桃粉 + 白裱花
  g.add(tier(R2, H2, y, creamMatB));
  g.add(fluteRidges(R2 * 0.995, H2, y, pipeMat, 24, 0.022));
  g.add(dripRing(R2, y + H2 + 0.012, 34, pipeMat));
  g.add(ropedEdge(R2 * 0.972, y + H2 + 0.032, pipeMat, 0.036, 24));
  g.add(sprinkles(R2 * 0.985, H2, y, 40, 0.016));
  y += H2;
  // 第三层：鼠尾草绿 + 白裱花
  g.add(tier(R3, H3, y, creamMatC));
  g.add(fluteRidges(R3 * 0.995, H3, y, ridgeMat, 18, 0.018));
  g.add(dripRing(R3, y + H3 + 0.012, 26, pipeMatC));
  g.add(ropedEdge(R3 * 0.968, y + H3 + 0.028, pipeMat, 0.030, 18));
  g.add(sprinkles(R3 * 0.985, H3, y, 28, 0.013));
  const topY = y + H3;

  const topCream = new THREE.Mesh(
    new THREE.CylinderGeometry(R3 * 1.002, R3 * 1.002, 0.042, 96),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74 })
  );
  topCream.position.y = topY + 0.021;
  topCream.receiveShadow = true;
  g.add(topCream);

  /* 浆果：带霜面 + 小梗 + 叶片，成组而非散点 */
  const berryGeo = new THREE.SphereGeometry(0.050, 18, 14);
  const berryMat = new THREE.MeshStandardMaterial({ color: BERRY, roughness: 0.38, metalness: 0.03, emissive: 0x1a0508, emissiveIntensity: 0.03 });
  const berryFrost = new THREE.MeshStandardMaterial({ color: 0xb0525c, roughness: 0.82, metalness: 0.0, emissive: 0x0a0506, emissiveIntensity: 0.02 });
  const leafGeo = new THREE.SphereGeometry(1, 10, 6);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f5a34, roughness: 0.68, metalness: 0.02, emissive: 0x0a1208, emissiveIntensity: 0.02 });
  let bs = 5511;
  const brnd = () => (bs = (bs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const clusters = 6;
  for (let i = 0; i < clusters; i++) {
    const a = (i / clusters) * Math.PI * 2 + 0.28;
    const rr = R3 * 0.74;
    const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
    // 每簇 3 颗，大小不一
    for (let k = 0; k < 3; k++) {
      const ang = a + (k - 1) * 0.17 + (brnd() - 0.5) * 0.06;
      const dist = rr + (k === 1 ? -0.035 : 0.022) + (brnd() - 0.5) * 0.02;
      const s = 0.82 + brnd() * 0.42;
      const b = new THREE.Mesh(berryGeo, k === 2 ? berryFrost : berryMat);
      b.scale.set(s, s * 0.86, s);
      const py = topY + 0.055 + (k === 1 ? 0.012 : 0);
      b.position.set(Math.cos(ang) * dist, py, Math.sin(ang) * dist);
      b.castShadow = true; g.add(b);
      // 浆果底部小萼
      if (k !== 2) {
        const cal = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.012, 6),
          new THREE.MeshStandardMaterial({ color: 0x2a3f22, roughness: 0.8 }));
        cal.position.set(Math.cos(ang) * dist, py + 0.046 * s, Math.sin(ang) * dist);
        cal.rotation.x = Math.PI;
        g.add(cal);
      }
    }
    // 叶片：斜插在簇侧
    const lf = new THREE.Mesh(leafGeo, leafMat);
    lf.scale.set(0.045, 0.006, 0.020);
    lf.position.set(Math.cos(a + 0.30) * (rr + 0.02), topY + 0.050, Math.sin(a + 0.30) * (rr + 0.02));
    lf.rotation.set(0, -a - 0.7, 0.32);
    lf.castShadow = true;
    g.add(lf);
    void bx; void bz;
  }

  const c1 = makeCandle(); c1.position.set(-0.16, topY + 0.04, 0.06);
  const c2 = makeCandle(); c2.position.set(0.16, topY + 0.04, 0.06);
  g.add(c1); g.add(c2);
  return g;
}

/* 根据包围盒把相机拉到刚好的距离：占屏比例 = frac */
function fitCamera(host, isMobile) {
  const box = new THREE.Box3().setFromObject(cakeGroup);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);

  const fovV = camera.fov * Math.PI / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);

  /* 竖屏蛋糕必须完整落在 host 内并留出呼吸空间 */
  const fracW = isMobile ? 0.62 : 0.56;
  const distW = (size.x / 2) / Math.tan(fovH / 2) / fracW;
  const distH = (size.y / 2) / Math.tan(fovV / 2) / (isMobile ? 0.72 : 0.70);
  const dist = Math.max(distW, distH);

  const pitch = THREE.MathUtils.degToRad(isMobile ? 12 : 16);
  const targetY = center.y;
  camera.position.set(0, targetY + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  camera.lookAt(0, targetY, 0);

  /* 竖屏：视口偏移——把蛋糕整体推到画面上方，下方留出纯暗场给文案
     原理：把渲染视窗当作比实际更高的画布，纵向整体上移 */
  camera.clearViewOffset();
  window.__cam2 = { hostW: host.clientWidth, hostH: host.clientHeight, isMobile: isMobile };
  if (isMobile) {
    // host 高度已是屏幕的 62%；把蛋糕整体推到容器上部，底部留白给文案
    camera.position.y += 0.42;
    camera.lookAt(0, targetY + 0.16, 0);
  }

  // 竖屏把重心上移，给底部文案留干净暗场
  camera.userData.targetY = targetY;
  camera.userData.baseZ = camera.position.z;
  window.__cam = {
    pos: [camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2)],
    size: [size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2)],
    center: [center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2)],
    dist: dist.toFixed(2), fracW, fovH: (fovH*180/Math.PI).toFixed(1),
    cakeY: cakeGroup.position.y
  };
}

function buildScene(host, isMobile) {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c0a08, 0.075);

  camera = new THREE.PerspectiveCamera(34, host.clientWidth / host.clientHeight, 0.1, 60);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.shadowMap.enabled = !isMobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const key = new THREE.DirectionalLight(0xffe6c2, 2.3);
  key.position.set(2.6, 4.4, 2.4);
  key.castShadow = !isMobile;
  if (!isMobile) {
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.2;
    key.shadow.camera.bottom = -2.2;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9fc4e8, 0.62);
  rim.position.set(-3.2, 1.9, -2.6);
  scene.add(rim);

  scene.add(new THREE.AmbientLight(0xfff2e0, 0.55));
  scene.add(new THREE.HemisphereLight(0xffe9cf, 0x241c14, 0.75));

  cakeGroup = buildCake();
  // 竖屏把蛋糕整体上移，给底部文案腾出干净区域
  cakeGroup.position.y = isMobile ? 0.34 : -0.22;
  scene.add(cakeGroup);

  /* 不用硬边圆盘：用一张径向渐隐的接触阴影贴片，边缘自然融进暗场 */
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 10, 128, 128, 126);
  grad.addColorStop(0.00, 'rgba(0,0,0,0.70)');
  grad.addColorStop(0.34, 'rgba(0,0,0,0.38)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.10)');
  grad.addColorStop(0.82, 'rgba(0,0,0,0.02)');
  grad.addColorStop(1.00, 'rgba(0,0,0,0)');
  sctx.clearRect(0, 0, 256, 256);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  shadowTex.colorSpace = THREE.SRGBColorSpace;
  const shadowPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 4.6),
    new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.62,
      blending: THREE.NormalBlending, side: THREE.DoubleSide
    })
  );
  shadowPlate.rotation.x = -Math.PI / 2;
  shadowPlate.position.y = -0.012;
  scene.add(shadowPlate);

  /* 自动取景：按蛋糕实际包围盒算距离，保证完整入镜 + 目标占比 */
  fitCamera(host, isMobile);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = THREE.MathUtils.degToRad(isMobile ? 55 : 62);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(isMobile ? 80 : 88);
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, camera.userData.targetY || 0.78, 0);
  controls.update();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) controls.autoRotate = false;

  const onResize = function () {
    if (!renderer) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  return onResize;
}
function loop() {
  raf = requestAnimationFrame(loop);
  const t = clock.getElapsedTime();
  for (let i = 0; i < flames.length; i++) {
    const f = flames[i];
    f.material.uniforms.uTime.value = t + i * 1.37;
    if (extinguished) {
      f.material.uniforms.uStrength.value = Math.max(0, f.material.uniforms.uStrength.value - 0.06);
    }
  }
  for (let i = 0; i < candleLights.length; i++) {
    const c = candleLights[i];
    const flick = 0.86 + Math.sin(t * 7.3 + i * 2.1) * 0.06 + Math.sin(t * 13.7 + i) * 0.04;
    c.light.intensity = extinguished ? 0 : c.base * flick;
  }
  if (controls) controls.update();
  if (renderer) renderer.render(scene, camera);
}

export function mount(host) {
  if (running) return;
  const isMobile = window.innerWidth < 640;
  resizeHandler = buildScene(host, isMobile);
  running = true;
  clock.start();
  loop();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const baseZ = camera.userData.baseZ || camera.position.z;
    camera.position.z = baseZ + 0.55;
    const t0 = performance.now();
    const ease = function (p) { return 1 - Math.pow(1 - p, 4); };
    const step = function () {
      if (!running) return;
      const p = Math.min(1, (performance.now() - t0) / 1400);
      camera.position.z = baseZ + (1 - ease(p)) * 0.55;
      camera.updateProjectionMatrix();
      if (p < 1) requestAnimationFrame(step);
    };
    step();
  }
}

export function blowOut() {
  if (extinguished) return;
  extinguished = true;
  setTimeout(function () {
    for (const f of flames) f.visible = false;
    for (const c of candleLights) c.light.intensity = 0;
  }, 900);
}

export function isExtinguished() { return extinguished; }

export function unmount() {
  running = false;
  cancelAnimationFrame(raf);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  if (renderer) {
    renderer.dispose();
    const el = renderer.domElement;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    renderer = null;
  }
  scene = null; camera = null; controls = null; cakeGroup = null;
  flames = []; candleLights = []; extinguished = false;
}
