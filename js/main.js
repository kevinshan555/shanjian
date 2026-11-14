/* 山间 · 静心空间
 * 纯静态 3D 静心体验：走一走、坐一会儿、108 次呼吸。
 */
(function () {
  "use strict";

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  if (!window.THREE) {
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#f4ead9;font-family:sans-serif">3D 引擎加载失败，请刷新页面重试。</div>';
    return;
  }

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var damp = function (a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); };

  var NAMES = [
    "悠闲的云", "淡淡的月光", "山中的雾", "晚归的鸟", "安静的松",
    "半盏灯", "慢行的风", "远山的青", "檐下的雨", "无事的下午",
    "迟到的春天", "石上的苔"
  ];
  var ROBE_COLORS = [0x7a4b3a, 0x4c5a4a, 0x5a4a63, 0x6b5a3e, 0x3f4a5a, 0x6d3f45];

  var state = {
    entered: false,
    sitting: false,
    nearCushion: null,
    yaw: 0.18,
    pitch: 0.2,
    dist: 13,
    targetDist: 13,
    introOrbit: 0,
    playerPos: new THREE.Vector3(0, 0, 9.4),
    playerRot: Math.PI,
    move: new THREE.Vector2(0, 0),
    keys: {},
    joy: new THREE.Vector2(0, 0),
    startTime: 0,
    hiddenMs: 0,
    hiddenAt: 0,
    sittingOn: null,
    soundOn: true
  };

  /* ============================================================
   * 基础三件套
   * ============================================================ */
  var canvas = $("#scene");
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    document.body.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#f4ead9;font-family:sans-serif">你的浏览器暂不支持 3D 渲染，请换用较新的 Chrome / Safari / Edge。</div>';
    return;
  }
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
  var maxDPR = isMobile ? 1.75 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDPR));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x342f47, 0.016);

  var camera = new THREE.PerspectiveCamera(isMobile ? 58 : 50, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 6, 26);

  var clock = new THREE.Clock();

  function makeDotTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 64;
    var ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.85)");
    g.addColorStop(0.7, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  var DOT_TEX = makeDotTexture();

  /* ============================================================
   * 天空与远山
   * ============================================================ */
  var SUN_DIR = new THREE.Vector3(-0.34, 0.12, -1).normalize();

  function buildSky() {
    var geo = new THREE.SphereGeometry(260, 32, 20);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0a0d1e) },
        midColor: { value: new THREE.Color(0x3a3150) },
        lowColor: { value: new THREE.Color(0xe89a5c) },
        sunColor: { value: new THREE.Color(0xffc078) },
        sunDir: { value: SUN_DIR.clone() }
      },
      vertexShader: [
        "varying vec3 vWorld;",
        "void main(){",
        "  vec4 wp = modelMatrix * vec4(position, 1.0);",
        "  vWorld = wp.xyz;",
        "  gl_Position = projectionMatrix * viewMatrix * wp;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 topColor; uniform vec3 midColor; uniform vec3 lowColor;",
        "uniform vec3 sunColor; uniform vec3 sunDir;",
        "varying vec3 vWorld;",
        "void main(){",
        "  vec3 dir = normalize(vWorld);",
        "  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);",
        "  vec3 col = mix(lowColor, midColor, smoothstep(0.42, 0.56, h));",
        "  col = mix(col, topColor, smoothstep(0.56, 0.92, h));",
        "  float d = max(dot(dir, normalize(sunDir)), 0.0);",
        "  col += sunColor * pow(d, 32.0) * 0.75;",
        "  col += sunColor * pow(d, 6.0) * 0.10;",
        "  gl_FragColor = vec4(col, 1.0);",
        "}"
      ].join("\n")
    });
    var sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    scene.add(sky);
  }

  function mountainRing(radius, segments, baseY, height, color) {
    var pos = [];
    var idx = [];
    for (var i = 0; i <= segments; i++) {
      var a = (i / segments) * Math.PI * 2;
      var x = Math.cos(a) * radius;
      var z = Math.sin(a) * radius;
      var h = height + 9 * Math.sin(a * 3 + 1.2) + 6 * Math.sin(a * 7 + 0.4) + 3.4 * Math.sin(a * 13 + 2.1);
      h = Math.max(4, h);
      pos.push(x, baseY, z);
      pos.push(x, baseY + h, z);
    }
    for (var j = 0; j < segments; j++) {
      var k = j * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var mat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, fog: true });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  function buildMountains() {
    scene.add(mountainRing(190, 120, -6, 18, 0x2a2742));
    scene.add(mountainRing(140, 100, -6, 26, 0x342f4d));
    scene.add(mountainRing(95, 90, -6, 34, 0x413a58));
    scene.add(mountainRing(58, 80, -5, 26, 0x2d2c40));
  }

  function buildStars() {
    var count = isMobile ? 420 : 900;
    var geo = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var u = Math.random();
      var v = Math.random() * 0.55 + 0.12;
      var theta = u * Math.PI * 2;
      var r = 230;
      var y = Math.sin(v * Math.PI * 0.5) * r;
      positions[i * 3] = Math.cos(theta) * Math.cos(v * Math.PI * 0.5) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * Math.cos(v * Math.PI * 0.5) * r;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xcfd8ff,
      size: isMobile ? 2.6 : 1.8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      fog: false,
      map: DOT_TEX,
      alphaTest: 0.02
    });
    var stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    scene.add(stars);
  }

  function buildMoon() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var ctx = c.getContext("2d");
    var g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, "rgba(255,248,230,1)");
    g.addColorStop(0.35, "rgba(255,244,214,0.95)");
    g.addColorStop(0.62, "rgba(255,226,170,0.35)");
    g.addColorStop(1, "rgba(255,210,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    var moon = new THREE.Sprite(mat);
    moon.scale.set(26, 26, 1);
    moon.position.copy(SUN_DIR).multiplyScalar(210);
    moon.position.y = Math.max(moon.position.y, 24);
    scene.add(moon);
  }

  /* ============================================================
   * 地面、亭子、树
   * ============================================================ */
  var pavilion = new THREE.Group();
  var lanternLights = [];
  var lanternMeshes = [];
  var cushionPositions = [];
  var colliders = [];

  function mat(color, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true
    }, opts || {}));
  }

  function makeFloorTexture() {
    var c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#59402c";
    ctx.fillRect(0, 0, 512, 512);
    var planks = 9;
    for (var i = 0; i < planks; i++) {
      var h = 512 / planks;
      var y = i * h;
      var shade = 70 + Math.floor(Math.random() * 26);
      ctx.fillStyle = "rgb(" + (shade + 22) + "," + (shade - 6) + "," + (shade - 32) + ")";
      ctx.fillRect(0, y + 1, 512, h - 2);
      ctx.strokeStyle = "rgba(24, 14, 8, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
      for (var g = 0; g < 30; g++) {
        ctx.strokeStyle = "rgba(30, 18, 10, " + (0.04 + Math.random() * 0.05) + ")";
        ctx.lineWidth = 1;
        var gy = y + Math.random() * h;
        ctx.beginPath();
        ctx.moveTo(Math.random() * 512, gy);
        ctx.lineTo(Math.random() * 512, gy + (Math.random() - 0.5) * 2);
        ctx.stroke();
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.anisotropy = 4;
    return tex;
  }

  function buildGround() {
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(230, 64),
      new THREE.MeshStandardMaterial({ color: 0x20281f, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    ground.receiveShadow = true;
    scene.add(ground);

    // 石台
    var stone = new THREE.Mesh(
      new THREE.CylinderGeometry(7.4, 7.9, 0.62, 8),
      mat(0x44444a, { roughness: 0.95 })
    );
    stone.position.y = -0.31;
    stone.rotation.y = Math.PI / 8;
    stone.receiveShadow = true;
    stone.castShadow = true;
    scene.add(stone);

    // 木地板
    var floor = new THREE.Mesh(
      new THREE.CylinderGeometry(6.3, 6.3, 0.24, 8),
      mat(0x5b422e, { roughness: 0.85 })
    );
    floor.position.y = 0.12;
    floor.rotation.y = Math.PI / 8;
    floor.receiveShadow = true;
    scene.add(floor);

    var floorTop = new THREE.Mesh(
      new THREE.CircleGeometry(6.28, 8, Math.PI / 8),
      new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.9, metalness: 0 })
    );
    floorTop.rotation.x = -Math.PI / 2;
    floorTop.position.y = 0.245;
    floorTop.receiveShadow = true;
    scene.add(floorTop);

    // 山门小径
    for (var i = 0; i < 9; i++) {
      var slab = new THREE.Mesh(new THREE.BoxGeometry(1.4 + Math.random() * 0.3, 0.12, 0.9), mat(0x4a4a4d, { roughness: 1 }));
      slab.position.set((Math.random() - 0.5) * 0.35, -0.54, 7.4 + i * 1.15);
      slab.rotation.y = (Math.random() - 0.5) * 0.12;
      slab.receiveShadow = true;
      scene.add(slab);
    }
  }

  function buildPavilion() {
    // 立柱
    var pillarMat = mat(0x6a4b33);
    var pillarGeo = new THREE.CylinderGeometry(0.17, 0.2, 3.8, 8);
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      var x = Math.sin(a) * 4.9;
      var z = Math.cos(a) * 4.9;
      var pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, 2.05, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      pavilion.add(pillar);
      colliders.push({ x: x, z: z, r: 0.45 });

      // 柱础
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 8), mat(0x3c3c40));
      base.position.set(x, 0.32, z);
      pavilion.add(base);
    }

    // 横梁
    var beamMat = mat(0x513a29);
    for (var j = 0; j < 6; j++) {
      var a1 = (j / 6) * Math.PI * 2 + Math.PI / 6;
      var a2 = ((j + 1) / 6) * Math.PI * 2 + Math.PI / 6;
      var p1 = new THREE.Vector3(Math.sin(a1) * 4.9, 0, Math.cos(a1) * 4.9);
      var p2 = new THREE.Vector3(Math.sin(a2) * 4.9, 0, Math.cos(a2) * 4.9);
      var mid = p1.clone().add(p2).multiplyScalar(0.5);
      var len = p1.distanceTo(p2);
      var beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, len), beamMat);
      beam.position.set(mid.x, 3.82, mid.z);
      beam.lookAt(p2.x, 3.82, p2.z);
      beam.castShadow = true;
      pavilion.add(beam);

      // 栏杆（正面留出入口）
      if (j !== 0) {
        var rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len * 0.94), beamMat);
        rail.position.set(mid.x * 0.98, 1.02, mid.z * 0.98);
        rail.lookAt(p2.x * 0.98, 1.02, p2.z * 0.98);
        pavilion.add(rail);
        var rail2 = rail.clone();
        rail2.position.y = 0.62;
        pavilion.add(rail2);
      }
    }

    // 屋顶
    var roof = new THREE.Mesh(
      new THREE.ConeGeometry(7.1, 2.5, 6, 1, false),
      mat(0x332c2f, { roughness: 0.9 })
    );
    roof.position.y = 5.55;
    roof.rotation.y = Math.PI / 6;
    roof.castShadow = true;
    pavilion.add(roof);

    var roofTrim = new THREE.Mesh(
      new THREE.CylinderGeometry(7.06, 7.12, 0.13, 6, 1, true),
      mat(0x7a5a34, { metalness: 0.25, roughness: 0.55, side: THREE.DoubleSide })
    );
    roofTrim.position.y = 4.36;
    roofTrim.rotation.y = Math.PI / 6;
    pavilion.add(roofTrim);

    var finial = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(0x8a6a3c, { metalness: 0.45, roughness: 0.35 }));
    finial.position.y = 6.95;
    pavilion.add(finial);

    // 屋檐下暗色顶棚
    var underside = new THREE.Mesh(
      new THREE.CylinderGeometry(4.55, 4.55, 0.07, 6),
      mat(0x211c1f)
    );
    underside.position.y = 4.2;
    underside.rotation.y = Math.PI / 6;
    pavilion.add(underside);

    // 台阶
    for (var s = 0; s < 3; s++) {
      var step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 1.0), mat(0x4d4d51));
      step.position.set(0, -0.12 - s * 0.18, 6.4 + s * 0.85);
      step.receiveShadow = true;
      step.castShadow = true;
      pavilion.add(step);
    }

    // 灯笼
    var lanternGeo = new THREE.SphereGeometry(0.26, 12, 10);
    for (var l = 0; l < 4; l++) {
      var la = (l / 4) * Math.PI * 2 + Math.PI / 4;
      var lx = Math.sin(la) * 3.1;
      var lz = Math.cos(la) * 3.1;
      var lantern = new THREE.Mesh(lanternGeo, new THREE.MeshStandardMaterial({
        color: 0xffc07a,
        emissive: 0xff8f3d,
        emissiveIntensity: 1.15,
        roughness: 0.6
      }));
      lantern.position.set(lx, 3.22, lz);
      pavilion.add(lantern);
      lanternMeshes.push(lantern);

      var light = new THREE.PointLight(0xffa458, 1.05, 10, 2);
      light.position.set(lx, 3.1, lz);
      pavilion.add(light);
      lanternLights.push(light);

      var cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4), mat(0x2a2327));
      cord.position.set(lx, 3.72, lz);
      pavilion.add(cord);
    }

    // 中央矮几与灯
    var table = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.34, 12), mat(0x4b3527));
    table.position.y = 0.45;
    table.receiveShadow = true;
    table.castShadow = true;
    pavilion.add(table);

    var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.3, 0.2, 12), mat(0x3d3d42, { metalness: 0.3, roughness: 0.6 }));
    bowl.position.y = 0.7;
    pavilion.add(bowl);

    var glow = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshStandardMaterial({
      color: 0xffcf96, emissive: 0xff9f4d, emissiveIntensity: 1.5, roughness: 0.4
    }));
    glow.position.y = 0.86;
    pavilion.add(glow);
    lanternMeshes.push(glow);

    var tableLight = new THREE.PointLight(0xffb066, 0.85, 8, 2);
    tableLight.position.set(0, 1.05, 0);
    pavilion.add(tableLight);
    lanternLights.push(tableLight);

    // 蒲团
    var cushionColors = [0x7c4a3c, 0x565a45, 0x5d4a63, 0x6b5238, 0x4c4a58, 0x74444a];
    for (var c = 0; c < 6; c++) {
      var ca = (c / 6) * Math.PI * 2 + Math.PI / 6;
      var cx = Math.sin(ca) * 2.75;
      var cz = Math.cos(ca) * 2.75;
      var cushion = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.68, 0.16, 16),
        mat(cushionColors[c], { roughness: 1 })
      );
      cushion.position.set(cx, 0.2, cz);
      cushion.receiveShadow = true;
      pavilion.add(cushion);
      cushionPositions.push(new THREE.Vector3(cx, 0, cz));
    }

    scene.add(pavilion);
  }

  function buildTrees() {
    var trunkMat = mat(0x3c2c22);
    var leafColors = [0x243528, 0x2b3d2b, 0x1f3025, 0x30422f];
    var count = isMobile ? 22 : 38;
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = 14 + Math.random() * 24;
      if (Math.abs(Math.sin(a) * r) < 4 && Math.cos(a) * r > 4) continue; // 留出小径
      var x = Math.sin(a) * r;
      var z = Math.cos(a) * r;
      var s = 0.7 + Math.random() * 1.5;
      var tree = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.14 * s, 1.1 * s, 5), trunkMat);
      trunk.position.y = 0.55 * s;
      tree.add(trunk);
      for (var k = 0; k < 3; k++) {
        var cone = new THREE.Mesh(
          new THREE.ConeGeometry((0.95 - k * 0.22) * s, (1.5 - k * 0.2) * s, 6),
          mat(leafColors[Math.floor(Math.random() * leafColors.length)])
        );
        cone.position.y = (1.25 + k * 0.72) * s;
        cone.castShadow = !isMobile;
        tree.add(cone);
      }
      tree.position.set(x, -0.6, z);
      tree.rotation.y = Math.random() * Math.PI;
      scene.add(tree);
    }
  }

  function buildFireflies() {
    var count = isMobile ? 40 : 80;
    var geo = new THREE.BufferGeometry();
    var positions = new Float32Array(count * 3);
    var seeds = [];
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var r = 2 + Math.random() * 11;
      positions[i * 3] = Math.sin(a) * r;
      positions[i * 3 + 1] = 0.4 + Math.random() * 3.4;
      positions[i * 3 + 2] = Math.cos(a) * r;
      seeds.push({ a: a, r: r, y: positions[i * 3 + 1], p: Math.random() * Math.PI * 2, sp: 0.2 + Math.random() * 0.5 });
    }
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xffcf8a,
      size: 0.16,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      map: DOT_TEX,
      alphaTest: 0.02
    });
    var points = new THREE.Points(geo, mat);
    scene.add(points);
    return { points: points, seeds: seeds };
  }

  /* ============================================================
   * 人物
   * ============================================================ */
  function createFigure(robeColor) {
    var g = new THREE.Group();
    var skin = 0xe6c39c;
    var robeMat = mat(robeColor, { roughness: 1 });
    var skinMat = mat(skin, { roughness: 0.9 });
    var hairMat = mat(0x241c18, { roughness: 1 });

    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.46, 0.95, 8), robeMat);
    body.position.y = 0.92;
    body.castShadow = true;
    g.add(body);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 14, 12), skinMat);
    head.position.y = 1.62;
    head.castShadow = true;
    g.add(head);

    var hair = new THREE.Mesh(new THREE.SphereGeometry(0.245, 14, 12), hairMat);
    hair.scale.set(1, 0.78, 1);
    hair.position.set(0, 1.7, -0.02);
    g.add(hair);

    var armGeo = new THREE.CapsuleGeometry(0.07, 0.42, 4, 6);
    var armL = new THREE.Mesh(armGeo, robeMat);
    armL.position.set(-0.31, 1.16, 0);
    armL.rotation.z = 0.16;
    armL.castShadow = true;
    g.add(armL);

    var armR = new THREE.Mesh(armGeo, robeMat);
    armR.position.set(0.31, 1.16, 0);
    armR.rotation.z = -0.16;
    armR.castShadow = true;
    g.add(armR);

    var eyeGeo = new THREE.SphereGeometry(0.018, 6, 6);
    var eyeMat = mat(0x2a211c, { roughness: 1 });
    var eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.075, 1.635, 0.225);
    g.add(eyeL);
    var eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.075, 1.635, 0.225);
    g.add(eyeR);

    var legs = new THREE.Group();
    var legGeo = new THREE.CapsuleGeometry(0.085, 0.34, 4, 6);
    var legL = new THREE.Mesh(legGeo, robeMat);
    legL.position.set(-0.13, 0.26, 0);
    legs.add(legL);
    var legR = new THREE.Mesh(legGeo, robeMat);
    legR.position.set(0.13, 0.26, 0);
    legs.add(legR);
    g.add(legs);

    g.userData = { body: body, head: head, hair: hair, armL: armL, armR: armR, legs: legs, robe: robeMat };
    return g;
  }

  var player = createFigure(ROBE_COLORS[Math.floor(Math.random() * ROBE_COLORS.length)]);
  player.position.copy(state.playerPos);
  player.rotation.y = state.playerRot;
  scene.add(player);

  var npcs = [];
  function buildNPCs() {
    var indices = [1, 3, 5];
    for (var i = 0; i < indices.length; i++) {
      var idx = indices[i];
      var pos = cushionPositions[idx];
      var npc = createFigure(ROBE_COLORS[(i + 2) % ROBE_COLORS.length]);
      npc.position.set(pos.x, 0.28, pos.z);
      npc.rotation.y = Math.atan2(-pos.x, -pos.z);
      npc.scale.setScalar(0.92);
      applySitPose(npc, 1);
      scene.add(npc);
      npcs.push({ obj: npc, phase: Math.random() * Math.PI * 2 });
    }
  }

  function applySitPose(fig, t) {
    var u = fig.userData;
    u.legs.visible = t < 0.5;
    u.body.position.y = lerp(0.92, 0.58, t);
    u.body.scale.y = lerp(1, 0.82, t);
    u.head.position.y = lerp(1.62, 1.16, t);
    u.hair.position.y = lerp(1.7, 1.24, t);
    u.armL.position.set(lerp(-0.31, -0.25, t), lerp(1.16, 0.86, t), lerp(0, 0.14, t));
    u.armR.position.set(lerp(0.31, 0.25, t), lerp(1.16, 0.86, t), lerp(0, 0.14, t));
    u.armL.rotation.z = lerp(0.16, 0.25, t);
    u.armR.rotation.z = lerp(-0.16, -0.25, t);
    u.legs.position.y = lerp(0, 0.1, t);
    u.legs.rotation.x = lerp(0, Math.PI / 2.6, t);
    u.legs.position.z = lerp(0, 0.25, t);
  }

  /* ============================================================
   * 灯光
   * ============================================================ */
  function buildLights() {
    var hemi = new THREE.HemisphereLight(0x9aa8d8, 0x2a221c, 0.6);
    scene.add(hemi);

    var sun = new THREE.DirectionalLight(0xffb27a, 0.9);
    sun.position.copy(SUN_DIR).multiplyScalar(38);
    sun.castShadow = true;
    sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    var fill = new THREE.DirectionalLight(0x6f7fbf, 0.35);
    fill.position.set(12, 18, 14);
    scene.add(fill);
  }

  /* ============================================================
   * 初始化
   * ============================================================ */
  var fireflies;
  buildSky();
  buildStars();
  buildMoon();
  buildMountains();
  buildGround();
  buildPavilion();
  buildTrees();
  buildLights();
  buildNPCs();
  fireflies = buildFireflies();

  /* ============================================================
   * 相机与交互
   * ============================================================ */
  var pointers = new Map();
  var drag = { active: false, x: 0, y: 0, moved: 0 };
  var pinch = { active: false, dist: 0 };

  function updateCamera(dt, immediate) {
    var target = new THREE.Vector3(player.position.x, player.position.y + (state.sitting ? 0.9 : 1.15), player.position.z);
    var yaw = state.yaw;
    var pitch = state.pitch;
    var aspect = window.innerWidth / Math.max(1, window.innerHeight);
    var dist = state.dist * (aspect < 1 ? 1 + (1 - aspect) * 0.85 : 1);
    var cp = Math.cos(pitch);
    var desired = new THREE.Vector3(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * cp * dist
    );
    if (immediate) {
      camera.position.copy(desired);
    } else {
      camera.position.x = damp(camera.position.x, desired.x, 7, dt);
      camera.position.y = damp(camera.position.y, desired.y, 7, dt);
      camera.position.z = damp(camera.position.z, desired.z, 7, dt);
    }
    camera.lookAt(target);
  }

  function onPointerDown(e) {
    if (e.target.closest && e.target.closest(".actions, .topbar, .panel, .joystick, .intro")) return;
    if (e.pointerType === "touch" && pointers.size === 1) {
      // 双指缩放准备
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinch.active = true;
      pinch.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      drag.active = false;
      return;
    }
    drag.active = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved = 0;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.active && pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.dist > 0) {
        state.targetDist = clamp(state.targetDist * (pinch.dist / d), 4.2, 14);
      }
      pinch.dist = d;
      return;
    }
    if (!drag.active) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    state.yaw -= dx * 0.005;
    state.pitch = clamp(state.pitch + dy * 0.004, -0.18, 1.15);
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch.active = false;
    if (pointers.size === 0) drag.active = false;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    state.targetDist = clamp(state.targetDist + e.deltaY * 0.004, 4.2, 14);
  }, { passive: false });

  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    state.keys[k] = true;
    if (k === "w" || k === "a" || k === "s" || k === "d" || k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright") {
      e.preventDefault();
    }
    if (k === "enter" && !state.entered) enter();
    if (k === "e") toggleSit();
  });
  window.addEventListener("keyup", function (e) {
    state.keys[e.key.toLowerCase()] = false;
  });

  /* 摇杆 */
  var joyEl = $("#joystick");
  var knobEl = $("#joystick-knob");
  var joyId = null;
  var joyCenter = { x: 0, y: 0 };

  function joystickStart(e) {
    e.preventDefault();
    e.stopPropagation();
    joyId = e.pointerId;
    var rect = joyEl.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joyEl.setPointerCapture(e.pointerId);
    joystickMove(e);
  }
  function joystickMove(e) {
    if (e.pointerId !== joyId) return;
    var dx = e.clientX - joyCenter.x;
    var dy = e.clientY - joyCenter.y;
    var max = 38;
    var len = Math.hypot(dx, dy) || 1;
    var cl = Math.min(len, max);
    var nx = (dx / len) * cl;
    var ny = (dy / len) * cl;
    knobEl.style.transform = "translate(" + nx + "px," + ny + "px)";
    state.joy.set(nx / max, ny / max);
  }
  function joystickEnd(e) {
    if (e.pointerId !== joyId) return;
    joyId = null;
    knobEl.style.transform = "translate(0,0)";
    state.joy.set(0, 0);
  }
  joyEl.addEventListener("pointerdown", joystickStart);
  joyEl.addEventListener("pointermove", joystickMove);
  joyEl.addEventListener("pointerup", joystickEnd);
  joyEl.addEventListener("pointercancel", joystickEnd);

  /* ============================================================
   * 移动与静坐
   * ============================================================ */
  function updatePlayer(dt, t) {
    var forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    var right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    var input = new THREE.Vector2(0, 0);
    if (state.keys["w"] || state.keys["arrowup"]) input.y += 1;
    if (state.keys["s"] || state.keys["arrowdown"]) input.y -= 1;
    if (state.keys["d"] || state.keys["arrowright"]) input.x += 1;
    if (state.keys["a"] || state.keys["arrowleft"]) input.x -= 1;
    input.x += state.joy.x;
    input.y -= state.joy.y;
    if (input.lengthSq() > 1) input.normalize();

    var moving = input.lengthSq() > 0.002 && !state.sitting;
    if (moving) {
      var speed = 2.35;
      var delta = new THREE.Vector3()
        .addScaledVector(forward, input.y * speed * dt)
        .addScaledVector(right, input.x * speed * dt);
      state.playerPos.add(delta);
      var r = Math.hypot(state.playerPos.x, state.playerPos.z);
      if (r > 8.4) {
        state.playerPos.x *= 8.4 / r;
        state.playerPos.z *= 8.4 / r;
      }
      for (var i = 0; i < colliders.length; i++) {
        var c = colliders[i];
        var dx = state.playerPos.x - c.x;
        var dz = state.playerPos.z - c.z;
        var d = Math.hypot(dx, dz);
        if (d < c.r && d > 0.0001) {
          state.playerPos.x = c.x + (dx / d) * c.r;
          state.playerPos.z = c.z + (dz / d) * c.r;
        }
      }
      state.playerRot = Math.atan2(delta.x, delta.z);
    }

    player.position.x = damp(player.position.x, state.playerPos.x, 18, dt);
    player.position.z = damp(player.position.z, state.playerPos.z, 18, dt);
    player.position.y = state.sitting ? 0.26 : 0.06 + (moving ? Math.abs(Math.sin(t * 9)) * 0.045 : Math.sin(t * 1.6) * 0.012);

    var ry = player.rotation.y;
    var diff = ((state.playerRot - ry + Math.PI) % (Math.PI * 2)) - Math.PI;
    player.rotation.y = ry + diff * Math.min(1, dt * 12);

    // 行走摆动
    var sw = moving ? Math.sin(t * 9) * 0.5 : 0;
    player.userData.armL.rotation.x = sw;
    player.userData.armR.rotation.x = -sw;
    if (state.sitting) {
      applySitPose(player, 1);
      player.userData.body.position.y = 0.58 + Math.sin(t * 1.4) * 0.008;
    } else {
      applySitPose(player, 0);
    }
  }

  function nearestCushion() {
    var best = null;
    var bestD = 1.55;
    for (var i = 0; i < cushionPositions.length; i++) {
      var p = cushionPositions[i];
      var d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function toggleSit() {
    if (!state.entered) return;
    if (state.sitting) {
      state.sitting = false;
      state.sittingOn = null;
      state.targetDist = 9;
      state.playerPos.set(player.position.x, 0, player.position.z + 0.9);
      $("#btn-sit").textContent = "静坐";
      $("#status").textContent = "在亭中";
      $("#btn-breathe").classList.add("hidden");
      toast("起身走走也好。");
      return;
    }
    var idx = nearestCushion();
    if (idx === null) {
      toast("走近蒲团再坐下。");
      return;
    }
    state.sitting = true;
    state.sittingOn = idx;
    var p = cushionPositions[idx];
    state.playerPos.set(p.x, 0, p.z);
    player.position.set(p.x, 0.26, p.z);
    state.playerRot = Math.atan2(-p.x, -p.z);
    player.rotation.y = state.playerRot;
    state.targetDist = 7.0;
    $("#btn-sit").textContent = "起身";
    $("#status").textContent = "静坐中";
    $("#btn-breathe").classList.remove("hidden");
    if (window.Sound && window.Sound.enabled) window.Sound.playClick();
    toast("坐一会儿。什么都不用做。");
  }

  /* ============================================================
   * 呼吸
   * ============================================================ */
  var breath = {
    active: false,
    raf: 0,
    count: 0,
    phase: "inhale",
    phaseStart: 0,
    duration: { inhale: 4000, hold: 1200, exhale: 4800 }
  };
  var breathCircle = $("#breath-circle");
  var breathWord = $("#breath-word");
  var breathCount = $("#breath-count");

  function startBreath() {
    if (!state.entered) return;
    breath.active = true;
    breath.count = 0;
    breath.phase = "inhale";
    breath.phaseStart = performance.now();
    breathCount.textContent = "0";
    breathCircle.style.transform = "scale(0.8)";
    breathWord.textContent = "吸气";
    $("#breath").classList.remove("hidden");
    tickBreath(performance.now());
  }

  function stopBreath() {
    breath.active = false;
    if (breath.raf) cancelAnimationFrame(breath.raf);
    $("#breath").classList.add("hidden");
  }

  function tickBreath(now) {
    if (!breath.active) return;
    var elapsed = now - breath.phaseStart;
    var dur = breath.duration[breath.phase];
    var p = clamp(elapsed / dur, 0, 1);

    if (breath.phase === "inhale") {
      breathCircle.style.transform = "scale(" + lerp(0.8, 1.42, easeInOut(p)) + ")";
      breathWord.textContent = "吸气";
      if (p >= 1) {
        breath.phase = "hold";
        breath.phaseStart = now;
        breathWord.textContent = "停一停";
      }
    } else if (breath.phase === "hold") {
      if (p >= 1) {
        breath.phase = "exhale";
        breath.phaseStart = now;
        breathWord.textContent = "呼气";
      }
    } else {
      breathCircle.style.transform = "scale(" + lerp(1.42, 0.8, easeInOut(p)) + ")";
      if (p >= 1) {
        breath.count += 1;
        breathCount.textContent = String(breath.count);
        if (breath.count >= 108) {
          stopBreath();
          toast("108 息完成。慢慢睁开眼睛。");
          return;
        }
        breath.phase = "inhale";
        breath.phaseStart = now;
        breathWord.textContent = "吸气";
      }
    }
    breath.raf = requestAnimationFrame(tickBreath);
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  /* ============================================================
   * 数息珠
   * ============================================================ */
  var beadsGrid = $("#beads-grid");
  var beadsCount = $("#beads-count");
  var beadEls = [];
  var beadOn = 0;

  function buildBeads() {
    for (var i = 0; i < 108; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bead";
      b.setAttribute("aria-label", "第 " + (i + 1) + " 颗");
      b.addEventListener("click", onBead);
      beadsGrid.appendChild(b);
      beadEls.push(b);
    }
  }

  function onBead(e) {
    var b = e.currentTarget;
    if (b.classList.contains("on")) return;
    b.classList.add("on");
    beadOn += 1;
    beadsCount.textContent = String(beadOn);
    if (window.Sound && window.Sound.enabled) window.Sound.playClick();
    if (beadOn === 108) toast("一轮完成 · 108 颗");
  }

  function resetBeads() {
    beadEls.forEach(function (b) { b.classList.remove("on"); });
    beadOn = 0;
    beadsCount.textContent = "0";
  }

  /* ============================================================
   * UI 事件
   * ============================================================ */
  function toast(text) {
    var el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  function openPanel(id) {
    $("#" + id).classList.remove("hidden");
  }
  function closePanel(id) {
    $("#" + id).classList.add("hidden");
  }

  function enter() {
    if (state.entered) return;
    state.entered = true;
    state.startTime = Date.now();
    $("#pname").textContent = NAMES[Math.floor(Math.random() * NAMES.length)];
    state.targetDist = 8.6;
    var intro = $("#intro");
    intro.classList.add("is-gone");
    document.body.classList.add("entered");
    setTimeout(function () { intro.style.display = "none"; }, 1400);
    $("#app").classList.remove("is-loading");

    if (window.Sound) {
      window.Sound.init();
      window.Sound.setEnabled(true);
      window.Sound.playEnter();
    }
    setTimeout(function () { toast("慢慢来，不必做什么。"); }, 1200);
    setTimeout(function () { $("#hint").classList.add("is-faded"); }, 9000);
  }

  $("#btn-enter").addEventListener("click", enter);
  $("#btn-sit").addEventListener("click", toggleSit);
  $("#btn-breathe").addEventListener("click", startBreath);
  $("#btn-breath-exit").addEventListener("click", stopBreath);
  $("#btn-beads").addEventListener("click", function () {
    if (window.Sound && window.Sound.enabled) window.Sound.playClick();
    openPanel("beads");
  });
  $("#btn-beads-reset").addEventListener("click", resetBeads);
  $("#btn-woodfish").addEventListener("click", function () {
    if (window.Sound) {
      window.Sound.init();
      if (!window.Sound.enabled) window.Sound.setEnabled(true);
      window.Sound.playWoodfish();
    }
    this.classList.remove("tap");
    void this.offsetWidth;
    this.classList.add("tap");
  });

  $("#btn-sound").addEventListener("click", function () {
    openPanel("sound-panel");
  });
  $("#btn-about").addEventListener("click", function () {
    openPanel("about");
  });
  $("#btn-full").addEventListener("click", function () {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  });

  $$("[data-close]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closePanel(btn.getAttribute("data-close"));
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      ["beads", "sound-panel", "about"].forEach(closePanel);
      if (breath.active) stopBreath();
    }
  });

  /* 声音开关 */
  var ambMaster = $("#amb-master");
  var soundBtn = $("#btn-sound");
  function syncSoundBtn() {
    var on = window.Sound && window.Sound.enabled;
    soundBtn.classList.toggle("is-off", !on);
    soundBtn.setAttribute("aria-label", on ? "声音已开启" : "声音已关闭");
  }
  ambMaster.addEventListener("change", function () {
    if (window.Sound) {
      window.Sound.init();
      window.Sound.setEnabled(ambMaster.checked);
      syncSoundBtn();
    }
  });
  [["wind", "amb-wind"], ["birds", "amb-birds"], ["stream", "amb-stream"], ["bell", "amb-bell"]].forEach(function (pair) {
    var el = $("#" + pair[1]);
    el.addEventListener("change", function () {
      if (window.Sound) window.Sound.setAmbience(pair[0], el.checked);
    });
  });

  /* 触屏显示摇杆 */
  if (isMobile) {
    document.body.classList.add("touch");
    $("#hint").textContent = "拖动环顾 · 摇杆移动 · 走近蒲团静坐";
  }

  /* ============================================================
   * 计时器
   * ============================================================ */
  function fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      state.hiddenAt = Date.now();
    } else if (state.hiddenAt) {
      state.hiddenMs += Date.now() - state.hiddenAt;
      state.hiddenAt = 0;
    }
  });
  setInterval(function () {
    if (!state.entered) return;
    var sec = (Date.now() - state.startTime - state.hiddenMs) / 1000;
    if (state.hiddenAt) sec -= (Date.now() - state.hiddenAt) / 1000;
    $("#timer").textContent = fmt(Math.max(0, sec));
  }, 1000);

  /* ============================================================
   * 主循环
   * ============================================================ */
  var lastNear = "";
  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;

    if (!state.entered) {
      state.introOrbit += dt * 0.06;
      state.yaw = 0.18 + Math.sin(state.introOrbit) * 0.18;
      state.dist = damp(state.dist, 13.5, 1.2, dt);
    } else {
      state.dist = damp(state.dist, state.targetDist, 4.5, dt);
      updatePlayer(dt, t);
    }

    // 镜头
    updateCamera(dt, false);

    // 静坐提示
    if (state.entered && !state.sitting) {
      var near = nearestCushion();
      var inside = Math.hypot(player.position.x, player.position.z) < 5.5;
      var statusText = near !== null ? "蒲团旁" : (inside ? "在亭中" : "在亭外");
      if (statusText !== lastNear) {
        lastNear = statusText;
        $("#status").textContent = statusText;
      }
      var btn = $("#btn-sit");
      if (near !== null) btn.classList.add("ready");
      else btn.classList.remove("ready");
    }

    // 灯笼呼吸
    for (var i = 0; i < lanternLights.length; i++) {
      var l = lanternLights[i];
      l.intensity = 0.95 + Math.sin(t * 1.7 + i * 1.3) * 0.14;
    }
    for (var j = 0; j < lanternMeshes.length; j++) {
      lanternMeshes[j].material.emissiveIntensity = 1.5 + Math.sin(t * 2.1 + j) * 0.15;
    }

    // NPC 呼吸
    for (var n = 0; n < npcs.length; n++) {
      var npc = npcs[n];
      npc.obj.position.y = 0.28 + Math.sin(t * 0.9 + npc.phase) * 0.012;
    }

    // 萤火
    if (fireflies) {
      var pos = fireflies.points.geometry.attributes.position;
      for (var f = 0; f < fireflies.seeds.length; f++) {
        var s = fireflies.seeds[f];
        var ang = s.a + t * 0.05 * s.sp;
        pos.array[f * 3] = Math.sin(ang) * s.r;
        pos.array[f * 3 + 1] = s.y + Math.sin(t * 0.7 + s.p) * 0.5;
        pos.array[f * 3 + 2] = Math.cos(ang) * s.r;
      }
      pos.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDPR));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  buildBeads();
  updateCamera(0, true);
  animate();

  // 首帧后显示 UI
  requestAnimationFrame(function () {
    setTimeout(function () {
      $("#app").classList.remove("is-loading");
    }, 350);
  });
})();
