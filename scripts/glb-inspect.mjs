import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

const nodes = json.nodes ?? [];
const meshes = json.meshes ?? [];
const accessors = json.accessors ?? [];

import { Matrix4, Quaternion, Vector3, Box3 } from "three";

const world = new Array(nodes.length).fill(null);
const parents = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parents.set(c, i)));

function compose(n) {
  const m = new Matrix4();
  if (n.matrix) {
    m.fromArray(n.matrix);
  } else {
    const t = n.translation ?? [0, 0, 0];
    const r = n.rotation ?? [0, 0, 0, 1];
    const s = n.scale ?? [1, 1, 1];
    m.compose(new Vector3(...t), new Quaternion(...r), new Vector3(...s));
  }
  return m;
}
function computeWorld(i) {
  if (world[i]) return world[i];
  const local = compose(nodes[i]);
  const parent = parents.get(i);
  const m = parent === undefined ? local : computeWorld(parent).clone().multiply(local);
  world[i] = m;
  return m;
}

const unionAll = new Box3();
const perNode = [];
nodes.forEach((n, i) => {
  if (n.mesh === undefined) return;
  const mesh = meshes[n.mesh];
  const box = new Box3();
  for (const prim of mesh.primitives) {
    const acc = accessors[prim.attributes.POSITION];
    if (!acc?.min || !acc?.max) continue;
    box.expandByPoint(new Vector3(...acc.min));
    box.expandByPoint(new Vector3(...acc.max));
  }
  const w = computeWorld(i);
  box.applyMatrix4(w);
  unionAll.union(box);
  perNode.push({ i, name: n.name, box });
});

console.log("meshes:", perNode.length);
for (const p of perNode) {
  const s = p.box.getSize(new Vector3());
  console.log(
    `node[${p.i}] "${p.name}" size=(${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}) minX=${p.box.min.x.toFixed(2)} maxX=${p.box.max.x.toFixed(2)} minY=${p.box.min.y.toFixed(2)} maxY=${p.box.max.y.toFixed(2)}`,
  );
}
const total = unionAll.getSize(new Vector3());
console.log(`union size=(${total.x.toFixed(2)}, ${total.y.toFixed(2)}, ${total.z.toFixed(2)}) minY=${unionAll.min.y.toFixed(2)}`);
const sceneRoots = (json.scenes?.[json.scene ?? 0]?.nodes ?? []).map((i) => nodes[i]?.name);
console.log("scene roots:", sceneRoots.join(", "));
console.log("all node names:", nodes.map((n) => n.name).join(", ").slice(0, 1200));
