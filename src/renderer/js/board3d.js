// 3D 圍棋盤（Three.js）：榧木棋盤、立體棋子、棋罐與棋蓋（放提子）、形勢與建議點疊圖
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BLACK, WHITE, EMPTY, starPoints, toGtp } from './go.js';

const BOARD_T = 0.9;        // 棋盤厚度
const BOARD_TOP = BOARD_T + 0.55; // 盤面高度（含盤腳）
const R = 0.47;             // 棋子半徑
const SQ = 0.4;             // 棋子壓扁比例（雙凸鏡片形）
const STONE_H = R * SQ;
const MARGIN = 0.95;        // 最外線到盤邊
const COLS = 'ABCDEFGHJKLMNOPQRST';

function woodCanvas(W, H, base = ['#e9be7d', '#e2b26c', '#d9a65e'], lines = 340) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, base[0]); grd.addColorStop(0.5, base[1]); grd.addColorStop(1, base[2]);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // 柾目（直紋）
  for (let i = 0; i < lines; i++) {
    g.strokeStyle = `rgba(${130 + Math.random() * 40},${80 + Math.random() * 30},${30 + Math.random() * 20},${0.035 + Math.random() * 0.05})`;
    g.lineWidth = 1 + Math.random() * 3.5;
    g.beginPath();
    const x = Math.random() * W;
    g.moveTo(x, 0);
    for (let y = 0; y <= H; y += 48) g.lineTo(x + Math.sin(y / (160 + Math.random() * 90)) * 7 + (Math.random() - 0.5) * 2, y);
    g.stroke();
  }
  return { cv, g };
}

// 盤面：線、星位、座標
function makeBoardTexture(n) {
  const px = n === 19 ? 110 : n === 13 ? 150 : 200;
  const W = Math.round((n - 1 + MARGIN * 2) * px);
  const { cv, g } = woodCanvas(W, W);
  const o = MARGIN * px;
  const X = (i) => o + i * px;
  g.strokeStyle = 'rgba(28,16,6,0.92)';
  g.lineCap = 'square';
  g.lineWidth = px * 0.035;
  for (let i = 0; i < n; i++) {
    g.beginPath(); g.moveTo(X(0), X(i)); g.lineTo(X(n - 1), X(i)); g.stroke();
    g.beginPath(); g.moveTo(X(i), X(0)); g.lineTo(X(i), X(n - 1)); g.stroke();
  }
  g.lineWidth = px * 0.06;
  g.strokeRect(X(0), X(0), X(n - 1) - X(0), X(n - 1) - X(0));
  g.fillStyle = 'rgba(28,16,6,0.95)';
  for (const p of starPoints(n)) { g.beginPath(); g.arc(X(p % n), X((p / n) | 0), px * 0.1, 0, Math.PI * 2); g.fill(); }
  // 座標
  g.fillStyle = 'rgba(60,34,12,0.72)';
  g.font = `600 ${Math.round(px * 0.3)}px "Microsoft JhengHei","PingFang TC",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    g.fillText(COLS[i], X(i), o * 0.42); g.fillText(COLS[i], X(i), W - o * 0.42);
    g.fillText(String(n - i), o * 0.4, X(i)); g.fillText(String(n - i), W - o * 0.4, X(i));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// 白子的貝殼紋路
function shellTexture() {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#f6f4ee'; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 60; i++) {
    const y = (i / 60) * N + Math.random() * 4;
    g.strokeStyle = `rgba(${200 + Math.random() * 20},${196 + Math.random() * 20},${186 + Math.random() * 20},${0.25 + Math.random() * 0.25})`;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= N; x += 32) g.lineTo(x, y + Math.sin(x / 70 + i) * 2.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export class Board3D {
  constructor(container, { onPoint, onHover } = {}) {
    this.container = container;
    this.onPoint = onPoint || (() => {});
    this.onHover = onHover || (() => {});
    this.n = 19;
    this.stones = new Map();   // index → mesh
    this.anims = [];
    this.interactive = false;
    this.turnColor = BLACK;
    this.mySide = BLACK;
    this.canPlace = () => true;
    this.overlayState = { ownership: null, cands: null, territory: null, hint: -1, marks: null };
    this.dead = new Set();
    this.numbers = null;
    this.lidCounts = { 1: 0, 2: 0 };

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#1c130c');
    scene.fog = new THREE.Fog('#1c130c', 45, 90);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.43;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };

    scene.add(new THREE.HemisphereLight('#fff4e0', '#3a2a1a', 0.55));
    const key = this.keyLight = new THREE.DirectionalLight('#ffecd0', 2.1);
    key.position.set(-8, 22, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 3;
    scene.add(key);
    scene.add(key.target);
    const fill = new THREE.DirectionalLight('#cfe0ff', 0.35);
    fill.position.set(10, 8, -8);
    scene.add(fill);

    this.buildTable();
    this.stoneGeo = new THREE.SphereGeometry(R, 48, 24);
    this.stoneGeo.scale(1, SQ, 1);
    this.stoneGeo.translate(0, STONE_H, 0);
    const shell = shellTexture();
    this.mat = {
      [BLACK]: new THREE.MeshPhysicalMaterial({ color: '#141416', roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.32 }),
      [WHITE]: new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: shell, roughness: 0.26, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.18 }),
    };
    this.deadMat = {
      [BLACK]: new THREE.MeshPhysicalMaterial({ color: '#141416', roughness: 0.4, transparent: true, opacity: 0.42 }),
      [WHITE]: new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: shell, roughness: 0.3, transparent: true, opacity: 0.42 }),
    };
    this.ghost = new THREE.Mesh(this.stoneGeo, new THREE.MeshStandardMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.lastMark = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.2, 32), new THREE.MeshBasicMaterial({ color: '#e33', depthWrite: false }));
    this.lastMark.rotation.x = -Math.PI / 2;
    this.lastMark.visible = false;
    scene.add(this.lastMark);
    this.hintRing = new THREE.Mesh(new THREE.RingGeometry(R * 0.78, R * 1.02, 48), new THREE.MeshBasicMaterial({ color: '#39ff88', transparent: true, opacity: 0.9, depthWrite: false }));
    this.hintRing.rotation.x = -Math.PI / 2;
    this.hintRing.visible = false;
    scene.add(this.hintRing);
    this.boardGroup = new THREE.Group();
    scene.add(this.boardGroup);
    this.buildBowls();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_TOP);
    r.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    r.domElement.addEventListener('pointermove', (e) => this.onPointerMove(e));
    r.domElement.addEventListener('pointerleave', () => { this.ghost.visible = false; this.onHover(-1); });
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.setSize(19);
    this.resize();
    this.setView('tilt');
    r.setAnimationLoop(() => this.frame());
  }

  // ---------------- 場景 ----------------
  buildTable() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const g = cv.getContext('2d');
    g.fillStyle = '#4a3020'; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 160; i++) { // 榻榻米般的細紋
      g.strokeStyle = `rgba(${90 + Math.random() * 40},${70 + Math.random() * 30},${40 + Math.random() * 20},${0.25 + Math.random() * 0.2})`;
      g.lineWidth = 2 + Math.random() * 3;
      const y = (i / 160) * 1024;
      g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y + (Math.random() - 0.5) * 3); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, color: '#c9a77a' }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  buildBoard() {
    const n = this.n;
    this.boardGroup.clear();
    const W = this.W = n - 1 + MARGIN * 2;
    this.boardTex && this.boardTex.dispose();
    this.boardTex = makeBoardTexture(n);
    const sideTex = new THREE.CanvasTexture(woodCanvas(512, 128, ['#c8954f', '#bd8746', '#b07a3c'], 60).cv);
    sideTex.colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.55 });
    const top = new THREE.MeshStandardMaterial({ map: this.boardTex, roughness: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, BOARD_T, W), [side, side, top, side, side, side]);
    box.position.y = BOARD_TOP - BOARD_T / 2;
    box.castShadow = true; box.receiveShadow = true;
    this.boardGroup.add(box);
    // 盤腳（梔子果實造型）
    const legGeo = new THREE.LatheGeometry([[0, 0], [0.42, 0.02], [0.55, 0.18], [0.5, 0.36], [0.36, 0.5], [0.3, 0.55], [0, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 32);
    const legMat = new THREE.MeshStandardMaterial({ color: '#a8743a', roughness: 0.55 });
    const d = W / 2 - 1.1;
    for (const [x, z] of [[-d, -d], [d, -d], [-d, d], [d, d]]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, 0, z);
      leg.castShadow = true;
      this.boardGroup.add(leg);
    }
    // 疊圖（形勢、建議點、地）
    this.ovCanvas = document.createElement('canvas');
    this.ovCanvas.width = this.ovCanvas.height = n === 19 ? 1520 : 1200;
    this.ovTex = new THREE.CanvasTexture(this.ovCanvas);
    this.ovTex.colorSpace = THREE.SRGBColorSpace;
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshBasicMaterial({ map: this.ovTex, transparent: true, depthWrite: false }));
    ov.rotation.x = -Math.PI / 2;
    ov.position.y = BOARD_TOP + 0.003;
    ov.renderOrder = 1;
    this.boardGroup.add(ov);
    // 陰影範圍
    const s = this.keyLight.shadow.camera;
    Object.assign(s, { left: -W / 2 - 6, right: W / 2 + 6, top: W / 2 + 6, bottom: -W / 2 - 6, near: 1, far: 60 });
    s.updateProjectionMatrix();
    this.placeBowls();
  }

  // 棋罐（碁笥）與棋蓋：自己的在右手邊、對手的在左上
  buildBowls() {
    const bowlGeo = new THREE.LatheGeometry([[0, 0.05], [0.9, 0.05], [1.35, 0.4], [1.5, 0.95], [1.38, 1.4], [1.18, 1.55], [1.15, 1.5], [0, 1.45]].map(([x, y]) => new THREE.Vector2(x, y)), 48);
    const lidGeo = new THREE.LatheGeometry([[0, 0.08], [1.1, 0.08], [1.48, 0.25], [1.55, 0.45], [1.5, 0.5], [1.38, 0.32], [0, 0.18]].map(([x, y]) => new THREE.Vector2(x, y)), 48);
    const woodTex = new THREE.CanvasTexture(woodCanvas(512, 256, ['#8a5a2e', '#7a4c24', '#6a401c'], 90).cv);
    woodTex.colorSpace = THREE.SRGBColorSpace;
    const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.42, metalness: 0.02 });
    this.bowls = {};
    for (const c of [BLACK, WHITE]) {
      const grp = new THREE.Group();
      const bowl = new THREE.Mesh(bowlGeo, wood);
      bowl.castShadow = true; bowl.receiveShadow = true;
      grp.add(bowl);
      // 罐裡的棋子（裝飾）
      for (let k = 0; k < 22; k++) {
        const s = new THREE.Mesh(this.stoneGeo, this.mat[c]);
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.85;
        s.position.set(Math.cos(a) * rr, 1.3 + Math.random() * 0.12, Math.sin(a) * rr);
        s.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * 3, (Math.random() - 0.5) * 0.5);
        s.castShadow = true;
        grp.add(s);
      }
      const lid = new THREE.Group();
      const lm = new THREE.Mesh(lidGeo, wood);
      lm.castShadow = true; lm.receiveShadow = true;
      lid.add(lm);
      lid.userData.stones = [];
      this.scene.add(grp, lid);
      this.bowls[c] = { grp, lid };
    }
  }

  placeBowls() {
    const W = this.W, me = this.mySide, opp = 3 - me;
    const x = W / 2 + 2.3;
    this.bowls[me].grp.position.set(x, 0, W / 2 - 2.2);
    this.bowls[me].lid.position.set(x + 0.2, 0, W / 2 - 5.6);
    this.bowls[opp].grp.position.set(-x, 0, -W / 2 + 2.2);
    this.bowls[opp].lid.position.set(-x - 0.2, 0, -W / 2 + 5.6);
  }

  // 棋蓋裡的提子數（依提子方）
  setPrisoners(counts) {
    for (const c of [BLACK, WHITE]) {
      const lid = this.bowls[c].lid;
      const want = Math.min(48, counts[c] || 0);
      const list = lid.userData.stones;
      const capColor = 3 - c; // 提到的是對方的棋子
      while (list.length > want) lid.remove(list.pop());
      while (list.length < want) {
        const s = new THREE.Mesh(this.stoneGeo, this.mat[capColor]);
        const k = list.length, a = k * 2.399, rr = 0.22 * Math.sqrt(k % 20) + (k >= 20 ? 0.1 : 0);
        s.position.set(Math.cos(a) * Math.min(1.1, rr), 0.2 + Math.floor(k / 20) * 0.12, Math.sin(a) * Math.min(1.1, rr));
        s.rotation.y = Math.random() * 3;
        s.castShadow = true;
        lid.add(s); list.push(s);
      }
    }
    this.lidCounts = { ...counts };
  }

  // ---------------- 座標 ----------------
  X(i) { return (i % this.n) - (this.n - 1) / 2; }
  Z(i) { return ((i / this.n) | 0) - (this.n - 1) / 2; }

  setSize(n) {
    if (n === this.n && this.boardTex) return;
    this.n = n;
    for (const m of this.stones.values()) this.scene.remove(m);
    this.stones.clear();
    this.buildBoard();
    this.clearOverlay();
    this.fitDistance();
  }

  setMySide(c) { this.mySide = c === WHITE ? WHITE : BLACK; this.placeBowls(); }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitDistance();
  }

  fitDistance() {
    if (!this.viewName || !this.W) return;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    const half = this.W / 2 + 0.3;
    const [up, out] = this.viewName === 'top' ? [1, 0.0001] : this.viewName === 'low' ? [0.6, 0.8] : [0.84, 0.54];
    // 斜看時近端看起來比較大，所以需要的距離用近端估算
    const needW = half / tanH, needH = (half * (up + out * 0.28) + 0.2) / tanV;
    const dist = Math.max(needW, needH) * (this.viewName === 'low' ? 1.08 : 1.02) + (this.viewName === 'top' ? BOARD_TOP : 0);
    const target = new THREE.Vector3(0, BOARD_TOP, this.viewName === 'top' ? 0 : 0.6);
    const dir = new THREE.Vector3(0, up, out).normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.minDistance = dist * 0.45;
    this.controls.maxDistance = dist * 1.8;
    this.camera.lookAt(target);
    this.controls.update();
  }

  setView(name) { this.viewName = name; this.fitDistance(); }

  // ---------------- 棋子 ----------------
  makeStone(c) {
    const m = new THREE.Mesh(this.stoneGeo, this.mat[c]);
    m.castShadow = true; m.receiveShadow = true;
    m.rotation.y = Math.random() * Math.PI * 2;
    m.userData.color = c;
    return m;
  }

  // 依棋盤陣列同步（無動畫）
  setPosition(cells) {
    for (const t of [...this.pending || []]) t();
    this.pending = new Set();
    this.anims = this.anims.filter((a) => a.keep);
    for (const [i, m] of this.stones) {
      if (cells[i] !== m.userData.color) { this.scene.remove(m); this.stones.delete(i); }
      else m.position.set(this.X(i), BOARD_TOP, this.Z(i));
    }
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i] || this.stones.has(i)) continue;
      const m = this.makeStone(cells[i]);
      m.position.set(this.X(i), BOARD_TOP, this.Z(i));
      this.scene.add(m);
      this.stones.set(i, m);
    }
    this.applyDead();
    this.updateNumbers();
  }

  // 落子動畫（由上方落下）；captured：被提的棋子飛進提子方的棋蓋
  placeStone(i, c, captured = [], { duration = 230 } = {}) {
    return new Promise((res) => {
      const done = () => { this.pending && this.pending.delete(done); res(); };
      (this.pending ||= new Set()).add(done);
      const old = this.stones.get(i);
      if (old) this.scene.remove(old);
      const m = this.makeStone(c);
      const x = this.X(i), z = this.Z(i);
      m.position.set(x, BOARD_TOP + 1.6, z);
      this.scene.add(m);
      this.stones.set(i, m);
      const t0 = performance.now();
      this.anims.push((now) => {
        const k = Math.min(1, (now - t0) / duration);
        const y = 1.6 * (1 - k * k);
        const bounce = k >= 1 ? 0 : 0;
        m.position.y = BOARD_TOP + y + bounce;
        if (k >= 1) {
          m.position.y = BOARD_TOP;
          for (const j of captured) this.flyToLid(j, c);
          done();
          return false;
        }
        return true;
      });
    });
  }

  flyToLid(i, capturer) {
    const m = this.stones.get(i);
    if (!m) return;
    this.stones.delete(i);
    const start = m.position.clone();
    const lid = this.bowls[capturer].lid;
    const end = lid.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8));
    const t0 = performance.now(), dur = 520 + Math.random() * 160;
    this.anims.push((now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = ease(k);
      m.position.lerpVectors(start, end, e);
      m.position.y += Math.sin(Math.PI * e) * 2.2;
      m.rotation.x = e * 3;
      if (k >= 1) {
        this.scene.remove(m);
        this.setPrisoners(this.lidCounts);
        return false;
      }
      return true;
    });
  }

  removeStones(list) { for (const i of list) { const m = this.stones.get(i); if (m) { this.scene.remove(m); this.stones.delete(i); } } }

  setLastMove(i) {
    const m = i >= 0 ? this.stones.get(i) : null;
    if (!m) { this.lastMark.visible = false; return; }
    this.lastMark.material.color.set(m.userData.color === BLACK ? '#f5f5f5' : '#d22');
    this.lastMark.position.set(this.X(i), BOARD_TOP + STONE_H * 2 + 0.004, this.Z(i));
    this.lastMark.visible = true;
  }

  setHint(i) {
    this.overlayState.hint = i;
    if (i == null || i < 0) { this.hintRing.visible = false; return; }
    this.hintRing.position.set(this.X(i), BOARD_TOP + (this.stones.has(i) ? STONE_H * 2 + 0.01 : 0.01), this.Z(i));
    this.hintRing.visible = true;
  }

  // 終局點目：死子半透明
  setDead(set) { this.dead = new Set(set || []); this.applyDead(); }
  applyDead() {
    for (const [i, m] of this.stones) m.material = this.dead.has(i) ? this.deadMat[m.userData.color] : this.mat[m.userData.color];
  }

  // 手數（棋譜重播用）：map index → 數字
  setNumbers(map) { this.numbers = map; this.updateNumbers(); }
  updateNumbers() {
    for (const p of this.numPlanes || []) this.scene.remove(p);
    this.numPlanes = [];
    if (!this.numbers) return;
    for (const [i, num] of this.numbers) {
      const m = this.stones.get(i);
      if (!m) continue;
      const tex = numTexture(num, m.userData.color);
      const p = new THREE.Mesh(this.numGeo ||= new THREE.PlaneGeometry(R * 1.5, R * 1.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      p.rotation.x = -Math.PI / 2;
      p.position.set(this.X(i), BOARD_TOP + STONE_H * 2 + 0.006, this.Z(i));
      this.scene.add(p);
      this.numPlanes.push(p);
    }
  }

  // ---------------- 疊圖 ----------------
  clearOverlay() { this.overlayState = { ownership: null, cands: null, territory: null, hint: -1, marks: null }; this.drawOverlay(); }
  setOwnership(own) { this.overlayState.ownership = own; this.drawOverlay(); }
  setCandidates(list) { this.overlayState.cands = list; this.drawOverlay(); }
  setTerritory(owner) { this.overlayState.territory = owner; this.drawOverlay(); }

  drawOverlay() {
    if (!this.ovCanvas) return;
    const g = this.ovCanvas.getContext('2d');
    const S = this.ovCanvas.width, n = this.n;
    g.clearRect(0, 0, S, S);
    const px = S / this.W, o = MARGIN * px;
    const P = (i) => [o + (i % n) * px, o + ((i / n) | 0) * px];
    const st = this.overlayState;
    if (st.ownership) {
      for (let i = 0; i < n * n; i++) {
        const v = st.ownership[i];
        if (Math.abs(v) < 0.15) continue;
        const [x, y] = P(i);
        const s = px * (0.25 + 0.45 * Math.min(1, Math.abs(v)));
        g.fillStyle = v > 0 ? `rgba(10,10,14,${0.25 + 0.5 * Math.abs(v)})` : `rgba(255,255,255,${0.3 + 0.55 * Math.abs(v)})`;
        g.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    if (st.territory) {
      for (let i = 0; i < n * n; i++) {
        const v = st.territory[i];
        if (!v) continue;
        const [x, y] = P(i);
        const s = px * 0.42;
        g.fillStyle = v === BLACK ? 'rgba(10,10,14,0.85)' : 'rgba(255,255,255,0.92)';
        g.strokeStyle = v === BLACK ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.45)';
        g.lineWidth = px * 0.03;
        g.fillRect(x - s / 2, y - s / 2, s, s);
        g.strokeRect(x - s / 2, y - s / 2, s, s);
      }
    }
    if (st.cands && st.cands.length) {
      const best = st.cands[0];
      st.cands.forEach((c, k) => {
        if (c.i < 0) return;
        const [x, y] = P(c.i);
        const rr = px * 0.46;
        const top = k === 0;
        g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2);
        const drop = (best.wrMe - c.wrMe) * 100;
        g.fillStyle = top ? 'rgba(40,200,255,0.92)' : drop < 2 ? 'rgba(120,220,90,0.88)' : drop < 6 ? 'rgba(240,200,60,0.85)' : 'rgba(240,120,70,0.8)';
        g.fill();
        g.lineWidth = px * 0.04; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
        g.fillStyle = '#111';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `700 ${Math.round(px * 0.3)}px "Segoe UI",sans-serif`;
        g.fillText((c.wrMe * 100).toFixed(1), x, y - px * 0.1);
        g.font = `600 ${Math.round(px * 0.2)}px "Segoe UI",sans-serif`;
        g.fillText(c.visits >= 1000 ? (c.visits / 1000).toFixed(1) + 'k' : String(c.visits), x, y + px * 0.2);
      });
    }
    if (st.marks) { // 教學、標記：{ i, text, color }
      for (const mk of st.marks) {
        const [x, y] = P(mk.i);
        g.fillStyle = mk.color || '#e33';
        g.font = `800 ${Math.round(px * 0.5)}px "Segoe UI",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(mk.text, x, y);
      }
    }
    this.ovTex.needsUpdate = true;
  }

  // ---------------- 互動 ----------------
  setInteractive(on, color = this.turnColor) {
    this.interactive = on;
    this.turnColor = color;
    this.ghost.material.color.set(color === BLACK ? '#111' : '#fff');
    if (!on) this.ghost.visible = false;
    this.renderer.domElement.style.cursor = on ? 'pointer' : 'default';
  }

  pickPoint(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return -1;
    const h = (this.n - 1) / 2;
    const x = Math.round(p.x + h), z = Math.round(p.z + h);
    if (x < 0 || z < 0 || x >= this.n || z >= this.n) return -1;
    if (Math.hypot(p.x + h - x, p.z + h - z) > 0.5) return -1;
    return z * this.n + x;
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    const i = this.pickPoint(e);
    if (i >= 0) this.onPoint(i);
  }

  onPointerMove(e) {
    const i = this.pickPoint(e);
    this.onHover(i);
    if (!this.interactive || i < 0 || this.stones.has(i) || !this.canPlace(i)) { this.ghost.visible = false; return; }
    this.ghost.position.set(this.X(i), BOARD_TOP, this.Z(i));
    this.ghost.visible = true;
  }

  pointLabel(i) { return toGtp(i, this.n); }

  frame() {
    const now = performance.now();
    const running = this.anims;
    this.anims = [];
    const keep = running.filter((fn) => fn(now) !== false);
    this.anims = keep.concat(this.anims);
    if (this.hintRing.visible) this.hintRing.material.opacity = 0.55 + 0.4 * Math.sin(now / 160);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

const numCache = new Map();
function numTexture(num, color) {
  const key = num + ':' + color;
  if (numCache.has(key)) return numCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = color === BLACK ? '#f2f2f2' : '#151515';
  g.font = `700 ${num >= 100 ? 52 : 64}px "Segoe UI",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  numCache.set(key, t);
  return t;
}

export { BOARD_TOP };
