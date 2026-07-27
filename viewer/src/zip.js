/**
 * A zip writer, because the build pack is more than one file.
 *
 * The original site did exactly this — JSZip in the browser, three files in,
 * one blob out. This is the same shape without the dependency: zip is a simple
 * container, and the only fiddly part is CRC-32, which is a table and a loop.
 *
 * Entries are deflated through CompressionStream where the browser has it and
 * stored uncompressed where it does not. Both are legal zip; every extractor
 * reads either. The drawings are PNG and the guide is a PDF, so both are
 * already compressed and gain nothing — the sheet is HTML and gains a lot.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Everything zip stores about a name has to be bytes, not characters. */
const utf8 = (s) => new TextEncoder().encode(s);

/**
 * @param {Array<{name: string, data: Uint8Array|string}>} files
 * @returns {Promise<Blob>}
 */
export async function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = utf8(file.name);
    const raw = typeof file.data === 'string' ? utf8(file.data) : file.data;
    const crc = crc32(raw);

    // Only worth trying on things that are not already compressed.
    const packable = !/\.(png|jpe?g|webp|pdf|zip|glb|woff2?)$/i.test(file.name);
    const packed = packable ? await deflateRaw(raw) : null;
    const useDeflate = packed && packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // flag: name is UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true);           // time — fixed, see below
    local.setUint16(12, 0x2821, true);      // date — 2020-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, body);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory header
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, method, true);
    dir.setUint16(12, 0, true);
    dir.setUint16(14, 0x2821, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);

    offset += 30 + name.length + body.length;
  }

  const centralSize = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: 'application/zip' });
}
