/**
 * The cutting geometry, from the same meshes the builder draws.
 *
 * The pack has always carried drawings — measured views and a per-storey
 * profile thumbnail — and a maker space could work from those. What it could
 * not do was open them in CAM. This turns the storey meshes into a DXF: each
 * board's outline sliced out of the solid at mid-thickness, stitched into
 * closed loops, laid out side by side at 1:1 in millimetres.
 *
 * What it is not: a toolpath. There is no cutter compensation, no pocket
 * depth, no dogbone relief at the inside corners. Those come from BEEHOME.gh,
 * which knows the tool and the stock; this file knows only where the material
 * ends. Everything here is derived from the mesh — nothing is assumed about
 * how it gets cut.
 *
 * Coordinates. `Stage.load()` hands back geometry that has already been turned
 * from Rhino's Z-up millimetres into three's Y-up metres: rotateX(-90°) then
 * ×0.001, so a Rhino point (x, y, z) arrives as (x, z, -y) / 1000. This module
 * undoes that, because a cutting file wants the board lying in the XY plane
 * the way it was modelled.
 */

/** Mesh coordinates are exact to a few microns; features are millimetres. */
const WELD_MM = 0.01;

/** Below this a stitched loop is slicing noise rather than a part. */
const MIN_AREA_MM2 = 0.05;

/** How far a point may sit off the line through its neighbours and be dropped. */
const COLLINEAR_MM = 0.001;

const LAYERS = [
  { name: 'CUT-OUTER', colour: 7 },  // outer profile of the board
  { name: 'CUT-INNER', colour: 1 },  // interior openings
  { name: 'LABEL', colour: 3 },      // part identification, not geometry
];

/**
 * Every triangle of a BufferGeometry, in board millimetres.
 *
 * Deliberately takes the geometry duck-typed rather than importing three: this
 * module has no dependencies, which is also what makes it testable outside a
 * browser.
 *
 * @param {{attributes: {position: {array: ArrayLike<number>, count: number}},
 *          index?: {array: ArrayLike<number>}|null}} geometry
 * @returns {Array<Array<number>>} one [ax,ay,ah, bx,by,bh, cx,cy,ch] per face
 */
export function boardTriangles(geometry) {
  const position = geometry.attributes.position;
  const source = position.array;
  const index = geometry.index ? geometry.index.array : null;
  const count = index ? index.length : position.count;

  const at = (v) => {
    const i = (index ? index[v] : v) * 3;
    // three (X, Y, Z) metres -> board (x, y) plan mm and h height mm.
    return [source[i] * 1000, -source[i + 2] * 1000, source[i + 1] * 1000];
  };

  const out = [];
  for (let v = 0; v + 2 < count; v += 3) {
    out.push([...at(v), ...at(v + 1), ...at(v + 2)]);
  }
  return out;
}

/**
 * Slice a mesh on a horizontal plane and return the boundary as directed
 * segments.
 *
 * Direction is not decoration. Each segment is turned so the material sits on
 * its left, taken from the winding of the triangle it came off, which means
 * the loops stitched out of them come back already wound: outer boundaries
 * counter-clockwise, openings clockwise. Sorting that out afterwards from
 * containment tests would be guesswork by comparison.
 *
 * A vertex sitting exactly on the plane has no side to be on, and the two
 * triangles sharing it would disagree about what to emit. Nudging the
 * comparison rather than the geometry puts every such vertex above the plane
 * consistently, which is why the caller cuts at mid-thickness in the first
 * place: away from the faces, the case barely arises.
 */
export function sectionAt(geometry, heightMm) {
  const segments = [];
  for (const t of boardTriangles(geometry)) {
    const p = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]];
    const d = p.map((v) => {
      const gap = v[2] - heightMm;
      return Math.abs(gap) < 1e-9 ? 1e-9 : gap;
    });
    if (d[0] > 0 === d[1] > 0 && d[1] > 0 === d[2] > 0) continue;

    const hits = [];
    for (let i = 0; i < 3; i += 1) {
      const j = (i + 1) % 3;
      if (d[i] > 0 === d[j] > 0) continue;
      const s = d[i] / (d[i] - d[j]);
      hits.push([p[i][0] + (p[j][0] - p[i][0]) * s, p[i][1] + (p[j][1] - p[i][1]) * s]);
    }
    if (hits.length !== 2) continue;

    // The face normal, projected flat. Turned a quarter turn it points the
    // way the boundary runs with the solid on its left.
    const ux = p[1][0] - p[0][0];
    const uy = p[1][1] - p[0][1];
    const uh = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0];
    const vy = p[2][1] - p[0][1];
    const vh = p[2][2] - p[0][2];
    const nx = uy * vh - uh * vy;
    const ny = uh * vx - ux * vh;
    const dir = [-ny, nx];

    const [a, b] = hits;
    const along = (b[0] - a[0]) * dir[0] + (b[1] - a[1]) * dir[1];
    segments.push(along >= 0 ? [a, b] : [b, a]);
  }
  return segments;
}

/**
 * Weld points onto shared vertices, so segments that meet actually meet.
 *
 * Rounding to a grid would split a pair of points that straddle a cell
 * boundary however fine the grid, so this hashes into cells and then looks at
 * the neighbours too — a point joins an existing vertex if it is genuinely
 * within tolerance of it, not merely in the same box.
 */
function welder(eps) {
  const cells = new Map();
  const points = [];
  const key = (i, j) => `${i},${j}`;
  const add = (x, y) => {
    const ci = Math.floor(x / eps);
    const cj = Math.floor(y / eps);
    for (let i = ci - 1; i <= ci + 1; i += 1) {
      for (let j = cj - 1; j <= cj + 1; j += 1) {
        for (const id of cells.get(key(i, j)) || []) {
          const p = points[id];
          if (Math.abs(p[0] - x) <= eps && Math.abs(p[1] - y) <= eps) return id;
        }
      }
    }
    const id = points.length;
    points.push([x, y]);
    const bucket = cells.get(key(ci, cj));
    if (bucket) bucket.push(id);
    else cells.set(key(ci, cj), [id]);
    return id;
  };
  return { add, points };
}

/** Twice the signed area. Positive is counter-clockwise. */
export function signedArea(loop) {
  let sum = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/**
 * Drop points that sit on the line between their neighbours.
 *
 * A triangulated wall sheds one section segment per triangle, so a plain
 * 120 mm edge arrives as a run of collinear pieces. They cut identically
 * either way; this is so the file reads like the drawing it represents.
 */
function straighten(loop) {
  const out = [];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[i];
    const c = loop[(i + 1) % loop.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const span = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (span > 0 && Math.abs(cross) / span < COLLINEAR_MM) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : loop;
}

/**
 * Stitch directed segments into closed loops.
 *
 * Every welded vertex on a closed section has exactly as many segments leaving
 * it as arriving, so the walk is only ever picking the next unused one. A
 * segment that cannot be continued means the section was not closed — a hole
 * in the mesh, a plane grazing a face — and the partial loop is dropped rather
 * than closed by force, because a fake loop in a cutting file is worse than a
 * missing one.
 *
 * @returns {{loops: Array<Array<[number, number]>>, dropped: number}}
 */
export function stitch(segments, eps = WELD_MM) {
  const { add, points } = welder(eps);
  const outgoing = new Map();
  const edges = [];

  for (const [a, b] of segments) {
    const ia = add(a[0], a[1]);
    const ib = add(b[0], b[1]);
    if (ia === ib) continue; // shorter than the weld tolerance
    const id = edges.length;
    edges.push({ from: ia, to: ib, used: false });
    if (outgoing.has(ia)) outgoing.get(ia).push(id);
    else outgoing.set(ia, [id]);
  }

  const loops = [];
  let dropped = 0;
  for (let start = 0; start < edges.length; start += 1) {
    if (edges[start].used) continue;
    const walk = [];
    let edge = start;
    let closed = false;
    while (edge !== -1 && !edges[edge].used) {
      edges[edge].used = true;
      walk.push(points[edges[edge].from]);
      const next = (outgoing.get(edges[edge].to) || []).find((e) => !edges[e].used);
      if (edges[edge].to === edges[start].from) { closed = true; break; }
      edge = next === undefined ? -1 : next;
    }
    if (!closed || walk.length < 3) { dropped += 1; continue; }
    const loop = straighten(walk);
    if (Math.abs(signedArea(loop)) < MIN_AREA_MM2) { dropped += 1; continue; }
    loops.push(loop);
  }
  return { loops, dropped };
}

/**
 * One storey's cut profile.
 *
 * Cut at mid-thickness on purpose. The faces of these boards are dense with
 * coplanar geometry — every pocket floor and every rebate sits on some exact
 * millimetre — and a plane laid on one of them slices along a face rather than
 * through it, which produces slivers instead of a boundary. Halfway is the one
 * height guaranteed to be clear of them.
 *
 * The consequence is worth being plain about, and it is not small: this is the
 * board's shape at that one height, not its through-profile. These storeys are
 * pocketed slabs — measured across the thickness of an A the enclosed area
 * runs from 15847 mm² near the bottom face to the full 19200 mm² rectangle
 * above 20 mm — so the notches this draws are cavity walls that stop partway
 * down, not edges to cut through. The file says so, in text, on itself.
 */
export function storeyProfile(geometry, thicknessMm) {
  const { loops, dropped } = stitch(sectionAt(geometry, thicknessMm / 2));
  return {
    outer: loops.filter((l) => signedArea(l) > 0),
    inner: loops.filter((l) => signedArea(l) < 0),
    dropped,
  };
}

/** Bounding box of a set of loops. */
function extentOf(loops) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const loop of loops) {
    for (const [x, y] of loop) {
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
  }
  return box;
}

const LABEL_MM = 7;      // text cap height
const LABEL_BAND = 13;   // room reserved under each row for it

/**
 * Shelf packing: parts left to right, wrapping when the row runs out.
 *
 * Not nesting. Nesting is a question about somebody's stock, their tool and
 * their offcuts, and answering it here would be inventing all three. This puts
 * the parts in a row in build order at a spacing nothing can overlap at, which
 * is the arrangement you would want to re-nest from anyway.
 */
export function layout(parts, { gapMm = 20, rowMm = 1200 } = {}) {
  const placed = [];
  let x = 0;
  let rowY = 0;
  let rowTop = 0;

  for (const part of parts) {
    const loops = [...part.outer, ...part.inner];
    const [minX, minY, maxX, maxY] = extentOf(loops);
    const width = maxX - minX;
    const height = maxY - minY;
    if (x > 0 && x + width > rowMm) {
      rowY = rowTop + LABEL_BAND + gapMm;
      rowTop = rowY;
      x = 0;
    }
    const dx = x - minX;
    const dy = rowY - minY;
    const move = (loop) => loop.map(([px, py]) => [px + dx, py + dy]);
    placed.push({
      ...part,
      outer: part.outer.map(move),
      inner: part.inner.map(move),
      label: { x, y: rowY - LABEL_BAND + 3, text: part.label },
    });
    x += width + gapMm;
    rowTop = Math.max(rowTop, rowY + height);
  }
  return placed;
}

/* ------------------------------------------------------------------ */
/* DXF R12                                                             */
/* ------------------------------------------------------------------ */

/**
 * R12, not something newer, and POLYLINE rather than LWPOLYLINE.
 *
 * LWPOLYLINE is the obvious entity for a closed 2D profile and it does not
 * exist in R12 — it arrived with R14. R12 is the flavour every CAM package,
 * every old post and every free viewer will open without argument, and the
 * heavyweight POLYLINE/VERTEX/SEQEND triple is the price of that. For a part
 * with a few dozen corners the file is still small.
 */
const pair = (code, value) => `${code}\n${value}\n`;

/** Six places is well past the precision the mesh carries; it just avoids 1e-7. */
const num = (v) => (Math.abs(v) < 1e-9 ? '0.0' : v.toFixed(6));

function polyline(loop, layer) {
  let out = pair(0, 'POLYLINE') + pair(8, layer)
    + pair(66, 1)   // vertices follow
    + pair(70, 1)   // closed
    + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0');
  for (const [x, y] of loop) {
    out += pair(0, 'VERTEX') + pair(8, layer)
      + pair(10, num(x)) + pair(20, num(y)) + pair(30, '0.0');
  }
  return out + pair(0, 'SEQEND') + pair(8, layer);
}

/**
 * R12 TEXT carries one line, and only what its codepage can spell. Anything
 * outside plain ASCII is dropped rather than mangled into a different
 * character somewhere downstream.
 */
function text(x, y, height, body) {
  return pair(0, 'TEXT') + pair(8, 'LABEL')
    + pair(10, num(x)) + pair(20, num(y)) + pair(30, '0.0')
    + pair(40, num(height))
    + pair(1, String(body).replace(/[^\x20-\x7e]/g, ''));
}

/**
 * Build the DXF for a stack.
 *
 * @param {Array<{letter: string, geometry: object, thicknessMm: number}>} storeys
 *   in build order, bottom first
 * @param {{id?: string, exportString?: string, gapMm?: number, rowMm?: number}} options
 * @returns {{text: string, parts: Array<object>, extent: number[]}}
 */
export function buildDxf(storeys, {
  id = '', exportString = '', gapMm = 20, rowMm = 1200,
} = {}) {
  const profiles = storeys.map((storey, i) => {
    const profile = storeyProfile(storey.geometry, storey.thicknessMm);
    return {
      ...profile,
      letter: storey.letter,
      order: i + 1,
      thicknessMm: storey.thicknessMm,
      sectionMm: storey.thicknessMm / 2,
      label: `${String(i + 1).padStart(2, '0')} ${storey.letter} t${storey.thicknessMm}`,
    };
  });
  const parts = layout(profiles, { gapMm, rowMm });

  const all = parts.flatMap((p) => [...p.outer, ...p.inner]);
  const box = all.length ? extentOf(all) : [0, 0, 0, 0];

  let body = '';
  for (const part of parts) {
    for (const loop of part.outer) body += polyline(loop, 'CUT-OUTER');
    for (const loop of part.inner) body += polyline(loop, 'CUT-INNER');
    body += text(part.label.x, part.label.y, LABEL_MM, part.label.text);
  }

  /* The caveats ride on the drawing, not only in the folder's readme. A DXF
     gets forwarded on its own — opened in CAM two weeks later by somebody who
     never saw the email — and this is a silhouette that would cut wrong if it
     were taken for a toolpath. */
  const sections = [...new Set(profiles.map((p) => p.sectionMm))].join('/');
  const notes = [
    `BEE HOME ${id} - SILHOUETTE ONLY, NOT A TOOLPATH`,
    `MILLIMETRES, 1:1. PROFILES ARE SECTIONS THROUGH THE STOREY SOLIDS AT ${sections} MM,`,
    'HALF THE BOARD THICKNESS. THE STOREYS ARE POCKETED, NOT CUT THROUGH: THESE CONTOURS',
    'ARE WHERE MATERIAL STANDS AT THAT ONE HEIGHT, AND CARRY NO POCKET DEPTHS.',
    'NO TOOL RADIUS COMPENSATION. NO DOGBONE RELIEF AT THE INSIDE CORNERS.',
    'THE OPERATOR ADDS BOTH. AUTHORITATIVE CUTTING FILES COME FROM BEEHOME.GH:',
    exportString || '(see the drawings sheet for the Grasshopper export string)',
  ];
  const noteTop = box[3] + 24;
  const noteMm = 5;
  notes.forEach((line, i) => {
    body += text(box[0], noteTop + (notes.length - 1 - i) * noteMm * 1.8, noteMm, line);
  });

  const extent = [box[0], box[1] - LABEL_BAND, box[2], noteTop + notes.length * noteMm * 1.8];

  const header = pair(0, 'SECTION') + pair(2, 'HEADER')
    + pair(9, '$ACADVER') + pair(1, 'AC1009')
    + pair(9, '$INSUNITS') + pair(70, 4)        // millimetres
    + pair(9, '$MEASUREMENT') + pair(70, 1)     // metric
    + pair(9, '$LUNITS') + pair(70, 2)          // decimal
    + pair(9, '$EXTMIN') + pair(10, num(extent[0])) + pair(20, num(extent[1])) + pair(30, '0.0')
    + pair(9, '$EXTMAX') + pair(10, num(extent[2])) + pair(20, num(extent[3])) + pair(30, '0.0')
    + pair(0, 'ENDSEC');

  // R12 readers expect a layer's linetype to be a name they can resolve, so
  // CONTINUOUS is declared rather than merely referenced.
  let tables = pair(0, 'SECTION') + pair(2, 'TABLES')
    + pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1)
    + pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0)
    + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, '0.0')
    + pair(0, 'ENDTAB')
    + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, LAYERS.length);
  for (const layer of LAYERS) {
    tables += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0)
      + pair(62, layer.colour) + pair(6, 'CONTINUOUS');
  }
  tables += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');

  const entities = pair(0, 'SECTION') + pair(2, 'ENTITIES') + body + pair(0, 'ENDSEC');

  return {
    text: `${header}${tables}${entities}${pair(0, 'EOF')}`,
    parts,
    extent,
    id,
  };
}
