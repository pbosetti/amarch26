(() => {
  "use strict";

  if (window.__reconstructionWebglLoaded) {
    return;
  }
  window.__reconstructionWebglLoaded = true;

  const fallbackFeaturePoints = [
    [-0.34, 0.28, 0.52],
    [0.08, 0.35, 0.6],
    [0.36, 0.04, 0.5],
    [-0.14, -0.28, 0.48],
  ];

  const featureTargets = [
    [-0.28, 0.22],
    [0.02, 0.28],
    [0.25, 0.02],
    [-0.08, -0.25],
  ];

  const featureColors = [
    [0.11, 0.58, 0.35, 1],
    [0.9, 0.62, 0.12, 1],
    [0.74, 0.18, 0.32, 1],
    [0.1, 0.43, 0.78, 1],
  ];

  const structuredLightLaserSource = [-1.35, 0.58, 2.35];

  const vertexShaderSource = `
    attribute vec3 a_position;
    attribute vec4 a_color;
    attribute vec3 a_normal;
    attribute vec2 a_texcoord;

    uniform mat4 u_mvp;
    uniform vec3 u_light_dir;
    uniform float u_point_size;
    uniform float u_use_lighting;

    varying vec4 v_color;
    varying vec2 v_texcoord;

    void main() {
      vec3 normal = normalize(a_normal);
      float diffuse = max(dot(normal, normalize(u_light_dir)), 0.0);
      float light = mix(1.0, 0.42 + diffuse * 0.58, u_use_lighting);
      v_color = vec4(a_color.rgb * light, a_color.a);
      v_texcoord = a_texcoord;
      gl_Position = u_mvp * vec4(a_position, 1.0);
      gl_PointSize = u_point_size;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform float u_round_points;
    uniform float u_use_texture;
    uniform sampler2D u_texture;
    varying vec4 v_color;
    varying vec2 v_texcoord;

    void main() {
      if (u_round_points > 0.5) {
        vec2 d = gl_PointCoord - vec2(0.5, 0.5);
        if (dot(d, d) > 0.25) {
          discard;
        }
      }
      vec4 color = v_color;
      if (u_use_texture > 0.5) {
        color *= texture2D(u_texture, v_texcoord);
      }
      gl_FragColor = color;
    }
  `;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isPowerOf2(value) {
    return value > 0 && (value & (value - 1)) === 0;
  }

  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function scale(v, s) {
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function length(v) {
    return Math.hypot(v[0], v[1], v[2]);
  }

  function normalize(v) {
    const len = length(v);
    if (len < 0.00001) {
      return [0, 0, 0];
    }
    return scale(v, 1 / len);
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }

  function lookAt(eye, center, up) {
    const z = normalize(sub(eye, center));
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    const out = new Float32Array(16);
    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[3] = 0;
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[7] = 0;
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[11] = 0;
    out[12] = -dot(x, eye);
    out[13] = -dot(y, eye);
    out[14] = -dot(z, eye);
    out[15] = 1;
    return out;
  }

  function multiplyMat4(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function transformPoint(m, p) {
    const x = p[0];
    const y = p[1];
    const z = p[2];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15],
    ];
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message || "Could not link WebGL program.");
    }
    return program;
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || "Could not compile WebGL shader.");
    }
    return shader;
  }

  function makeGeometry() {
    return {
      positions: [],
      colors: [],
      normals: [],
    };
  }

  function pushVertex(geometry, position, color, normal) {
    geometry.positions.push(position[0], position[1], position[2]);
    geometry.colors.push(color[0], color[1], color[2], color[3]);
    geometry.normals.push(normal[0], normal[1], normal[2]);
  }

  function addTriangle(geometry, a, b, c, color, normal) {
    const n = normal || normalize(cross(sub(b, a), sub(c, a)));
    pushVertex(geometry, a, color, n);
    pushVertex(geometry, b, color, n);
    pushVertex(geometry, c, color, n);
  }

  function addQuad(geometry, a, b, c, d, color, normal) {
    addTriangle(geometry, a, b, c, color, normal);
    addTriangle(geometry, a, c, d, color, normal);
  }

  function addLine(geometry, a, b, color) {
    const n = [0, 1, 0];
    pushVertex(geometry, a, color, n);
    pushVertex(geometry, b, color, n);
  }

  function addPoint(geometry, point, color) {
    pushVertex(geometry, point, color, [0, 1, 0]);
  }

  function addPolyline(geometry, points, color) {
    for (let i = 1; i < points.length; i += 1) {
      addLine(geometry, points[i - 1], points[i], color);
    }
  }

  function addTube(geometry, a, b, radius, color, segments = 8) {
    const axis = normalize(sub(b, a));
    if (length(axis) < 0.00001) {
      return;
    }
    const seed = Math.abs(axis[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
    const u = normalize(cross(axis, seed));
    const v = normalize(cross(axis, u));
    for (let i = 0; i < segments; i += 1) {
      const t0 = (Math.PI * 2 * i) / segments;
      const t1 = (Math.PI * 2 * (i + 1)) / segments;
      const n0 = add(scale(u, Math.cos(t0)), scale(v, Math.sin(t0)));
      const n1 = add(scale(u, Math.cos(t1)), scale(v, Math.sin(t1)));
      const a0 = add(a, scale(n0, radius));
      const a1 = add(a, scale(n1, radius));
      const b0 = add(b, scale(n0, radius));
      const b1 = add(b, scale(n1, radius));
      addTriangle(geometry, a0, b0, b1, color, n0);
      addTriangle(geometry, a0, b1, a1, color, n1);
    }
  }

  function createFallbackObjectMesh() {
    const geometry = makeGeometry();
    const stacks = 18;
    const slices = 28;
    const scaleX = 0.78;
    const scaleY = 0.58;
    const scaleZ = 0.5;

    function point(lat, lon) {
      const noise =
        1 +
        0.06 * Math.sin(lon * 4.0 + lat * 2.0) +
        0.035 * Math.cos(lon * 7.0 - lat * 3.0);
      const cosLat = Math.cos(lat);
      const unit = [cosLat * Math.cos(lon), Math.sin(lat), cosLat * Math.sin(lon)];
      const position = [
        unit[0] * scaleX * noise,
        unit[1] * scaleY * noise + 0.02,
        unit[2] * scaleZ * noise,
      ];
      const normal = normalize([unit[0] / scaleX, unit[1] / scaleY, unit[2] / scaleZ]);
      return { position, normal, shade: noise };
    }

    for (let stack = 0; stack < stacks; stack += 1) {
      const lat0 = -Math.PI / 2 + (Math.PI * stack) / stacks;
      const lat1 = -Math.PI / 2 + (Math.PI * (stack + 1)) / stacks;
      for (let slice = 0; slice < slices; slice += 1) {
        const lon0 = (Math.PI * 2 * slice) / slices;
        const lon1 = (Math.PI * 2 * (slice + 1)) / slices;
        const p00 = point(lat0, lon0);
        const p10 = point(lat1, lon0);
        const p11 = point(lat1, lon1);
        const p01 = point(lat0, lon1);
        const color = [
          0.63 + (p00.shade - 1) * 0.9,
          0.34 + (p10.shade - 1) * 0.45,
          0.2 + (p11.shade - 1) * 0.28,
          1,
        ];
        pushVertex(geometry, p00.position, color, p00.normal);
        pushVertex(geometry, p10.position, color, p10.normal);
        pushVertex(geometry, p11.position, color, p11.normal);
        pushVertex(geometry, p00.position, color, p00.normal);
        pushVertex(geometry, p11.position, color, p11.normal);
        pushVertex(geometry, p01.position, color, p01.normal);
      }
    }
    return {
      ...geometry,
      bounds: {
        min: [-scaleX, -scaleY, -scaleZ],
        max: [scaleX, scaleY, scaleZ],
      },
      featurePoints: fallbackFeaturePoints,
      source: "procedural-fallback",
    };
  }

  function typedArrayFromBase64(type, data) {
    const binary = window.atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (type === "Float32Array") {
      return new Float32Array(bytes.buffer);
    }
    if (type === "Uint16Array") {
      return new Uint16Array(bytes.buffer);
    }
    if (type === "Uint32Array") {
      return new Uint32Array(bytes.buffer);
    }
    throw new Error(`Unsupported model array type: ${type}`);
  }

  function transformBounds(bounds, scaleFactor, center, targetCenter) {
    const min = [
      (bounds.min[0] - center[0]) * scaleFactor + targetCenter[0],
      (bounds.min[1] - center[1]) * scaleFactor + targetCenter[1],
      (bounds.min[2] - center[2]) * scaleFactor + targetCenter[2],
    ];
    const max = [
      (bounds.max[0] - center[0]) * scaleFactor + targetCenter[0],
      (bounds.max[1] - center[1]) * scaleFactor + targetCenter[1],
      (bounds.max[2] - center[2]) * scaleFactor + targetCenter[2],
    ];
    return { min, max };
  }

  function createModelMesh(modelAsset) {
    if (!modelAsset || !modelAsset.attributes || !modelAsset.indices) {
      return createFallbackObjectMesh();
    }

    const sourcePositions = typedArrayFromBase64(
      modelAsset.attributes.position.type,
      modelAsset.attributes.position.data,
    );
    const sourceNormals = typedArrayFromBase64(
      modelAsset.attributes.normal.type,
      modelAsset.attributes.normal.data,
    );
    const indices = typedArrayFromBase64(modelAsset.indices.type, modelAsset.indices.data);
    const bounds = modelAsset.bounds;
    const center = [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      (bounds.min[1] + bounds.max[1]) * 0.5,
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ];
    const sourceHeight = Math.max(0.0001, bounds.max[1] - bounds.min[1]);
    const scaleFactor = 1.26 / sourceHeight;
    const targetCenter = [0, 0.04, 0.08];
    const positions = new Float32Array(sourcePositions.length);

    for (let i = 0; i < sourcePositions.length; i += 3) {
      positions[i] = (sourcePositions[i] - center[0]) * scaleFactor + targetCenter[0];
      positions[i + 1] = (sourcePositions[i + 1] - center[1]) * scaleFactor + targetCenter[1];
      positions[i + 2] = (sourcePositions[i + 2] - center[2]) * scaleFactor + targetCenter[2];
    }

    const transformedBounds = transformBounds(bounds, scaleFactor, center, targetCenter);
    return {
      bounds: transformedBounds,
      colors: null,
      featurePoints: selectFeaturePoints(positions, transformedBounds),
      indices,
      normals: sourceNormals,
      positions,
      source: modelAsset.source || "model",
      texcoords: modelAsset.attributes.texcoord
        ? typedArrayFromBase64(modelAsset.attributes.texcoord.type, modelAsset.attributes.texcoord.data)
        : null,
      texture: modelAsset.texture || null,
    };
  }

  function getModelAsset(modelSrc) {
    const registry = window.AmarchReconstructionModels || {};
    return registry[modelSrc] || registry[modelSrc && modelSrc.split("/").pop()];
  }

  function selectFeaturePoints(positions, bounds) {
    const min = bounds.min;
    const max = bounds.max;
    const width = Math.max(0.0001, max[0] - min[0]);
    const height = Math.max(0.0001, max[1] - min[1]);
    const depth = Math.max(0.0001, max[2] - min[2]);
    const selected = [];

    featureTargets.forEach((target, index) => {
      const targetX = min[0] + (target[0] + 0.5) * width;
      const targetY = min[1] + (target[1] + 0.5) * height;
      let bestScore = Number.POSITIVE_INFINITY;
      let bestPoint = [targetX, targetY, max[2]];

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        const dx = (x - targetX) / width;
        const dy = (y - targetY) / height;
        const front = (z - min[2]) / depth;
        const duplicatePenalty = selected.some((point) => length(sub(point, [x, y, z])) < 0.04)
          ? 0.4
          : 0;
        const score = dx * dx + dy * dy - front * 0.3 + duplicatePenalty + index * 0.00001;
        if (score < bestScore) {
          bestScore = score;
          bestPoint = [x, y, z];
        }
      }
      selected.push(bestPoint);
    });

    return selected;
  }

  function createCaptureCamera(side, baseline) {
    const lens = [side * baseline * 0.5, 0.55, 3.0];
    const target = [0, 0.03, 0.08];
    const forward = normalize(sub(target, lens));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    const sensorDistance = 0.54;
    const sensorCenter = add(lens, scale(forward, -sensorDistance));
    return {
      lens,
      forward,
      right,
      sensorCenter,
      sensorDistance,
      up,
    };
  }

  function projectToSensor(point, camera) {
    const rayToPoint = normalize(sub(point, camera.lens));
    const denom = Math.max(0.001, dot(rayToPoint, camera.forward));
    return add(camera.lens, scale(rayToPoint, -camera.sensorDistance / denom));
  }

  function addCameraGeometry(planes, lines, camera, side) {
    const leftColor = side < 0 ? [0.05, 0.42, 0.82, 1] : [0.9, 0.34, 0.12, 1];
    const planeColor = side < 0 ? [0.05, 0.42, 0.82, 0.18] : [0.9, 0.34, 0.12, 0.18];
    const lineColor = [0.12, 0.16, 0.22, 0.82];
    const halfW = 0.38;
    const halfH = 0.25;
    const c = camera.sensorCenter;
    const r = camera.right;
    const u = camera.up;
    const p0 = add(add(c, scale(r, -halfW)), scale(u, -halfH));
    const p1 = add(add(c, scale(r, halfW)), scale(u, -halfH));
    const p2 = add(add(c, scale(r, halfW)), scale(u, halfH));
    const p3 = add(add(c, scale(r, -halfW)), scale(u, halfH));

    addQuad(planes, p0, p1, p2, p3, planeColor, camera.forward);
    addLine(lines, p0, p1, lineColor);
    addLine(lines, p1, p2, lineColor);
    addLine(lines, p2, p3, lineColor);
    addLine(lines, p3, p0, lineColor);
    addLine(lines, p0, camera.lens, leftColor);
    addLine(lines, p1, camera.lens, leftColor);
    addLine(lines, p2, camera.lens, leftColor);
    addLine(lines, p3, camera.lens, leftColor);

    const lensRadius = 0.16;
    const ringSegments = 34;
    let previous = null;
    let first = null;
    for (let i = 0; i <= ringSegments; i += 1) {
      const angle = (Math.PI * 2 * i) / ringSegments;
      const point = add(
        add(camera.lens, scale(r, Math.cos(angle) * lensRadius)),
        scale(u, Math.sin(angle) * lensRadius),
      );
      if (i === 0) {
        first = point;
      }
      if (previous) {
        addLine(lines, previous, point, leftColor);
      }
      previous = point;
    }
    if (first && previous) {
      addLine(lines, previous, first, leftColor);
    }
  }

  function buildPhotogrammetryGeometry(baseline, time, featurePoints) {
    const planes = makeGeometry();
    const lines = makeGeometry();
    const rays = makeGeometry();
    const points = makeGeometry();
    const leftCamera = createCaptureCamera(-1, baseline);
    const rightCamera = createCaptureCamera(1, baseline);
    const pulse = 0.62 + Math.sin(time * 0.0024) * 0.12;
    const leftRay = [0.02, 0.48, 0.92, pulse];
    const rightRay = [0.94, 0.34, 0.1, pulse];

    addCameraGeometry(planes, lines, leftCamera, -1);
    addCameraGeometry(planes, lines, rightCamera, 1);
    addLine(lines, leftCamera.lens, rightCamera.lens, [0.12, 0.16, 0.22, 0.35]);

    featurePoints.forEach((point, index) => {
      const leftSensorPoint = projectToSensor(point, leftCamera);
      const rightSensorPoint = projectToSensor(point, rightCamera);
      const pointColor = featureColors[index % featureColors.length];

      addTube(rays, leftSensorPoint, leftCamera.lens, 0.007, [leftRay[0], leftRay[1], leftRay[2], 0.4], 7);
      addTube(rays, leftCamera.lens, point, 0.01, leftRay, 8);
      addTube(rays, rightSensorPoint, rightCamera.lens, 0.007, [rightRay[0], rightRay[1], rightRay[2], 0.4], 7);
      addTube(rays, rightCamera.lens, point, 0.01, rightRay, 8);

      addPoint(points, point, pointColor);
      addPoint(points, leftSensorPoint, [0.02, 0.48, 0.92, 1]);
      addPoint(points, rightSensorPoint, [0.94, 0.34, 0.1, 1]);
    });

    return {
      leftCamera,
      lines,
      planes,
      points,
      rays,
      rightCamera,
    };
  }

  function createStructuredLightCamera() {
    const lens = [1.35, 0.55, 2.9];
    const target = [0, 0.1, 0.2];
    const forward = normalize(sub(target, lens));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = normalize(cross(right, forward));
    const sensorDistance = 0.54;
    const sensorCenter = add(lens, scale(forward, -sensorDistance));
    return {
      forward,
      lens,
      right,
      sensorCenter,
      sensorDistance,
      up,
    };
  }

  function makeLaserBlade(labelValue, bounds) {
    const sweep = clamp((labelValue - 0.2) / 3.4, 0, 1);
    const targetX = bounds.min[0] * 0.55 + sweep * (bounds.max[0] - bounds.min[0]) * 1.1;
    const targetZ = (bounds.min[2] + bounds.max[2]) * 0.5;
    const sourceToTarget = [
      targetX - structuredLightLaserSource[0],
      0,
      targetZ - structuredLightLaserSource[2],
    ];
    const normal = normalize([sourceToTarget[2], 0, -sourceToTarget[0]]);
    const offset = dot(structuredLightLaserSource, normal);
    return { normal, offset };
  }

  function sampleLaserTrace(modelMesh, blade) {
    const bounds = modelMesh.bounds || { min: [-0.4, -0.6, -0.4], max: [0.4, 0.7, 0.4] };
    const positions = modelMesh.positions || [];
    const min = bounds.min;
    const max = bounds.max;
    const height = Math.max(0.0001, max[1] - min[1]);
    const depth = Math.max(0.0001, max[2] - min[2]);
    const bins = Array.from({ length: 42 }, () => null);
    const thickness = 0.018;

    for (let i = 0; i < positions.length; i += 3) {
      const point = [positions[i], positions[i + 1], positions[i + 2]];
      const signed = dot(point, blade.normal) - blade.offset;
      if (Math.abs(signed) > thickness) {
        continue;
      }
      const bin = clamp(Math.floor(((point[1] - min[1]) / height) * bins.length), 0, bins.length - 1);
      const front = (point[2] - min[2]) / depth;
      const score = Math.abs(signed) * 20 - front;
      if (!bins[bin] || score < bins[bin].score) {
        bins[bin] = { point, score };
      }
    }

    const points = bins.filter(Boolean).map((entry) => entry.point);
    points.sort((a, b) => a[1] - b[1]);
    return points;
  }

  function addLaserBladeGeometry(planes, lines, blade, bounds) {
    const color = [0.04, 0.85, 0.38, 0.22];
    const lineColor = [0.0, 0.66, 0.25, 0.86];
    const min = bounds.min;
    const max = bounds.max;
    const source = structuredLightLaserSource;
    const y0 = min[1] - 0.22;
    const y1 = max[1] + 0.22;
    const span = max[0] - min[0];
    const z0 = min[2] - 0.24;
    const z1 = max[2] + 0.28;
    const xOnBlade = (z) => (blade.offset - blade.normal[2] * z) / blade.normal[0];
    const p0 = [xOnBlade(z0), y0, z0];
    const p1 = [xOnBlade(z1), y0, z1];
    const p2 = [xOnBlade(z1), y1, z1];
    const p3 = [xOnBlade(z0), y1, z0];

    addQuad(planes, p0, p1, p2, p3, color, blade.normal);
    addLine(lines, p0, p1, lineColor);
    addLine(lines, p1, p2, lineColor);
    addLine(lines, p2, p3, lineColor);
    addLine(lines, p3, p0, lineColor);
    addLine(lines, source, p0, lineColor);
    addLine(lines, source, p1, lineColor);
    addLine(lines, source, p2, lineColor);
    addLine(lines, source, p3, lineColor);
    addLine(
      lines,
      [source[0], source[1] - span * 0.08, source[2]],
      [source[0], source[1] + span * 0.08, source[2]],
      [0.0, 0.66, 0.25, 1],
    );
    return source;
  }

  function buildStructuredLightGeometry(scanValue, time, modelMesh) {
    const planes = makeGeometry();
    const lines = makeGeometry();
    const rays = makeGeometry();
    const points = makeGeometry();
    const camera = createStructuredLightCamera();
    const bounds = modelMesh.bounds || { min: [-0.4, -0.6, -0.4], max: [0.4, 0.7, 0.4] };
    const blade = makeLaserBlade(scanValue + Math.sin(time * 0.0016) * 0.08, bounds);
    const laserSource = addLaserBladeGeometry(planes, lines, blade, bounds);
    const trace = sampleLaserTrace(modelMesh, blade);
    const traceColor = [0.02, 0.95, 0.36, 1];
    const sensorColor = [0.95, 0.26, 0.1, 1];

    addCameraGeometry(planes, lines, camera, 1);
    addPolyline(lines, trace, traceColor);
    trace.forEach((point) => addPoint(points, point, traceColor));

    const sensorTrace = trace.map((point) => projectToSensor(point, camera));
    addPolyline(lines, sensorTrace, sensorColor);
    sensorTrace.forEach((point) => addPoint(points, point, sensorColor));

    const rayStep = Math.max(1, Math.floor(trace.length / 7));
    for (let i = 0; i < trace.length; i += rayStep) {
      const surfacePoint = trace[i];
      const sensorPoint = projectToSensor(surfacePoint, camera);
      addTube(rays, surfacePoint, camera.lens, 0.006, [0.95, 0.26, 0.1, 0.42], 7);
      addTube(rays, camera.lens, sensorPoint, 0.005, [0.95, 0.26, 0.1, 0.28], 7);
      addTube(rays, laserSource, surfacePoint, 0.005, [0.02, 0.95, 0.36, 0.28], 7);
    }

    const surfaceAnchor = trace[Math.floor(trace.length * 0.62)] || [0, 0.2, bounds.max[2]];
    const sensorAnchor = sensorTrace[Math.floor(sensorTrace.length * 0.62)] || camera.sensorCenter;
    return {
      labelAnchors: {
        feature: add(surfaceAnchor, [0, 0.12, 0]),
        leftLens: add(laserSource, [0, 0.2, 0]),
        leftSensor: add(sensorAnchor, [0, -0.16, 0]),
        rightLens: add(camera.lens, scale(camera.up, 0.28)),
        rightSensor: add(camera.sensorCenter, scale(camera.up, -0.34)),
      },
      leftCamera: {
        ...camera,
        lens: laserSource,
        sensorCenter: sensorAnchor,
      },
      lines,
      planes,
      points,
      rays,
      rightCamera: camera,
    };
  }

  class ReconstructionScene {
    constructor(root) {
      this.root = root;
      this.method = root.dataset.method || "photogrammetry";
      this.modelSrc = root.dataset.modelSrc || "_Mask.usdz";
      this.baseline = this.method === "structured-light" ? 1.9 : 2.35;
      this.distance = 6.1;
      this.yaw = 0.0;
      this.pitch = 0.31;
      this.dragging = false;
      this.lastPointer = null;
      this.width = 1;
      this.height = 1;

      this.root.textContent = "";
      this.canvas = document.createElement("canvas");
      this.canvas.className = "reconstruction-canvas";
      this.canvas.setAttribute("aria-label", "Interactive WebGL reconstruction scene");
      this.canvas.tabIndex = 0;
      this.root.appendChild(this.canvas);

      this.gl = this.canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        depth: true,
      });

      if (!this.gl) {
        this.root.innerHTML =
          '<p class="reconstruction-error">WebGL is not available in this browser.</p>';
        return;
      }

      this.program = createProgram(this.gl, vertexShaderSource, fragmentShaderSource);
      this.locations = {
        position: this.gl.getAttribLocation(this.program, "a_position"),
        color: this.gl.getAttribLocation(this.program, "a_color"),
        normal: this.gl.getAttribLocation(this.program, "a_normal"),
        texcoord: this.gl.getAttribLocation(this.program, "a_texcoord"),
        mvp: this.gl.getUniformLocation(this.program, "u_mvp"),
        lightDir: this.gl.getUniformLocation(this.program, "u_light_dir"),
        pointSize: this.gl.getUniformLocation(this.program, "u_point_size"),
        roundPoints: this.gl.getUniformLocation(this.program, "u_round_points"),
        texture: this.gl.getUniformLocation(this.program, "u_texture"),
        useTexture: this.gl.getUniformLocation(this.program, "u_use_texture"),
        useLighting: this.gl.getUniformLocation(this.program, "u_use_lighting"),
      };
      this.buffers = {
        index: this.gl.createBuffer(),
        position: this.gl.createBuffer(),
        color: this.gl.createBuffer(),
        normal: this.gl.createBuffer(),
        texcoord: this.gl.createBuffer(),
      };
      this.uint32ElementExtension = this.gl.getExtension("OES_element_index_uint");
      this.objectMesh = createModelMesh(getModelAsset(this.modelSrc));
      this.modelTexture = null;
      this.featurePoints = this.objectMesh.featurePoints || fallbackFeaturePoints;
      this.labels = new Map();
      this.labelsVisible = true;

      this.addControls();
      this.addLabels();
      this.bindEvents();
      this.loadModelTexture();
      this.resize();

      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.root);
      }
      window.addEventListener("resize", () => this.resize());

      this.frame = (time) => {
        this.render(time);
        this.raf = window.requestAnimationFrame(this.frame);
      };
      this.raf = window.requestAnimationFrame(this.frame);
    }

    loadModelTexture() {
      if (!this.objectMesh.texture) {
        return;
      }

      const image = new Image();
      image.addEventListener("load", () => {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.modelTexture = texture;
      });
      image.src = this.objectMesh.texture;
    }

    addControls() {
      const controls = document.createElement("div");
      controls.className = "reconstruction-controls";

      const label = document.createElement("label");
      label.className = "reconstruction-control-label";
      label.textContent = this.method === "structured-light" ? "Blade" : "Baseline";

      const input = document.createElement("input");
      input.type = "range";
      input.min = this.method === "structured-light" ? "0.2" : "0.2";
      input.max = "3.6";
      input.step = "0.05";
      input.value = String(this.baseline);
      input.setAttribute(
        "aria-label",
        this.method === "structured-light" ? "Laser blade position" : "Camera baseline",
      );

      const value = document.createElement("span");
      value.className = "reconstruction-baseline-value";
      value.textContent = this.baseline.toFixed(2);

      const labelsToggle = document.createElement("label");
      labelsToggle.className = "reconstruction-label-toggle";

      const labelsInput = document.createElement("input");
      labelsInput.type = "checkbox";
      labelsInput.checked = this.labelsVisible;
      labelsInput.setAttribute("aria-label", "Show labels");

      const labelsText = document.createElement("span");
      labelsText.textContent = "Labels";
      labelsToggle.append(labelsInput, labelsText);

      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "reconstruction-reset";
      reset.textContent = "Reset";
      reset.title = "Reset view";
      reset.setAttribute("aria-label", "Reset view");

      input.addEventListener("input", () => {
        this.baseline = Number(input.value);
        value.textContent = this.baseline.toFixed(2);
      });
      labelsInput.addEventListener("change", () => {
        this.labelsVisible = labelsInput.checked;
        this.root.classList.toggle("reconstruction-labels-hidden", !this.labelsVisible);
      });
      reset.addEventListener("click", () => {
        this.distance = 6.1;
        this.yaw = 0.0;
        this.pitch = 0.31;
        this.baseline = this.method === "structured-light" ? 1.9 : 2.35;
        input.value = String(this.baseline);
        value.textContent = this.baseline.toFixed(2);
      });

      controls.append(label, input, value, labelsToggle, reset);
      this.root.appendChild(controls);
    }

    addLabels() {
      const labels =
        this.method === "structured-light"
          ? [
              ["leftSensor", "Deformed trace", "left"],
              ["leftLens", "Laser blade", "feature"],
              ["rightSensor", "Sensor plane", "right"],
              ["rightLens", "Camera lens", "right"],
              ["object", "Object surface", "object"],
              ["feature", "Surface trace", "feature"],
            ]
          : [
              ["leftSensor", "Sensor A", "left"],
              ["leftLens", "Lens A", "left"],
              ["rightSensor", "Sensor B", "right"],
              ["rightLens", "Lens B", "right"],
              ["object", "Object surface", "object"],
              ["feature", "Matched feature", "feature"],
            ];
      labels.forEach(([id, text, kind]) => {
        const el = document.createElement("div");
        el.className = `reconstruction-label reconstruction-label-${kind}`;
        el.textContent = text;
        this.root.appendChild(el);
        this.labels.set(id, el);
      });
    }

    bindEvents() {
      this.canvas.addEventListener("pointerdown", (event) => {
        this.dragging = true;
        this.lastPointer = [event.clientX, event.clientY];
        this.canvas.setPointerCapture(event.pointerId);
      });

      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.dragging || !this.lastPointer) {
          return;
        }
        const dx = event.clientX - this.lastPointer[0];
        const dy = event.clientY - this.lastPointer[1];
        this.yaw += dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.005, -0.35, 1.05);
        this.lastPointer = [event.clientX, event.clientY];
      });

      const stopDrag = (event) => {
        this.dragging = false;
        this.lastPointer = null;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
      };
      this.canvas.addEventListener("pointerup", stopDrag);
      this.canvas.addEventListener("pointercancel", stopDrag);
      this.canvas.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          this.distance = clamp(this.distance + event.deltaY * 0.006, 4.2, 8.5);
        },
        { passive: false },
      );
    }

    resize() {
      const rect = this.root.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.round(this.root.clientWidth || rect.width || 960));
      const cssHeight = Math.max(1, Math.round(this.root.clientHeight || rect.height || 480));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
      const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      this.width = cssWidth;
      this.height = cssHeight;
      this.dpr = dpr;
      this.gl.viewport(0, 0, pixelWidth, pixelHeight);
    }

    render(time) {
      const gl = this.gl;
      this.resize();

      const aspect = this.width / this.height;
      const target = [0, 0.1, 0.45];
      const cosPitch = Math.cos(this.pitch);
      const eye = [
        target[0] + Math.sin(this.yaw) * cosPitch * this.distance,
        target[1] + Math.sin(this.pitch) * this.distance,
        target[2] + Math.cos(this.yaw) * cosPitch * this.distance,
      ];
      const projection = perspective(Math.PI / 4, aspect, 0.1, 30);
      const view = lookAt(eye, target, [0, 1, 0]);
      const mvp = multiplyMat4(projection, view);
      const dynamic = this.buildMethodGeometry(time);

      gl.clearColor(0.965, 0.975, 0.985, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.locations.mvp, false, mvp);
      gl.uniform3fv(this.locations.lightDir, normalize([-0.35, 0.8, 0.55]));
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      this.drawGeometry(this.objectMesh, gl.TRIANGLES, {
        defaultColor: this.modelTexture ? [1, 1, 1, 1] : [0.62, 0.38, 0.24, 1],
        lighting: true,
        pointSize: 1,
        roundPoints: false,
        texture: this.modelTexture,
      });

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      this.drawGeometry(dynamic.planes, gl.TRIANGLES, {
        lighting: false,
        pointSize: 1,
        roundPoints: false,
      });

      gl.disable(gl.DEPTH_TEST);
      this.drawGeometry(dynamic.rays, gl.TRIANGLES, {
        lighting: false,
        pointSize: 1,
        roundPoints: false,
      });
      gl.lineWidth(1.5);
      this.drawGeometry(dynamic.lines, gl.LINES, {
        lighting: false,
        pointSize: 1,
        roundPoints: false,
      });
      this.drawGeometry(dynamic.points, gl.POINTS, {
        lighting: false,
        pointSize: 10 * this.dpr,
        roundPoints: true,
      });

      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      this.updateLabels(mvp, dynamic);
    }

    buildMethodGeometry(time) {
      if (this.method === "photogrammetry") {
        return buildPhotogrammetryGeometry(this.baseline, time, this.featurePoints);
      }
      if (this.method === "structured-light") {
        return buildStructuredLightGeometry(this.baseline, time, this.objectMesh);
      }
      return {
        leftCamera: createCaptureCamera(-1, this.baseline),
        lines: makeGeometry(),
        planes: makeGeometry(),
        points: makeGeometry(),
        rays: makeGeometry(),
        rightCamera: createCaptureCamera(1, this.baseline),
      };
    }

    drawGeometry(geometry, mode, options) {
      const gl = this.gl;
      const count = geometry.positions.length / 3;
      if (!count) {
        return;
      }
      const positions =
        geometry.positions instanceof Float32Array ? geometry.positions : new Float32Array(geometry.positions);
      const normals =
        geometry.normals instanceof Float32Array ? geometry.normals : new Float32Array(geometry.normals);
      const useTexture = Boolean(options.texture && geometry.texcoords && geometry.texcoords.length);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STREAM_DRAW);
      gl.enableVertexAttribArray(this.locations.position);
      gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0);

      if (geometry.colors && geometry.colors.length) {
        const colors =
          geometry.colors instanceof Float32Array ? geometry.colors : new Float32Array(geometry.colors);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(this.locations.color);
        gl.vertexAttribPointer(this.locations.color, 4, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(this.locations.color);
        gl.vertexAttrib4fv(this.locations.color, options.defaultColor || [0.62, 0.38, 0.24, 1]);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STREAM_DRAW);
      gl.enableVertexAttribArray(this.locations.normal);
      gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0);

      if (geometry.texcoords && geometry.texcoords.length) {
        const texcoords =
          geometry.texcoords instanceof Float32Array ? geometry.texcoords : new Float32Array(geometry.texcoords);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texcoord);
        gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STREAM_DRAW);
        gl.enableVertexAttribArray(this.locations.texcoord);
        gl.vertexAttribPointer(this.locations.texcoord, 2, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(this.locations.texcoord);
        gl.vertexAttrib2f(this.locations.texcoord, 0, 0);
      }

      gl.uniform1f(this.locations.useLighting, options.lighting ? 1 : 0);
      gl.uniform1f(this.locations.pointSize, options.pointSize);
      gl.uniform1f(this.locations.roundPoints, options.roundPoints ? 1 : 0);
      gl.uniform1f(this.locations.useTexture, useTexture ? 1 : 0);
      if (useTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, options.texture);
        gl.uniform1i(this.locations.texture, 0);
      }

      if (geometry.indices && geometry.indices.length) {
        const type = geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        if (type === gl.UNSIGNED_INT && !this.uint32ElementExtension) {
          return;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STREAM_DRAW);
        gl.drawElements(mode, geometry.indices.length, type, 0);
      } else {
        gl.drawArrays(mode, 0, count);
      }
    }

    updateLabels(mvp, dynamic) {
      if (!this.labelsVisible) {
        this.labels.forEach((el) => {
          el.style.opacity = "0";
        });
        return;
      }

      const featureAnchor = this.featurePoints[1] || this.featurePoints[0] || [0, 0.25, 0.5];
      const bounds = this.objectMesh.bounds || { min: [0, -0.64, 0], max: [0, 0.64, 0.2] };
      const anchors = {
        feature: add(featureAnchor, [0.0, 0.18, 0.0]),
        leftLens: add(dynamic.leftCamera.lens, scale(dynamic.leftCamera.up, 0.28)),
        leftSensor: add(dynamic.leftCamera.sensorCenter, scale(dynamic.leftCamera.up, -0.34)),
        object: [0.0, bounds.min[1] - 0.15, (bounds.min[2] + bounds.max[2]) * 0.5],
        rightLens: add(dynamic.rightCamera.lens, scale(dynamic.rightCamera.up, 0.28)),
        rightSensor: add(dynamic.rightCamera.sensorCenter, scale(dynamic.rightCamera.up, -0.34)),
      };
      Object.assign(anchors, dynamic.labelAnchors || {});

      this.labels.forEach((el, id) => {
        const point = anchors[id];
        const projected = transformPoint(mvp, point);
        const w = projected[3];
        if (!point || w <= 0.001) {
          el.style.opacity = "0";
          return;
        }
        const ndcX = projected[0] / w;
        const ndcY = projected[1] / w;
        const visible = Math.abs(ndcX) < 1.15 && Math.abs(ndcY) < 1.15;
        el.style.opacity = visible ? "1" : "0";
        el.style.left = `${(ndcX * 0.5 + 0.5) * this.width}px`;
        el.style.top = `${(-ndcY * 0.5 + 0.5) * this.height}px`;
      });
    }
  }

  const scenes = new WeakMap();

  function initReconstructionScenes() {
    document.querySelectorAll("[data-reconstruction-webgl]").forEach((root) => {
      if (!scenes.has(root)) {
        scenes.set(root, new ReconstructionScene(root));
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReconstructionScenes);
  } else {
    initReconstructionScenes();
  }

  window.addEventListener("load", initReconstructionScenes);

  if (window.Reveal) {
    window.Reveal.on("ready", initReconstructionScenes);
    window.Reveal.on("slidechanged", initReconstructionScenes);
  }
})();
