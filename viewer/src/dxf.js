/**
 * The cutting file, from the production toolpaths.
 *
 * An earlier version of this module sliced the storey meshes and called the
 * outline a cutting profile. It was wrong, and worth saying why. The meshes
 * come from the `WEBSITE - Model` layer of BEEHOME GEOMETRIES.3dm, which is a
 * de-featured display copy: every fillet and every corner relief has been
 * taken out of it. Cutting a storey from that outline with the 6 mm endmill
 * the project specifies leaves about 1.2 mm of material standing in each
 * inside corner, and Bee Home is friction-fit joinery with no screws, so the
 * storeys would not seat on each other.
 *
 * The same file already contains the finished toolpaths — 51 parts across
 * three storey variants, on layers whose names carry the operation, the
 * cutter and the depth of cut. `tools/extract_toolpaths.py` lifts them into
 * `toolpaths.json` at build time; this assembles a design's worth of them into
 * a DXF at download time. Nothing in between is redrawn: every line and arc
 * here is the one the Grasshopper definition authored, and the layer names
 * travel with it so the depths cannot be separated from the geometry.
 */

/** Which library part each storey of a design needs. */
const LABEL_MM = 7;      // part label cap height
const NOTE_MM = 5;       // note block cap height
const LABEL_BAND = 13;   // room reserved under each row for the label

const VARIANT_WORD = { 0: 'default', 1: 'fixed', 2: 'roof' };

// The roof slab's thickness, measured off the display model. See buildDxf.
const ROOF_MM = 22;

/**
 * The part keys for a design, read off the export string.
 *
 * `exportString()` in design.js already decides which variant every storey
 * takes — `2` for the topmost, `1` for the one under it when the base is
 * fixed, `0` otherwise — because that is the string the original site handed
 * to Grasshopper. Those digits are exactly the library's three columns, so the
 * DXF asks the same question the same way rather than working it out a second
 * time and risking a different answer.
 *
 * The leading token names the mounting, not a part, and is dropped. The base
 * plate itself is not included: the library holds one under each storey
 * variant, and nothing in the file says which of those three belongs to which
 * of the three mountings.
 */
export function partKeys(exportString) {
  return String(exportString).split(',').slice(1).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const rad = (deg) => (deg * Math.PI) / 180;

/** Where an arc starts and ends, counter-clockwise from `a0` to `a1`. */
function arcEnds([, cx, cy, r, a0, a1]) {
  return [
    [cx + r * Math.cos(rad(a0)), cy + r * Math.sin(rad(a0))],
    [cx + r * Math.cos(rad(a1)), cy + r * Math.sin(rad(a1))],
  ];
}

/**
 * An arc's true extent, not its endpoints'.
 *
 * A quarter turn that crosses due north reaches further up than either end of
 * it does, so the cardinal points inside the sweep have to be tested too.
 * Getting this wrong would not show as a broken drawing — it would show as two
 * parts laid out close enough to overlap.
 */
function growByArc(box, seg) {
  const [, cx, cy, r, a0, a1] = seg;
  for (const [x, y] of arcEnds(seg)) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  const sweep = ((a1 - a0) % 360 + 360) % 360;
  for (const [k, dx, dy] of [[0, 1, 0], [90, 0, 1], [180, -1, 0], [270, 0, -1]]) {
    if (((k - a0) % 360 + 360) % 360 > sweep) continue;
    box[0] = Math.min(box[0], cx + r * dx); box[1] = Math.min(box[1], cy + r * dy);
    box[2] = Math.max(box[2], cx + r * dx); box[3] = Math.max(box[3], cy + r * dy);
  }
}

/** The box a part actually occupies, toolpath overruns included. */
export function partExtent(part) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const op of part.ops) {
    for (const seg of op.segs) {
      if (seg[0] === 'L') {
        for (const [x, y] of [[seg[1], seg[2]], [seg[3], seg[4]]]) {
          box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
          box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
        }
      } else {
        growByArc(box, seg);
      }
    }
  }
  return box;
}

/**
 * Shelf packing: parts left to right in build order, wrapping when the row
 * runs out.
 *
 * Not nesting. Nesting is a question about somebody's stock, their offcuts and
 * their hold-down, and answering it here would be inventing all three.
 *
 * Spacing is measured on the real extent rather than the 120 x 160 footprint,
 * because the pocket paths that break out through an edge run up to 7 mm past
 * it. Packed to the footprint, two neighbouring storeys' toolpaths would
 * overlap on the sheet while the outlines still looked clear.
 */
export function layout(parts, { gapMm = 20, rowMm = 1200 } = {}) {
  const placed = [];
  let x = 0;
  let rowY = 0;
  let rowTop = 0;
  for (const part of parts) {
    const [minX, minY, maxX, maxY] = partExtent(part);
    const width = maxX - minX;
    if (x > 0 && x + width > rowMm) {
      rowY = rowTop + LABEL_BAND + gapMm;
      rowTop = rowY;
      x = 0;
    }
    placed.push({ ...part, dx: x - minX, dy: rowY - minY, labelY: rowY - LABEL_BAND + 3 });
    x += width + gapMm;
    rowTop = Math.max(rowTop, rowY + (maxY - minY));
  }
  return placed;
}

/* ------------------------------------------------------------------ */
/* DXF R12                                                             */
/* ------------------------------------------------------------------ */

/**
 * R12 — the flavour every CAM package, every old post and every free viewer
 * opens without argument. LWPOLYLINE does not exist in it, and neither does
 * anything else that would let a run of lines and arcs travel as one entity,
 * so each segment is its own LINE or ARC. That is also the honest shape for
 * this data: the source is a chain of native lines and arcs, and writing them
 * out one for one means no arc is ever flattened to chords.
 */
const pair = (code, value) => `${code}\n${value}\n`;
const num = (v) => (Math.abs(v) < 1e-9 ? '0.0' : v.toFixed(6));

function line(seg, layer, dx, dy) {
  return pair(0, 'LINE') + pair(8, layer)
    + pair(10, num(seg[1] + dx)) + pair(20, num(seg[2] + dy)) + pair(30, '0.0')
    + pair(11, num(seg[3] + dx)) + pair(21, num(seg[4] + dy)) + pair(31, '0.0');
}

/** DXF arcs always run counter-clockwise, which is how they are extracted. */
function arc(seg, layer, dx, dy) {
  return pair(0, 'ARC') + pair(8, layer)
    + pair(10, num(seg[1] + dx)) + pair(20, num(seg[2] + dy)) + pair(30, '0.0')
    + pair(40, num(seg[3]))
    + pair(50, num(seg[4])) + pair(51, num(seg[5]));
}

/** R12 TEXT holds one line, in one codepage. Anything else is dropped. */
function text(x, y, height, body) {
  return pair(0, 'TEXT') + pair(8, 'LABEL')
    + pair(10, num(x)) + pair(20, num(y)) + pair(30, '0.0')
    + pair(40, num(height))
    + pair(1, String(body).replace(/[^\x20-\x7e]/g, ''));
}

/** Layer colours by operation, so the two jobs read apart on screen. */
function layerColour(name) {
  if (name === 'LABEL') return 3;
  return name.startsWith('CUT-') ? 7 : 6;
}

/**
 * Build the DXF for one design.
 *
 * @param {object} library parsed toolpaths.json
 * @param {{id?: string, exportString: string, gapMm?: number, rowMm?: number}} options
 * @returns {{text: string, parts: Array<object>, extent: number[], missing: string[]}}
 */
export function buildDxf(library, {
  id = '', exportString = '', gapMm = 20, rowMm = 1200,
} = {}) {
  const keys = partKeys(exportString);
  const missing = keys.filter((k) => !library.parts[k]);
  const wanted = keys
    .map((key, i) => {
      const part = library.parts[key];
      if (!part) return null;
      return {
        ...part,
        key,
        order: i + 1,
        label: `${String(i + 1).padStart(2, '0')} ${part.letter}`
          + ` ${VARIANT_WORD[part.variant] || part.variant}`
          + ` ${part.size_mm[0]}x${part.size_mm[1]}x${part.size_mm[2]}`,
      };
    })
    .filter(Boolean);

  /* The roof, derived rather than authored.
     
     There is no roof slab in the toolpath library -- nothing in it is thinner
     than 30mm -- and the display mesh is a plain box, 36 vertices and no
     features. That box is not evidence the real part is featureless: the base
     plate's display mesh is a plain box too, while the production base plate
     has a through-pocket and two sockets in it. So the display model tells us
     the roof's size and nothing about its face.
     
     What is solid is the footprint. The roof and the base plate are both
     140 x 160 while every storey is 120 wide, so the cap and the foot share an
     outline, and the base plate's outline is production geometry. Cutting the
     roof from it is better than leaving a maker to draw a rectangle by eye. The
     thickness comes off the display model, which is why the label says so. */
  const basePlate = library.parts.BASE0;
  if (basePlate && wanted.length) {
    const profile = basePlate.ops.find((op) => op.op === 'CUT-OUTSIDE');
    if (profile) {
      wanted.push({
        letter: 'ROOF',
        variant: 'derived',
        size_mm: [basePlate.size_mm[0], basePlate.size_mm[1], ROOF_MM],
        ops: [{ ...profile, layer: `CUT-OUTSIDE_T6MM_${ROOF_MM.toFixed(2)}MM`,
          depth_mm: ROOF_MM }],
        key: 'ROOF',
        order: wanted.length + 1,
        label: `${String(wanted.length + 1).padStart(2, '0')} ROOF SLAB`
          + ` ${basePlate.size_mm[0]}x${basePlate.size_mm[1]}x${ROOF_MM}`
          + ' - OUTLINE FROM BASE PLATE, THICKNESS NOMINAL',
      });
    }
  }

  const placed = layout(wanted, { gapMm, rowMm });

  let body = '';
  const used = new Set(['LABEL']);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of placed) {
    const [x0, y0, x1, y1] = partExtent(part);
    box[0] = Math.min(box[0], x0 + part.dx); box[1] = Math.min(box[1], y0 + part.dy);
    box[2] = Math.max(box[2], x1 + part.dx); box[3] = Math.max(box[3], y1 + part.dy);
    for (const op of part.ops) {
      used.add(op.layer);
      for (const seg of op.segs) {
        body += seg[0] === 'L' ? line(seg, op.layer, part.dx, part.dy)
          : arc(seg, op.layer, part.dx, part.dy);
      }
    }
    body += text(part.dx + x0, part.labelY, LABEL_MM, part.label);
  }
  if (!placed.length) { box[0] = box[1] = box[2] = box[3] = 0; }

  /* The caveats ride on the drawing, not only in the folder's readme. A DXF
     gets forwarded on its own and opened in CAM weeks later by somebody who
     never saw the email it arrived in. */
  const tools = [...new Set(placed.flatMap((p) => p.ops.map((o) => o.tool_mm)))].sort();
  const notes = [
    `BEE HOME ${id} - ${placed.length} PARTS, MILLIMETRES, 1:1`,
    'PRODUCTION TOOLPATHS AS AUTHORED IN BEEHOME GEOMETRIES.3DM. GEOMETRY IS COPIED,',
    'NOT REDRAWN: NATIVE LINES AND ARCS, NO FLATTENING, CORNER RELIEF AS CUT.',
    'LAYER NAMES CARRY THE OPERATION, THE CUTTER AND THE DEPTH OF CUT, E.G.',
    'POCKET-INSIDE_T6MM_20.00MM = INSIDE POCKET, ' + tools.map((t) => `${t}MM`).join('/')
      + ' CUTTER, 20MM DEEP.',
    'EVERYTHING IS DRAWN AT Z=0; DEPTH LIVES IN THE LAYER NAME ONLY.',
    'POCKET CURVES ARE FINISHED WALLS, NOT TOOL CENTRELINES: A 6.00MM POCKET CUT',
    'WITH A 6MM CUTTER IS ONE PASS AND THE OUTSIDE PROFILES MATCH THE FOOTPRINTS.',
    'WHICH FACE EACH DEPTH IS MEASURED FROM IS NOT RECORDED. CUT EVERY PART THE',
    'SAME WAY UP, IN ONE SETUP, AND CHECK ONE STOREY BEFORE COMMITTING TO A SET.',
    'NO LEAD-INS, NO TABS, NO FEEDS AND SPEEDS. THE STOREYS ARE AS AUTHORED. THE',
    'ROOF SLAB IS DERIVED - ITS OUTLINE IS THE BASE PLATE\'S, ITS THICKNESS IS OFF',
    'THE DISPLAY MODEL. THE BASE PLATE, LEGS AND SPIKE ARE NOT INCLUDED: THEY ARE',
    'STOCK, AND THE CUT LIST CARRIES THEIR SIZES.',
    'THE FULL SOURCE IS BEEHOME.GH WITH THE EXPORT STRING:',
    exportString || '(see the drawings sheet)',
  ];
  const noteTop = box[3] + 24;
  notes.forEach((body_, i) => {
    body += text(box[0], noteTop + (notes.length - 1 - i) * NOTE_MM * 1.8, NOTE_MM, body_);
  });

  const extent = [box[0], box[1] - LABEL_BAND, box[2], noteTop + notes.length * NOTE_MM * 1.8];

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
  const layers = [...used].sort();
  let tables = pair(0, 'SECTION') + pair(2, 'TABLES')
    + pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1)
    + pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0)
    + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, '0.0')
    + pair(0, 'ENDTAB')
    + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const name of layers) {
    tables += pair(0, 'LAYER') + pair(2, name) + pair(70, 0)
      + pair(62, layerColour(name)) + pair(6, 'CONTINUOUS');
  }
  tables += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');

  const entities = pair(0, 'SECTION') + pair(2, 'ENTITIES') + body + pair(0, 'ENDSEC');

  return {
    text: `${header}${tables}${entities}${pair(0, 'EOF')}`,
    parts: placed,
    layers,
    extent,
    missing,
  };
}
