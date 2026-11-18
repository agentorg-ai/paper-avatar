import type * as Three from 'three';
import type { AvatarRecipe } from '../identity.js';

type Pattern = number[][];
type Stock = Three.MeshStandardMaterial;
type Part = Three.Group;
type RailOptions = {
  closed?: boolean;
  steps?: number;
  tones?: number[];
  edge?: number;
  tension?: number;
  softFolds?: number;
  panelTones?: number[];
  lined?: boolean;
};

export interface PersonPose {
  x?: number;
  y?: number;
  time?: number;
  reduced?: boolean;
}

// Y is up. The face points along +Z before the portrait's three-quarter turn.
// Each part is an authored cardstock pattern. Switching recipes reuses the meshes.
export function createPerson(T: typeof Three, recipe: AvatarRecipe) {
  const root = new T.Group();
  function group(parent: Part, name: string) {
    const node = new T.Group();
    node.name = name;
    parent.add(node);
    return node;
  }
  const torso = group(root, 'Shoulders');
  const head = group(torso, 'Head pivot');
  const pivotY = 1.235;
  head.position.y = pivotY;
  const portrait = group(head, 'Head, hair and accessories');
  portrait.position.y = -pivotY - 0.035;
  portrait.scale.set(1.19, 1, 1.13);

  function paper() {
    return new T.MeshStandardMaterial({ roughness: 0.93, metalness: 0, vertexColors: true, side: T.DoubleSide });
  }
  const skin = paper(),
    hair = paper(),
    cloth = paper(),
    lining = paper(),
    shirt = paper(),
    ink = paper(),
    gold = paper();
  hair.name = 'Hair stock';
  // Striations follow the unrolled coordinates of each individual cut lock.
  // Filter each octave at its pixel footprint so closely spaced fibers settle
  // into one value when the same portrait is used as a small sidebar icon.
  hair.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paperFiber; varying vec2 vPaperFiber;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaperFiber = paperFiber;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
       varying vec2 vPaperFiber;
       float cutPaperFiber(float phase) {
         return sin(phase) * (1.0 - smoothstep(1.1, 3.1, fwidth(phase)));
       }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
       float along = vPaperFiber.x;
       float across = vPaperFiber.y + 0.004 * sin(along * 10.0 + vPaperFiber.y * 23.0);
       float ridges = cutPaperFiber(across * 196.0 + 1.6 * sin(across * 48.0));
       float filament = cutPaperFiber(across * 621.0 + 2.4 * sin(along * 6.0 + across * 57.0));
       float torn = smoothstep(-0.8, 0.8, sin(along * 9.0 + across * 21.0));
       diffuseColor.rgb *= 0.99 + (0.057 + 0.044 * torn) * ridges + 0.027 * filament;`
      );
  };
  ink.color.set('#32303a');
  gold.color.set('#c99750');
  shirt.color.set('#353441');

  // The grain lies in the sheet. A world-space unit has the same textile
  // scale on a cheek, a turned cuff, or the underside of a hair ribbon.
  function paperGeometry(parent: Part, name: string, stock: Stock) {
    const positions: number[] = [],
      normals: number[] = [],
      shades: number[] = [],
      uvs: number[] = [];
    const headScale =
      parent === portrait || parent.parent === portrait ? portrait.scale.clone() : new T.Vector3(1, 1, 1);
    if (parent.parent === portrait) headScale.multiply(parent.scale);
    const fibers: number[] = [];
    function polygon(
      points: Three.Vector3[],
      facing: Three.Vector3,
      tone: number,
      smooth?: Three.Vector3[],
      fiberUV?: Three.Vector2[]
    ) {
      const physical = points.map((p) => p.clone().multiply(headScale));
      const surface = new T.Vector3();
      for (let i = 0; i < points.length; i++)
        surface.add(new T.Vector3().crossVectors(physical[i], physical[(i + 1) % points.length]));
      surface.normalize();
      const grain = new T.Vector3(0, 1, 0);
      if (Math.abs(surface.y) > 0.86) grain.set(0, 0, 1);
      const across = new T.Vector3().crossVectors(grain, surface).normalize();
      grain.crossVectors(surface, across).normalize();
      const uv = physical.map((p) => new T.Vector2(p.dot(across), p.dot(grain)));
      const triangles = T.ShapeUtils.triangulateShape(uv, []);
      for (const triangle of triangles) {
        const [a, b, c] = triangle.map((i) => points[i]);
        const cross = new T.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
        if (cross.lengthSq() < 1e-17) continue;
        if (cross.dot(facing) < 0) triangle.reverse();
        for (const i of triangle) {
          const n = smooth ? smooth[i] : facing;
          positions.push(...points[i]);
          normals.push(...n);
          shades.push(tone, tone, tone);
          uvs.push(uv[i].x, uv[i].y);
          if (stock === hair) {
            const f = fiberUV?.[i] ?? uv[i];
            fibers.push(f.x, f.y);
          }
        }
      }
    }
    function finish() {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(shades, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      if (fibers.length) geometry.setAttribute('paperFiber', new T.Float32BufferAttribute(fibers, 2));
      const mesh = new T.Mesh(geometry, stock);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    return { polygon, finish };
  }
  const vector = ([x, y, z]: number[]) => new T.Vector3(x, y, z);
  function normalOf(points: Three.Vector3[]) {
    const normal = new T.Vector3();
    for (let i = 0; i < points.length; i++)
      normal.add(new T.Vector3().crossVectors(points[i], points[(i + 1) % points.length]));
    return normal.normalize();
  }

  // Flat polygonal nets carry one normal per panel. Exposed outlines can
  // turn under twice: a narrow light-catching arris and a darker cut edge.
  function cut(parent: Part, name: string, stock: Stock, vertices: Pattern, faces: Pattern, edge = 0) {
    const g = paperGeometry(parent, name, stock);
    const boundary = new Map<string, { a: number; b: number; normal: Three.Vector3; tone: number }>();
    for (const [tone, ...ids] of faces) {
      const points = ids.map((i) => vector(vertices[i]));
      const normal = normalOf(points);
      g.polygon(points, normal, tone);
      if (!edge) continue;
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i],
          b = ids[(i + 1) % ids.length],
          key = [Math.min(a, b), Math.max(a, b)].join('-');
        if (boundary.has(key)) {
          boundary.delete(key);
          continue;
        }
        boundary.set(key, { a, b, normal, tone });
      }
    }
    for (const { a, b, normal, tone } of boundary.values()) {
      const start = vector(vertices[a]),
        end = vector(vertices[b]);
      const out = end
        .clone()
        .sub(start)
        .normalize()
        .cross(normal)
        .multiplyScalar(edge * 0.27);
      const bevel = (p: Three.Vector3) =>
        p
          .clone()
          .add(out)
          .addScaledVector(normal, -edge * 0.32);
      const under = (p: Three.Vector3) => p.clone().addScaledVector(normal, -edge);
      for (const [points, t] of [
        [[start, bevel(start), bevel(end), end], tone * 0.99],
        [[bevel(start), under(start), under(end), bevel(end)], tone * 0.7],
      ] as [Three.Vector3[], number][]) {
        g.polygon(points, normalOf(points), t);
      }
    }
    return g.finish();
  }

  // A strip of cardstock bends along each authored rail. Normals follow
  // the bend lengthwise while a deliberate fold across the width stays crisp.
  function strip(
    parent: Part,
    name: string,
    stock: Stock,
    rails: Pattern[],
    {
      closed = false,
      steps = 3,
      tones = [],
      edge = 0.012,
      tension = 0.37,
      softFolds = 0,
      panelTones = [],
      lined = false,
    }: RailOptions = {}
  ) {
    const curves = rails.map((rail) => new T.CatmullRomCurve3(rail.map(vector), closed, 'catmullrom', tension));
    const counts = (rails[0].length - (closed ? 0 : 1)) * steps;
    const rows = curves.map((c) => Array.from({ length: counts + 1 }, (_, i) => c.getPoint(i / counts)));
    const tangents = curves.map((c) => Array.from({ length: counts + 1 }, (_, i) => c.getTangent(i / counts)));
    // The across coordinate is shared at each fold. Changes in lock width
    // fan the fibers towards a tapered end. Closed hair caps grow crown to rim.
    const flow =
      stock === hair
        ? rows.map((rail, row) => {
            let length = 0;
            return rail.map((point, i) => {
              if (i) length += point.distanceTo(rail[i - 1]);
              let width = 0;
              for (let r = 1; r <= row; r++) width += rows[r][i].distanceTo(rows[r - 1][i]);
              return closed ? new T.Vector2(width, length) : new T.Vector2(length, width);
            });
          })
        : undefined;
    const g = paperGeometry(parent, name, stock);
    const edges: [Three.Vector3[], Three.Vector3[], number][] = [];
    for (let v = 0; v < rows.length - 1; v++) {
      const faceNormals = rows[v].map((p, i) => {
        const across = rows[v + 1][i].clone().sub(p);
        return [v, v + 1].map((k) => {
          const foldNormal = tangents[k][i].clone().cross(across).normalize();
          if (softFolds && k > 0 && k < rows.length - 1) {
            const l = rows[k][i]
                .clone()
                .sub(rows[k - 1][i])
                .normalize(),
              r = rows[k + 1][i].clone().sub(rows[k][i]).normalize();
            const blended = tangents[k][i].clone().cross(l.add(r)).normalize();
            foldNormal.lerp(blended, softFolds).normalize();
          }
          return foldNormal;
        });
      });
      for (let i = 0; i < counts; i++) {
        const a = rows[v][i],
          b = rows[v][i + 1],
          c = rows[v + 1][i + 1],
          d = rows[v + 1][i];
        const points = [a, b, c, d],
          smooth = [faceNormals[i][0], faceNormals[i + 1][0], faceNormals[i + 1][1], faceNormals[i][1]];
        const tone = (tones[v] ?? 1) * (panelTones[Math.floor(i / steps)] ?? 1);
        const fiberUV = flow && [flow[v][i], flow[v][i + 1], flow[v + 1][i + 1], flow[v + 1][i]];
        g.polygon(points, normalOf(points), tone, smooth, fiberUV);
        if (lined) {
          const inner = points.map((p, j) => p.clone().addScaledVector(smooth[j], -edge));
          const inward = smooth.map((n) => n.clone().negate());
          g.polygon(inner, normalOf(points).negate(), tone * 0.78, inward, fiberUV);
          if (!closed)
            for (const [j, k] of i === 0 ? [[0, 3]] : i === counts - 1 ? [[1, 2]] : []) {
              const end = [points[j], points[k], inner[k], inner[j]];
              g.polygon(end, normalOf(end), tone * 0.79);
            }
        }
      }
      if (v === 0) edges.push([rows[v], faceNormals.map((n) => n[0]), 1]);
      if (v === rows.length - 2) edges.push([rows[v + 1], faceNormals.map((n) => n[1]), -1]);
    }
    if (edge)
      for (const [border, normals, side] of edges) {
        const chamfer = [],
          reverse = [];
        for (let i = 0; i <= counts; i++) {
          const dir = border[Math.min(i + 1, counts)]
            .clone()
            .sub(border[Math.max(i - 1, 0)])
            .normalize();
          const outward = dir.cross(normals[i]).multiplyScalar(side * edge * 0.26);
          chamfer.push(
            border[i]
              .clone()
              .add(outward)
              .addScaledVector(normals[i], -edge * 0.3)
          );
          reverse.push(border[i].clone().addScaledVector(normals[i], -edge));
        }
        for (let i = 0; i < counts; i++)
          for (const [outer, inner, tone, faceBlend] of [
            [border, chamfer, 1.015, 0.46],
            [chamfer, reverse, 0.88, 0.24],
          ] as [Three.Vector3[], Three.Vector3[], number, number][]) {
            const p = [outer[i], outer[i + 1], inner[i + 1], inner[i]];
            const edgeNormal = normalOf(p).multiplyScalar(-side);
            const cutNormal = (index: number) => edgeNormal.clone().lerp(normals[index], faceBlend).normalize();
            g.polygon(p, edgeNormal, tone, [cutNormal(i), cutNormal(i + 1), cutNormal(i + 1), cutNormal(i)]);
          }
      }
    return g.finish();
  }
  function mirror(points: Pattern, s: number) {
    return points.map(([x, y, z]) => [x * s, y, z]);
  }

  // The forehead, cheek, jaw and chin form a continuous mask. A separate
  // folded nose is let into the front; its return closes the profile.
  const faceRows = [
    // scalp under the hair; bridge; tip; mouth plane; chin; underside
    [
      [0, 2.393, 0.148],
      [0.083, 2.385, 0.148],
      [0.201, 2.348, 0.145],
      [0.331, 2.256, 0.137],
      [0.365, 2.171, 0.094],
      [0.318, 2.221, -0.162],
      [0.219, 2.32, -0.279],
      [0, 2.37, -0.303],
    ],
    [
      [0, 2.172, 0.383],
      [0.081, 2.171, 0.367],
      [0.214, 2.147, 0.339],
      [0.348, 2.103, 0.271],
      [0.433, 2.075, 0.11],
      [0.421, 2.101, -0.124],
      [0.279, 2.139, -0.295],
      [0, 2.158, -0.347],
    ],
    [
      [0, 2.023, 0.423],
      [0.078, 2.014, 0.387],
      [0.206, 2.009, 0.357],
      [0.356, 1.986, 0.286],
      [0.458, 1.996, 0.118],
      [0.454, 1.987, -0.128],
      [0.314, 1.995, -0.319],
      [0, 1.999, -0.374],
    ],
    [
      [0, 1.835, 0.416],
      [0.076, 1.844, 0.408],
      [0.223, 1.873, 0.415],
      [0.375, 1.889, 0.352],
      [0.472, 1.871, 0.099],
      [0.446, 1.85, -0.14],
      [0.313, 1.837, -0.309],
      [0, 1.837, -0.353],
    ],
    [
      [0, 1.653, 0.444],
      [0.091, 1.682, 0.432],
      [0.204, 1.69, 0.394],
      [0.337, 1.706, 0.304],
      [0.45, 1.724, 0.075],
      [0.421, 1.711, -0.136],
      [0.282, 1.699, -0.284],
      [0, 1.682, -0.321],
    ],
    [
      [0, 1.605, 0.439],
      [0.09, 1.625, 0.426],
      [0.188, 1.602, 0.392],
      [0.313, 1.585, 0.293],
      [0.415, 1.572, 0.049],
      [0.363, 1.56, -0.138],
      [0.228, 1.55, -0.264],
      [0, 1.546, -0.282],
    ],
    [
      [0, 1.43, 0.442],
      [0.084, 1.424, 0.437],
      [0.168, 1.417, 0.407],
      [0.284, 1.445, 0.282],
      [0.352, 1.472, 0.025],
      [0.303, 1.442, -0.139],
      [0.181, 1.444, -0.229],
      [0, 1.449, -0.254],
    ],
    [
      [0, 1.25, 0.399],
      [0.066, 1.252, 0.398],
      [0.14, 1.26, 0.378],
      [0.206, 1.299, 0.304],
      [0.294, 1.322, 0.076],
      [0.254, 1.356, -0.092],
      [0.165, 1.388, -0.19],
      [0, 1.401, -0.207],
    ],
    [
      [0, 1.22, 0.328],
      [0.058, 1.221, 0.324],
      [0.123, 1.235, 0.31],
      [0.177, 1.262, 0.252],
      [0.25, 1.297, 0.057],
      [0.223, 1.341, -0.085],
      [0.149, 1.37, -0.167],
      [0, 1.387, -0.18],
    ],
  ];
  for (const side of [-1, 1]) {
    const points = faceRows.map((row) => mirror(row, side).map(vector));
    const g = paperGeometry(portrait, 'Face', skin);
    const panelNormals = points
      .slice(0, -1)
      .map((row, r) =>
        row
          .slice(0, -1)
          .map((point, j) =>
            normalOf([point, row[j + 1], points[r + 1][j + 1], points[r + 1][j]]).multiplyScalar(-side)
          )
      );
    for (let r = 0; r < points.length - 1; r++)
      for (let j = 0; j < points[0].length - 1; j++) {
        const faceNormal = panelNormals[r][j];
        const corners = [
          [r, j],
          [r, j + 1],
          [r + 1, j + 1],
          [r + 1, j],
        ];
        const ns = corners.map(([row, col]) => {
          const n = new T.Vector3();
          for (const rr of [row - 1, row])
            for (const cc of [col - 1, col]) {
              if (rr < 0 || rr >= points.length - 1 || cc < 0 || cc >= points[0].length - 1) continue;
              // The ridge is pronounced at the zygoma, then eases into the
              // jaw. Carry some reflected light across either side of it.
              const oppositeCheek = col === 3 && j < 3 !== cc < 3;
              const softness = row < 2 || row > 6 ? 0.7 : 0.21;
              n.addScaledVector(panelNormals[rr][cc], oppositeCheek ? softness : 1);
            }
          n.normalize();
          if (col === 0) {
            n.x = 0;
            n.normalize();
          }
          return n;
        });
        const quad = corners.map(([rr, cc]) => points[rr][cc]);
        g.polygon(quad, faceNormal, j < 3 ? 1 : 0.985, ns);
      }
    g.finish();
    const last = points[points.length - 1],
      base = new T.Vector3(0, 1.32, -0.02);
    cut(
      portrait,
      'Under jaw',
      skin,
      [...last.map((p) => p.toArray()), base.toArray()],
      last.slice(1).map((_, i) => [0.82, i, i + 1, last.length])
    );

    // A folded outer helix surrounds a shallow triangular concha. The
    // lobe sits in front of the nape so an earring has a genuine attachment.
    const rim = [
      [0.422, 1.863, 0.078],
      [0.492, 1.92, 0.06],
      [0.547, 1.893, 0.019],
      [0.557, 1.817, -0.011],
      [0.548, 1.736, -0.002],
      [0.511, 1.652, 0.055],
      [0.466, 1.619, 0.096],
      [0.444, 1.656, 0.116],
      [0.455, 1.725, 0.111],
    ];
    const valley = [
      [0.457, 1.843, 0.074],
      [0.494, 1.868, 0.065],
      [0.517, 1.85, 0.039],
      [0.526, 1.806, 0.023],
      [0.518, 1.76, 0.033],
      [0.497, 1.699, 0.063],
      [0.48, 1.666, 0.085],
      [0.469, 1.678, 0.095],
      [0.467, 1.74, 0.089],
    ];
    strip(portrait, 'Folded ear', skin, [mirror(rim, side), mirror(valley, side)], {
      closed: true,
      steps: 2,
      tones: [0.98],
      edge: 0.008,
    });
    const basin = valley.map(([x, y, z]) => [(x - 0.012) * side, y, z]);
    const lip = mirror(valley, side);
    cut(
      portrait,
      'Ear hollow',
      skin,
      [...lip, ...basin],
      [
        [0.89, ...basin.map((_, i) => i + basin.length)],
        ...lip.map((_, i) => [0.91, i, (i + 1) % lip.length, ((i + 1) % lip.length) + lip.length, i + lip.length]),
      ]
    );
    const baseRing = rim.map(([x, y, z]) => [(x - 0.069) * side, y - 0.005, z - 0.023]);
    strip(portrait, 'Ear lobe return', skin, [baseRing, mirror(rim, side)], {
      closed: true,
      steps: 2,
      tones: [0.89],
      edge: 0,
    });
  }
  const bridgeLeft = [
    [-0.025, 2.062, 0.386],
    [-0.052, 1.976, 0.388],
    [-0.077, 1.828, 0.412],
    [-0.113, 1.682, 0.432],
    [-0.102, 1.62, 0.437],
  ];
  const noseLeft = [
    [-0.012, 2.057, 0.396],
    [-0.021, 1.971, 0.448],
    [-0.028, 1.824, 0.517],
    [-0.041, 1.713, 0.566],
    [-0.038, 1.666, 0.574],
  ];
  const noseRight = [
    [0.01, 2.057, 0.398],
    [0.017, 1.971, 0.45],
    [0.025, 1.824, 0.518],
    [0.033, 1.713, 0.567],
    [0.031, 1.668, 0.575],
  ];
  const bridgeRight = [
    [0.026, 2.061, 0.386],
    [0.052, 1.977, 0.388],
    [0.077, 1.83, 0.412],
    [0.108, 1.691, 0.429],
    [0.097, 1.629, 0.437],
  ];
  strip(portrait, 'Nose', skin, [bridgeLeft, noseLeft, noseRight, bridgeRight], {
    steps: 3,
    softFolds: 0.23,
    tones: [1.015, 1, 0.96],
    edge: 0,
  });
  cut(
    portrait,
    'Nose return',
    skin,
    [bridgeLeft.at(-1)!, noseLeft.at(-1)!, noseRight.at(-1)!, bridgeRight.at(-1)!, [0, 1.605, 0.434]],
    [[0.84, 0, 1, 2, 3, 4]]
  );

  // Neck and lower jaw overlap through the whole gaze range.
  const neckBottom = [
    [-0.23, 0.76, 0.126],
    [0, 0.736, 0.18],
    [0.235, 0.79, 0.121],
    [0.236, 0.83, -0.105],
    [0, 0.83, -0.207],
    [-0.212, 0.81, -0.104],
  ];
  const neckTop = [
    [-0.189, 1.455, 0.127],
    [0, 1.461, 0.176],
    [0.192, 1.45, 0.086],
    [0.205, 1.415, -0.127],
    [0, 1.4, -0.212],
    [-0.194, 1.42, -0.094],
  ];
  cut(
    torso,
    'Neck',
    skin,
    [...neckBottom, ...neckTop],
    neckBottom.map((_, i) => [0.76, i, (i + 1) % 6, ((i + 1) % 6) + 6, i + 6])
  );

  function coatBody(parent: Part, stock: Stock, kind: 'jacket' | 'wrap' | 'crew') {
    const [hem, shoulder, seamY, depth] = {
      jacket: [1.065, 0.95, 0.58, 0.382],
      wrap: [1.022, 0.925, 0.65, 0.37],
      crew: [1.015, 0.9, 0.55, 0.391],
    }[kind];
    // Three connected pattern sections give the chest a quiet convexity
    // and let the sleeve turn away from the viewer at the armhole.
    const halfBase = [
      [0, 0, depth],
      [0.52 * hem, 0, depth * 0.985],
      [0.74 * hem, 0, depth * 0.85],
      [0.92 * hem, 0, 0.2],
      [hem, 0, 0.033],
      [0.96 * hem, 0, -0.131],
      [0.78 * hem, 0, -0.27],
      [0.46 * hem, 0, -0.323],
      [0, 0, -0.351],
    ];
    const halfRoll = [
      [0, 0.555, 0.315],
      [0.45, 0.58, 0.287],
      [0.64, 0.593, 0.242],
      [shoulder * 0.91, seamY + 0.011, 0.175],
      [shoulder, seamY, 0],
      [shoulder * 0.96, seamY + 0.023, -0.122],
      [shoulder * 0.748, seamY + 0.105, -0.224],
      [0.43, seamY + 0.2, -0.256],
      [0, 0.869, -0.26],
    ];
    const halfNeck = [
      [0, 0.865, 0.194],
      [0.099, 0.871, 0.183],
      [0.201, 0.912, 0.152],
      [0.255, 0.958, 0.083],
      [0.269, 0.977, -0.005],
      [0.248, 0.992, -0.087],
      [0.177, 0.998, -0.167],
      [0.092, 1.007, -0.189],
      [0, 1.012, -0.199],
    ];
    const loop = (half: Pattern) => [...half, ...mirror(half.slice(1, -1).reverse(), -1)];
    const bottom = loop(halfBase),
      roll = loop(halfRoll),
      neckline = loop(halfNeck);
    const chest = strip(parent, 'Shoulder and chest pattern', stock, [bottom, roll, neckline], {
      closed: true,
      steps: 2,
      tones: [0.99, 1],
      edge: 0,
      tension: 0.32,
      softFolds: 0.91,
      panelTones: [1, 1, 0.986, 0.963, 0.956, 0.967, 1, 1, 1, 1, 0.962, 0.946, 0.968, 0.977, 1, 1],
    });
    cut(parent, 'Cut bust base', stock, bottom, [[0.74, ...bottom.map((_, i) => i)]]);
    return chest;
  }

  const outfits: Record<string, Part> = {};
  for (const style of ['jacket', 'wrap', 'crew'] as const) {
    const node = (outfits[style] = group(torso, style));
    const chest = coatBody(node, cloth, style);
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, 0, -1));
    // Fit welts and bindings to this garment's actual curved front. The
    // third pattern coordinate measures how far the folded paper lifts away.
    const fitChest = (pattern: Pattern) =>
      pattern.map(([x, y, lift]) => {
        ray.ray.origin.set(x, y, 1.5);
        const surface = ray.intersectObject(chest, false)[0];
        if (!surface) throw new Error(`Garment pattern outside its shell at ${x}, ${y}`);
        return [x, y, surface.point.z + lift];
      });
    if (style === 'jacket') {
      const neckline = [
        [-0.234, 0.93, 0.088],
        [-0.207, 0.95, 0.122],
        [-0.192, 0.962, 0.144],
        [-0.148, 0.948, 0.189],
        [-0.102, 0.926, 0.22],
        [0.005, 0.912, 0.245],
        [0.119, 0.924, 0.209],
        [0.168, 0.945, 0.167],
        [0.195, 0.966, 0.131],
        [0.219, 0.956, 0.103],
        [0.24, 0.932, 0.076],
      ];
      const rootV = [0.136, 0.538, 0.348];
      cut(
        node,
        'Undershirt',
        shirt,
        [...neckline, rootV],
        neckline.slice(1).map((_, i) => [0.98, i, i + 1, neckline.length])
      );

      // The collars are folded over the stand. Their outer points sit just
      // clear of the chest, opening a shallow shadow beneath each free tip.
      const leftHead = [
        [-0.148, 0.998, -0.142],
        [-0.196, 1.018, -0.07],
        [-0.211, 1.017, 0.059],
        [-0.206, 0.99, 0.154],
        [-0.174, 0.949, 0.258],
      ];
      const leftShoulder = [
        [-0.225, 0.987, -0.158],
        [-0.323, 0.96, -0.045],
        [-0.408, 0.922, 0.066],
        [-0.455, 0.853, 0.18],
        [-0.482, 0.766, 0.28],
      ];
      const frontLeft = [
        [
          [-0.482, 0.766, 0.221],
          [-0.454, 0.701, 0.244],
          [-0.397, 0.565, 0.286],
          [-0.315, 0.405, 0.338],
          [-0.248, 0.296, 0.372],
        ],
        [
          [-0.344, 0.855, 0.216],
          [-0.317, 0.771, 0.234],
          [-0.249, 0.644, 0.284],
          [-0.158, 0.516, 0.337],
          [-0.08, 0.412, 0.387],
        ],
        [
          [-0.174, 0.949, 0.199],
          [-0.117, 0.862, 0.236],
          [-0.051, 0.758, 0.273],
          [0.044, 0.655, 0.314],
          [0.136, 0.553, 0.357],
        ],
      ];
      // Cut the collar stand and leaf from one net. Sharing the rail
      // at the roll line keeps the silhouette continuous as the head turns.
      function collar(name: string, outerStand: Pattern, insideStand: Pattern, leaf: Pattern[]) {
        const middleStand = outerStand.map((point, i) => vector(point).lerp(vector(insideStand[i]), 0.5).toArray());
        const stands = [outerStand, middleStand, insideStand];
        const joined = leaf.map((rail, row) => [
          ...stands[row].slice(0, -1),
          ...rail.map(([x, y, z]) => [x, y, z + 0.059]),
        ]);
        strip(node, name, cloth, joined, { steps: 4, tones: [0.99, 1.02], edge: 0.014, lined: true, tension: 0.28 });
      }
      collar('Left collar fold', leftShoulder, leftHead, frontLeft);
      const rightHead = [
        [0.119, 1.001, -0.151],
        [0.172, 1.02, -0.09],
        [0.222, 1.02, 0.011],
        [0.242, 0.998, 0.095],
        [0.247, 0.952, 0.218],
      ];
      const rightShoulder = [
        [0.217, 0.984, -0.159],
        [0.307, 0.955, -0.065],
        [0.396, 0.919, 0.032],
        [0.467, 0.85, 0.133],
        [0.532, 0.768, 0.255],
      ];
      const frontRight = [
        [
          [0.247, 0.952, 0.159],
          [0.228, 0.862, 0.216],
          [0.204, 0.752, 0.259],
          [0.17, 0.643, 0.311],
          [0.136, 0.553, 0.357],
        ],
        [
          [0.403, 0.871, 0.182],
          [0.408, 0.774, 0.218],
          [0.413, 0.637, 0.274],
          [0.429, 0.511, 0.319],
          [0.461, 0.408, 0.357],
        ],
        [
          [0.532, 0.768, 0.196],
          [0.54, 0.671, 0.23],
          [0.553, 0.543, 0.271],
          [0.572, 0.421, 0.312],
          [0.602, 0.306, 0.35],
        ],
      ];
      collar('Right collar fold', rightHead, rightShoulder, frontRight);
      // The front button stand emerges from the collar and continues to the
      // cut hem. Its narrow return catches a separate highlight.
      const crease = [
        [0.119, 0.536],
        [0.111, 0.467],
        [0.105, 0.401],
        [0.098, 0.333],
        [0.093, 0.266],
        [0.087, 0.199],
        [0.079, 0.133],
        [0.074, 0.065],
        [0.068, 0.001],
      ];
      strip(
        node,
        'Folded front placket',
        cloth,
        [
          fitChest(crease.map(([x, y]) => [x - 0.052, y, -0.006])),
          fitChest(crease.map(([x, y]) => [x - 0.01, y, 0.022])),
          fitChest(crease.map(([x, y]) => [x, y, 0.011])),
        ],
        { steps: 2, tones: [0.88, 1.03], edge: 0.004, tension: 0.2 }
      );

      strip(
        node,
        'Folded breast pocket',
        cloth,
        [
          fitChest([
            [0.372, 0.197, 0.012],
            [0.373, 0.163, 0.014],
            [0.373, 0.122, 0.016],
            [0.396, 0.09, 0.014],
          ]),
          fitChest([
            [0.515, 0.217, 0.016],
            [0.515, 0.169, 0.02],
            [0.514, 0.126, 0.018],
            [0.513, 0.088, 0.014],
          ]),
          fitChest([
            [0.664, 0.236, 0.014],
            [0.659, 0.192, 0.017],
            [0.657, 0.148, 0.016],
            [0.634, 0.106, 0.014],
          ]),
        ],
        { steps: 2, tones: [0.955, 0.945], edge: 0.005, tension: 0.2 }
      );
      const welt = [
        [0.37, 0.201],
        [0.469, 0.215],
        [0.569, 0.228],
        [0.668, 0.241],
      ];
      strip(
        node,
        'Breast pocket welt',
        cloth,
        [
          fitChest(welt.map(([x, y]) => [x, y - 0.033, 0.024])),
          fitChest(welt.map(([x, y]) => [x, y - 0.008, 0.033])),
          fitChest(welt.map(([x, y]) => [x, y, 0.028])),
        ],
        { steps: 3, tones: [0.91, 1.025], edge: 0.004, lined: true }
      );
    } else if (style === 'wrap') {
      strip(
        node,
        'Underlapping collar',
        cloth,
        [
          fitChest([
            [-0.285, 0.907, 0.018],
            [-0.356, 0.834, 0.021],
            [-0.324, 0.768, 0.026],
            [-0.202, 0.663, 0.021],
            [0.06, 0.516, 0.022],
          ]),
          fitChest([
            [-0.189, 0.903, 0.021],
            [-0.161, 0.831, 0.027],
            [-0.085, 0.751, 0.029],
            [0.021, 0.681, 0.029],
            [0.128, 0.621, 0.021],
          ]),
          fitChest([
            [-0.164, 0.901, 0.006],
            [-0.135, 0.83, 0.011],
            [-0.054, 0.749, 0.012],
            [0.046, 0.686, 0.012],
            [0.141, 0.639, 0.011],
          ]),
        ],
        { steps: 3, tones: [0.68, 0.92], edge: 0.006, tension: 0.13 }
      );
      const overlap = [
        [0.237, 0.844],
        [0.153, 0.763],
        [-0.028, 0.623],
        [-0.269, 0.469],
        [-0.497, 0.309],
        [-0.693, 0.146],
        [-0.715, 0.001],
      ];
      strip(
        node,
        'Wrap front fold',
        cloth,
        [
          fitChest(overlap.map(([x, y]) => [x - 0.028, y, 0.006])),
          fitChest(overlap.map(([x, y]) => [x, y, 0.019])),
          fitChest(overlap.map(([x, y]) => [x + 0.032, y, 0.012])),
        ],
        { steps: 3, tones: [0.88, 1.025], edge: 0.004, tension: 0.2 }
      );
      strip(
        node,
        'Wrap facing',
        lining,
        [
          [
            [0.14, 1.049, 0.012],
            [0.294, 0.986, 0.15],
            [0.385, 0.882, 0.239],
            [0.494, 0.751, 0.304],
            [-0.692, 0.143, 0.421],
          ],
          [
            [0.124, 1.032, 0.01],
            [0.18, 0.961, 0.175],
            [0.21, 0.834, 0.278],
            [0.106, 0.698, 0.339],
            [-0.709, 0.129, 0.427],
          ],
          [
            [0.089, 1.015, 0.008],
            [0.075, 0.955, 0.21],
            [-0.045, 0.861, 0.296],
            [-0.302, 0.632, 0.374],
            [-0.725, 0.119, 0.413],
          ],
        ],
        { steps: 4, tones: [0.97, 1.04], edge: 0.014, tension: 0.15, lined: true }
      );
    } else {
      const rim = [
        [0, 0.855, 0.222],
        [0.109, 0.873, 0.214],
        [0.207, 0.914, 0.17],
        [0.263, 0.964, 0.088],
        [0.273, 0.986, -0.012],
        [0.21, 1.006, -0.132],
        [0.106, 1.021, -0.187],
        [0, 1.025, -0.207],
      ];
      const full = [...rim, ...mirror(rim.slice(1, -1).reverse(), -1)];
      const band = full.map(([x, y, z]) => [x * 1.19, y - 0.063, z * 1.18 + 0.005]);
      const turn = full.map(([x, y, z]) => [x * 1.02, y + 0.005, z * 1.03]);
      strip(node, 'Bound crew neckline', cloth, [band, turn, full], {
        closed: true,
        steps: 3,
        tones: [0.62, 1.08],
        edge: 0.007,
      });
      for (const side of [-1, 1]) {
        const raglan = [
          [0.286, 0.854],
          [0.375, 0.716],
          [0.509, 0.548],
          [0.671, 0.381],
          [0.834, 0.239],
          [0.921, 0.111],
          [0.949, 0.002],
        ];
        strip(
          node,
          'Raglan sleeve seam',
          cloth,
          [
            fitChest(raglan.map(([x, y]) => [(x - 0.014) * side, y, 0.007])),
            fitChest(raglan.map(([x, y]) => [x * side, y, 0.017])),
            fitChest(raglan.map(([x, y]) => [(x + 0.012) * side, y, 0.006])),
          ],
          { steps: 2, tones: [1.04, 0.84], edge: 0, tension: 0.22 }
        );
      }
      const gusset = fitChest([
        [0, 0.673, 0.009],
        [-0.102, 0.797, 0.012],
        [0, 0.785, 0.024],
        [0.102, 0.797, 0.012],
      ]);
      cut(
        node,
        'Folded neckline gusset',
        cloth,
        gusset,
        [
          [0.89, 0, 1, 2],
          [0.97, 0, 2, 3],
        ],
        0.004
      );
    }
  }
  const hairstyles: Record<string, Part> = {};
  // Side walls spring out slightly at the cut rim as a bent paper shell does.
  function cap(node: Part, name: string, lower: Pattern, top: Pattern, tone: number) {
    const a = lower.map(vector),
      b = top.map(vector);
    const shoulder = a.map((p, i) => {
      const q = p.clone().lerp(b[i], 0.59);
      q.x *= 1.045;
      q.z *= 1.045;
      q.y += 0.014;
      return q.toArray();
    });
    const peak = Math.max(...b.map((p) => p.y)) + 0.027;
    const crown = b.map((p) => [p.x * 0.47, peak + (p.y - peak) * 0.22, p.z * 0.51 - 0.022]);
    strip(node, name, hair, [lower, shoulder, top, crown], {
      closed: true,
      steps: 4,
      tones: [tone, tone * 1.015, tone * 1.045],
      edge: 0.017,
    });
    cut(node, 'Folded crown', hair, crown, [[tone * 1.045, ...crown.map((_, i) => i)]]);
    const inside = lower.map(([x, y, z]) => [x * 0.81, y + 0.076, z * 0.77]);
    strip(node, 'Cut rim return', hair, [inside, lower], { closed: true, steps: 4, tones: [tone * 0.56], edge: 0 });
  }

  {
    const node = (hairstyles.sweep = group(portrait, 'Sweep'));
    const lower = [
      [0, 2.234, 0.362],
      [0.258, 2.335, 0.278],
      [0.416, 1.969, 0.237],
      [0.512, 1.887, 0.039],
      [0.548, 1.625, -0.115],
      [0.42, 1.467, -0.268],
      [0.025, 1.349, -0.407],
      [-0.387, 1.423, -0.312],
      [-0.55, 1.571, -0.067],
      [-0.543, 1.817, 0.163],
      [-0.283, 2.087, 0.319],
    ];
    const top = [
      [-0.01, 2.51, 0.163],
      [0.217, 2.568, 0.091],
      [0.378, 2.451, 0.107],
      [0.471, 2.328, -0.007],
      [0.428, 2.369, -0.154],
      [0.284, 2.447, -0.265],
      [0.019, 2.479, -0.281],
      [-0.255, 2.458, -0.231],
      [-0.405, 2.357, -0.063],
      [-0.423, 2.274, 0.092],
      [-0.256, 2.419, 0.202],
    ];
    cap(node, 'Swept cap', lower, top, 0.89);
    // A single long crescent rolls from the part, across the brow, then
    // folds back behind the far ear. Three rails shape its convex surface.
    const topRail = [
      [0.539, 2.228, -0.132],
      [0.44, 2.478, -0.07],
      [0.248, 2.609, 0.005],
      [-0.055, 2.623, 0.057],
      [-0.364, 2.478, 0.132],
      [-0.553, 2.26, 0.148],
      [-0.601, 2.004, 0.021],
      [-0.548, 1.79, -0.12],
      [-0.384, 1.584, -0.278],
    ];
    const bottomRail = [
      [0.526, 2.153, -0.094],
      [0.488, 2.316, 0.162],
      [0.338, 2.368, 0.325],
      [-0.037, 2.198, 0.474],
      [-0.382, 2.033, 0.449],
      [-0.587, 1.884, 0.342],
      [-0.645, 1.76, 0.174],
      [-0.561, 1.608, 0.005],
      [-0.392, 1.505, -0.192],
    ];
    const shoulder = topRail.map((p, i) => {
      const point = vector(p).lerp(vector(bottomRail[i]), 0.41);
      point.x *= 1.026;
      point.z += i > 1 && i < 7 ? 0.048 : 0.015;
      point.y += 0.012;
      return point.toArray();
    });
    strip(node, 'Sweeping forelock', hair, [topRail, shoulder, bottomRail], {
      steps: 5,
      tones: [1.01, 1.025],
      edge: 0.022,
      lined: true,
    });
    const innerRim = bottomRail.map(([x, y, z]) => [x * 0.986, y - 0.012, z * 0.986]);
    const inside = bottomRail.map(([x, y, z]) => [x * 0.84, y + 0.026, z * 0.78]);
    strip(node, 'Turned-under sweep', hair, [innerRim, inside], { steps: 5, tones: [0.53], edge: 0 });
    strip(
      node,
      'Temple tuck',
      hair,
      [
        [
          [0.199, 2.573, 0.057],
          [0.413, 2.45, 0.107],
          [0.525, 2.271, 0.056],
          [0.554, 2.075, -0.012],
          [0.537, 1.868, -0.093],
        ],
        [
          [0.25, 2.49, 0.181],
          [0.41, 2.318, 0.241],
          [0.501, 2.145, 0.191],
          [0.543, 1.969, 0.091],
          [0.523, 1.814, -0.061],
        ],
        [
          [0.3, 2.357, 0.298],
          [0.365, 2.204, 0.304],
          [0.426, 2.026, 0.268],
          [0.463, 1.922, 0.152],
          [0.512, 1.826, -0.034],
        ],
      ],
      { steps: 4, tones: [0.96, 0.955], edge: 0.018 }
    );
  }
  {
    const node = (hairstyles.crop = group(portrait, 'Crop'));
    const lower = [
      [-0.015, 2.201, 0.415],
      [0.277, 2.211, 0.337],
      [0.432, 2.119, 0.193],
      [0.475, 1.988, 0.037],
      [0.456, 1.814, -0.157],
      [0.287, 1.696, -0.318],
      [-0.027, 1.682, -0.366],
      [-0.316, 1.701, -0.282],
      [-0.463, 1.904, -0.102],
      [-0.476, 2.09, 0.129],
      [-0.266, 2.27, 0.347],
    ];
    const top = [
      [-0.013, 2.468, 0.237],
      [0.235, 2.436, 0.147],
      [0.312, 2.381, 0.077],
      [0.357, 2.334, -0.022],
      [0.318, 2.387, -0.148],
      [0.183, 2.45, -0.236],
      [-0.065, 2.504, -0.246],
      [-0.225, 2.461, -0.167],
      [-0.357, 2.395, -0.063],
      [-0.34, 2.395, 0.083],
      [-0.228, 2.466, 0.213],
    ];
    cap(node, 'Close crop', lower, top, 0.96);
    strip(
      node,
      'Crop fringe',
      hair,
      [
        [
          [-0.311, 2.369, -0.101],
          [-0.266, 2.474, -0.052],
          [-0.085, 2.52, 0.023],
          [0.112, 2.501, 0.045],
          [0.269, 2.429, 0.069],
          [0.348, 2.34, 0.087],
        ],
        [
          [-0.382, 2.303, 0.11],
          [-0.267, 2.441, 0.165],
          [-0.075, 2.491, 0.174],
          [0.117, 2.456, 0.198],
          [0.264, 2.381, 0.191],
          [0.365, 2.29, 0.139],
        ],
        [
          [-0.386, 2.29, 0.184],
          [-0.277, 2.39, 0.269],
          [-0.077, 2.424, 0.283],
          [0.124, 2.375, 0.302],
          [0.277, 2.312, 0.263],
          [0.383, 2.226, 0.181],
        ],
      ],
      { steps: 3, tones: [1.02, 1.005], edge: 0.011, lined: true }
    );
  }
  {
    const node = (hairstyles.bob = group(portrait, 'Bob'));
    node.scale.x = 1.105;
    const lower = [
      [0.0, 2.252, 0.419],
      [0.202, 2.19, 0.387],
      [0.36, 1.912, 0.347],
      [0.512, 1.253, 0.18],
      [0.571, 1.211, -0.026],
      [0.495, 1.335, -0.24],
      [0.075, 1.378, -0.427],
      [-0.413, 1.333, -0.311],
      [-0.583, 1.235, -0.077],
      [-0.569, 1.301, 0.149],
      [-0.351, 1.926, 0.331],
      [-0.182, 2.199, 0.401],
    ];
    const top = [
      [0.013, 2.482, 0.237],
      [0.205, 2.461, 0.189],
      [0.345, 2.375, 0.137],
      [0.44, 2.292, 0.051],
      [0.457, 2.28, -0.062],
      [0.325, 2.421, -0.194],
      [0.033, 2.533, -0.271],
      [-0.27, 2.454, -0.205],
      [-0.428, 2.312, -0.082],
      [-0.427, 2.302, 0.055],
      [-0.333, 2.404, 0.159],
      [-0.15, 2.511, 0.22],
    ];
    cap(node, 'Chin-length bob', lower, top, 0.95);
    for (const side of [-1, 1]) {
      const part = [
        [-0.065, 2.491, 0.155],
        [0.119, 2.519, 0.125],
        [0.347, 2.425, 0.091],
        [0.459, 2.233, 0.072],
        [0.498, 1.899, 0.064],
        [0.532, 1.551, 0.073],
        [0.548, 1.257, 0.061],
      ];
      const turn = [
        [-0.074, 2.478, 0.209],
        [0.123, 2.492, 0.216],
        [0.312, 2.375, 0.216],
        [0.435, 2.168, 0.218],
        [0.489, 1.91, 0.202],
        [0.511, 1.561, 0.194],
        [0.521, 1.271, 0.175],
      ];
      const edge = [
        [-0.084, 2.441, 0.261],
        [0.089, 2.413, 0.32],
        [0.247, 2.276, 0.344],
        [0.373, 2.076, 0.334],
        [0.449, 1.86, 0.291],
        [0.477, 1.53, 0.249],
        [0.49, 1.28, 0.226],
      ];
      const fit = (rail: Pattern) =>
        mirror(rail, side).map(([x, y, z], i) => [x + (side < 0 && i < 2 ? -0.05 : 0), y + (side < 0 ? 0.023 : 0), z]);
      const rails = [fit(part), fit(turn), fit(edge)];
      strip(node, 'Face-framing bob panel', hair, side > 0 ? rails.reverse() : rails, {
        steps: 4,
        tones: [0.988, 1.013],
        edge: 0.013,
        lined: true,
      });
    }
  }
  {
    const node = (hairstyles.curls = group(portrait, 'Curls'));
    const lower = [
      [-0.042, 2.309, 0.38],
      [0.23, 2.316, 0.349],
      [0.408, 2.213, 0.226],
      [0.514, 1.982, 0.072],
      [0.53, 1.856, -0.102],
      [0.397, 1.665, -0.261],
      [0.085, 1.59, -0.413],
      [-0.272, 1.653, -0.353],
      [-0.477, 1.805, -0.185],
      [-0.55, 1.936, 0.067],
      [-0.433, 2.174, 0.231],
      [-0.243, 2.286, 0.359],
    ];
    const top = [
      [-0.048, 2.544, 0.258],
      [0.183, 2.563, 0.194],
      [0.405, 2.431, 0.158],
      [0.505, 2.295, 0.061],
      [0.502, 2.292, -0.105],
      [0.371, 2.468, -0.226],
      [0.076, 2.56, -0.323],
      [-0.248, 2.515, -0.261],
      [-0.446, 2.357, -0.127],
      [-0.508, 2.268, 0.071],
      [-0.374, 2.446, 0.204],
      [-0.241, 2.535, 0.236],
    ];
    const foundations = top.map(([x, y, z]) => [
      x * 1.035,
      y + (z < 0.11 ? 0.088 : 0.026),
      z > 0 ? z - 0.079 : z * 1.085,
    ]);
    cap(node, 'Cropped curls', lower, foundations, 0.85);
    // Each lock is a broad pleat which starts at the crown, projects from
    // the hair mass, then rolls back underneath a neighbouring pleat.
    // The long central curl changes direction halfway across the forehead.
    function lock(name: string, outer: Pattern, inner: Pattern, bulge: Pattern) {
      const spine = outer.map((p, i) => {
        const q = vector(p).lerp(vector(inner[i]), 0.42);
        q.x += bulge[i][0];
        q.y += bulge[i][1];
        q.z += bulge[i][2];
        return q.toArray();
      });
      strip(node, name, hair, [outer, spine, inner], {
        steps: 4,
        tones: [1.02, 0.982],
        edge: 0.02,
        lined: true,
        tension: 0.4,
      });
    }
    lock(
      'Long crown curl',
      [
        [-0.084, 2.546, -0.208],
        [-0.126, 2.663, -0.027],
        [-0.129, 2.712, 0.165],
        [-0.094, 2.662, 0.32],
        [-0.096, 2.574, 0.43],
        [-0.155, 2.405, 0.493],
        [-0.278, 2.267, 0.47],
        [-0.358, 2.234, 0.403],
      ],
      [
        [0.09, 2.565, -0.146],
        [0.153, 2.664, 0.001],
        [0.213, 2.693, 0.182],
        [0.252, 2.617, 0.324],
        [0.219, 2.513, 0.413],
        [0.081, 2.372, 0.485],
        [-0.164, 2.241, 0.455],
        [-0.337, 2.233, 0.389],
      ],
      [
        [0, 0.012, 0],
        [0, 0.035, 0],
        [0, 0.043, 0.012],
        [0.012, 0.036, 0.02],
        [0.016, 0.02, 0.04],
        [0.018, 0.01, 0.035],
        [0.008, -0.002, 0.019],
        [0, 0, 0.001],
      ]
    );
    lock(
      'Swept side curl',
      [
        [-0.409, 2.428, -0.107],
        [-0.406, 2.549, 0.028],
        [-0.385, 2.602, 0.186],
        [-0.342, 2.556, 0.318],
        [-0.341, 2.459, 0.423],
        [-0.412, 2.275, 0.478],
        [-0.515, 2.178, 0.377],
        [-0.538, 2.173, 0.278],
      ],
      [
        [-0.238, 2.5, -0.158],
        [-0.211, 2.598, 0.02],
        [-0.161, 2.642, 0.168],
        [-0.118, 2.567, 0.294],
        [-0.149, 2.467, 0.41],
        [-0.294, 2.275, 0.486],
        [-0.449, 2.182, 0.378],
        [-0.524, 2.176, 0.262],
      ],
      [
        [-0.009, 0.012, 0],
        [-0.016, 0.023, 0.009],
        [-0.023, 0.028, 0.016],
        [-0.029, 0.021, 0.03],
        [-0.026, 0.01, 0.039],
        [-0.016, 0.002, 0.027],
        [-0.008, 0, 0.014],
        [0, 0, 0.001],
      ]
    );
    lock(
      'Temple wave',
      [
        [0.119, 2.538, -0.229],
        [0.17, 2.643, -0.104],
        [0.235, 2.677, 0.033],
        [0.299, 2.628, 0.206],
        [0.33, 2.531, 0.334],
        [0.298, 2.429, 0.404],
        [0.232, 2.34, 0.457],
        [0.15, 2.299, 0.483],
        [0.101, 2.307, 0.479],
        [0.096, 2.337, 0.464],
        [0.123, 2.354, 0.438],
        [0.168, 2.34, 0.406],
      ],
      [
        [0.311, 2.483, -0.204],
        [0.363, 2.583, -0.065],
        [0.416, 2.61, 0.059],
        [0.486, 2.545, 0.168],
        [0.495, 2.445, 0.261],
        [0.459, 2.355, 0.354],
        [0.382, 2.255, 0.426],
        [0.245, 2.174, 0.459],
        [0.131, 2.169, 0.453],
        [0.073, 2.209, 0.436],
        [0.076, 2.292, 0.412],
        [0.147, 2.33, 0.393],
      ],
      [
        [0, 0.006, 0],
        [0.012, 0.02, 0.002],
        [0.022, 0.033, 0.008],
        [0.032, 0.027, 0.018],
        [0.032, 0.015, 0.028],
        [0.022, 0.007, 0.026],
        [0.016, 0.001, 0.023],
        [0.008, -0.005, 0.018],
        [0.002, -0.005, 0.014],
        [-0.002, 0, 0.012],
        [0.002, 0, 0.009],
        [0, 0, 0.002],
      ]
    );
    lock(
      'Short temple curl',
      [
        [0.316, 2.451, -0.236],
        [0.422, 2.511, -0.174],
        [0.507, 2.465, -0.068],
        [0.551, 2.372, 0.075],
        [0.532, 2.235, 0.209],
        [0.462, 2.098, 0.273],
        [0.396, 2.124, 0.24],
      ],
      [
        [0.41, 2.341, -0.276],
        [0.508, 2.385, -0.208],
        [0.567, 2.353, -0.085],
        [0.581, 2.269, 0.048],
        [0.558, 2.151, 0.151],
        [0.481, 2.061, 0.204],
        [0.401, 2.114, 0.226],
      ],
      [
        [0, 0.006, 0],
        [0.012, 0.021, -0.014],
        [0.031, 0.02, 0],
        [0.032, 0.016, 0.016],
        [0.022, 0.009, 0.019],
        [0.013, 0.002, 0.012],
        [0, 0, 0],
      ]
    );
    lock(
      'Nape roll',
      [
        [-0.363, 2.422, -0.23],
        [-0.468, 2.459, -0.13],
        [-0.518, 2.388, 0.02],
        [-0.541, 2.253, 0.153],
        [-0.515, 2.148, 0.24],
        [-0.45, 2.127, 0.231],
      ],
      [
        [-0.41, 2.318, -0.237],
        [-0.512, 2.343, -0.146],
        [-0.563, 2.29, -0.006],
        [-0.571, 2.16, 0.104],
        [-0.523, 2.081, 0.175],
        [-0.456, 2.11, 0.222],
      ],
      [
        [0, 0, 0],
        [-0.02, 0.013, 0],
        [-0.029, 0.021, 0.011],
        [-0.018, 0.01, 0.017],
        [-0.009, 0, 0.01],
        [0, 0, 0],
      ]
    );
  }
  const accessories = {
    none: group(portrait, 'No accessories'),
    glasses: group(portrait, 'Glasses'),
    earrings: group(portrait, 'Earrings'),
  };
  for (const s of [-1, 1]) {
    const frontZ = (x: number) => 0.528 - 0.17 * (x / 0.433) ** 2;
    const outline = [
      [0.05, 1.964],
      [0.347, 1.986],
      [0.429, 1.951],
      [0.391, 1.794],
      [0.315, 1.751],
      [0.12, 1.755],
      [0.065, 1.792],
    ];
    const inner = [
      [0.082, 1.931],
      [0.343, 1.956],
      [0.393, 1.934],
      [0.361, 1.81],
      [0.302, 1.783],
      [0.135, 1.785],
      [0.092, 1.811],
    ];
    const frame = [...outline, ...inner].map(([x, y]) => [x * s, y, frontZ(x)]);
    const n = outline.length;
    cut(
      accessories.glasses,
      'Open spectacle frame',
      ink,
      frame,
      outline.map((_, i) => [1, i, (i + 1) % n, ((i + 1) % n) + n, i + n])
    );
    cut(
      accessories.glasses,
      'Spectacle arm',
      ink,
      mirror(
        [
          [0.408, 1.96, 0.383],
          [0.437, 1.954, 0.312],
          [0.536, 1.908, 0.009],
          [0.517, 1.855, -0.055],
          [0.511, 1.873, -0.051],
          [0.517, 1.931, 0.012],
          [0.41, 1.978, 0.37],
        ],
        s
      ),
      [[1, 0, 1, 2, 3, 4, 5, 6]]
    );
    const bail = [];
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      bail.push([(0.497 + 0.029 * Math.cos(a)) * s, 1.611 + 0.055 * Math.sin(a), 0.111 + 0.016 * Math.cos(a)]);
    }
    const aperture = bail.map(([x, y, z]) => [
      (x - 0.497 * s) * 0.6 + 0.497 * s,
      (y - 1.611) * 0.78 + 1.611,
      (z - 0.111) * 0.62 + 0.111,
    ]);
    cut(
      accessories.earrings,
      'Earring bail',
      gold,
      [...bail, ...aperture],
      bail.map((_, i) => [1.02, i, (i + 1) % 12, ((i + 1) % 12) + 12, i + 12]),
      0.008
    );
    const drop = mirror(
      [
        [0.512, 1.57, 0.118],
        [0.579, 1.482, 0.121],
        [0.527, 1.309, 0.136],
        [0.465, 1.472, 0.156],
        [0.526, 1.465, 0.179],
        [0.513, 1.47, 0.105],
      ],
      s
    );
    cut(accessories.earrings, 'Folded drop', gold, drop, [
      [1.08, 0, 1, 4],
      [1.03, 1, 2, 4],
      [0.85, 2, 3, 4],
      [0.91, 3, 0, 4],
      [0.87, 0, 5, 1],
      [0.84, 1, 5, 2],
      [0.81, 2, 5, 3],
      [0.88, 3, 5, 0],
    ]);
  }
  cut(
    accessories.glasses,
    'Spectacle bridge',
    ink,
    [
      [-0.078, 1.965, 0.522],
      [-0.026, 1.974, 0.541],
      [0.033, 1.97, 0.541],
      [0.078, 1.963, 0.522],
      [0.081, 1.925, 0.522],
      [0.032, 1.939, 0.549],
      [-0.02, 1.942, 0.549],
      [-0.079, 1.928, 0.521],
    ],
    [[1, 0, 1, 2, 3, 4, 5, 6, 7]]
  );

  const cream = new T.Color('#eddbc1');
  function show(library: Record<string, Part>, selected: string, fallback: string) {
    const key = Object.hasOwn(library, selected) ? selected : fallback;
    for (const name of Object.keys(library)) library[name].visible = name === key;
  }
  function setRecipe(next: AvatarRecipe) {
    skin.color.set(next.skinColor);
    // Retain the pigment hue while giving the darkest stocks enough
    // reflected light to separate a temple fold from a dark glasses frame.
    const luminance = skin.color.r * 0.2126 + skin.color.g * 0.7152 + skin.color.b * 0.0722;
    const darkStock = 1 - T.MathUtils.smoothstep(luminance, 0.035, 0.15);
    skin.color.multiplyScalar(1 + 0.35 * darkStock);
    hair.color.set(next.hairColor);
    cloth.color.set(next.clothColor);
    lining.color.copy(cloth.color).lerp(cream, 0.52);
    show(outfits, next.outfit, 'jacket');
    show(hairstyles, next.hair, 'sweep');
    show(accessories, next.accessory, 'none');
  }
  function pose({ x = 0, y = 0, reduced = false, time = 0 }: PersonPose = {}) {
    const gazeX = Math.max(-1, Math.min(1, x)),
      gazeY = Math.max(-1, Math.min(1, y));
    torso.rotation.y = 0.07 + gazeX * 0.02618;
    head.rotation.order = 'YXZ';
    head.rotation.y = -0.591 + gazeX * 0.41015;
    head.rotation.x = -gazeY * 0.137 + (!reduced ? 0.006 * Math.sin(time * 1.53) : 0);
    head.rotation.z = -0.025 - gazeX * 0.027;
  }
  setRecipe(recipe);
  pose({ reduced: true });
  return { root, body: torso, head, pose, setRecipe };
}
