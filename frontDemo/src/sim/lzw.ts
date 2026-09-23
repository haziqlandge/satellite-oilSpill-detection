/**
 * TIFF LZW, with a dictionary big enough for 12-bit codes.
 *
 * geotiff.js 3.0.5 sizes its LZW dictionary at 4,093 entries, but a 12-bit code
 * can name entries up to 4,095. On a tile whose dictionary grows past 4,092
 * the extra entries are written into typed arrays too short to hold them, the
 * writes vanish, and the next lookup follows an `undefined` link: the walk
 * `for (i = n; i !== 4096; i = dictionaryIndex[i])` never terminates, and the
 * array it builds dies with "Invalid array length". A sizeable share of the
 * Part I corpus hits this -- 4 of 24 validation scenes, 3 of 8 train scenes
 * sampled -- and the upload panel refused every one of them as unreadable.
 * libtiff reads them all (`ISSUES.md` F16).
 *
 * This is the same decoder with the dictionary sized to 4,096. Measured on
 * scenes 00284 and 00059, every pixel of both bands then matches rasterio's
 * libtiff decode exactly. It replaces the built-in LZW decoder through
 * geotiff.js's own `addDecoder` registry rather than by patching the package.
 */

const MIN_BITS = 9;
const MAX_BITS = 12;
const CLEAR_CODE = 256;
const EOI_CODE = 257;
/** Every code a 12-bit stream can carry, plus the root sentinel. */
const DICTIONARY_SIZE = 1 << MAX_BITS;
const ROOT = DICTIONARY_SIZE;

/** `length` bits starting at bit `position`, most significant first. */
function readCode(array: Uint8Array, position: number, length: number): number {
  const byte = position >>> 3;
  if (byte >= array.length) return EOI_CODE; // ran off the end without an EOI
  const shift = position & 7;
  // Three bytes always cover a 12-bit code at any bit offset.
  const window =
    (array[byte] << 16) |
    ((byte + 1 < array.length ? array[byte + 1] : 0) << 8) |
    (byte + 2 < array.length ? array[byte + 2] : 0);
  return (window >>> (24 - shift - length)) & ((1 << length) - 1);
}

export function decompressLzw(input: ArrayBufferLike): Uint8Array {
  const array = new Uint8Array(input);
  const prefix = new Uint16Array(DICTIONARY_SIZE);
  const suffix = new Uint8Array(DICTIONARY_SIZE);
  for (let i = 0; i <= EOI_CODE; i++) {
    prefix[i] = ROOT;
    suffix[i] = i;
  }
  let length = EOI_CODE + 1;
  let bits = MIN_BITS;
  let position = 0;
  const out: number[] = [];
  const scratch: number[] = [];

  /** Append entry `code`'s bytes; return its first byte. */
  const emit = (code: number): number => {
    scratch.length = 0;
    for (let i = code; i !== ROOT; i = prefix[i]) scratch.push(suffix[i]);
    for (let i = scratch.length - 1; i >= 0; i--) out.push(scratch[i]);
    return scratch[scratch.length - 1];
  };
  const next = () => {
    const code = readCode(array, position, bits);
    position += bits;
    return code;
  };

  let old: number | undefined;
  let code = next();
  while (code !== EOI_CODE) {
    if (code === CLEAR_CODE) {
      length = EOI_CODE + 1;
      bits = MIN_BITS;
      do code = next(); while (code === CLEAR_CODE);
      if (code === EOI_CODE) break;
      if (code > CLEAR_CODE) throw new Error(`corrupted LZW code ${code} after a clear`);
      emit(code);
      old = code;
    } else if (code < length) {
      const first = emit(code);
      if (old !== undefined && length < DICTIONARY_SIZE) {
        prefix[length] = old;
        suffix[length] = first;
        length++;
      }
      old = code;
    } else {
      // The KwKwK case: the code being defined right now.
      if (old === undefined) throw new Error(`LZW code ${code} with no previous code`);
      const first = emit(old);
      out.push(first);
      if (length < DICTIONARY_SIZE) {
        prefix[length] = old;
        suffix[length] = first;
        length++;
      }
      old = code;
    }
    // TIFF's "early change": the width grows one code before it is needed.
    if (length + 1 >= 1 << bits) {
      if (bits === MAX_BITS) old = undefined;
      else bits++;
    }
    code = next();
  }
  return new Uint8Array(out);
}

interface GeoTiffModule {
  addDecoder: (cases: number, importFn: () => Promise<never>, parameters?: undefined, preferWorker?: boolean) => void;
  BaseDecoder: new (...args: never[]) => { decodeBlock(buffer: ArrayBufferLike): ArrayBufferLike | Promise<ArrayBufferLike> };
}

const registered = new WeakSet<object>();

/**
 * Put this decoder in place of geotiff.js's LZW (compression 5).
 *
 * Takes the loaded module rather than importing it, because the console loads
 * geotiff lazily and the registry belongs to that one instance.
 */
export function useFixedLzw(geotiff: unknown): void {
  const mod = geotiff as GeoTiffModule;
  if (registered.has(mod)) return;
  class FixedLzwDecoder extends mod.BaseDecoder {
    decodeBlock(buffer: ArrayBufferLike): ArrayBufferLike {
      return decompressLzw(buffer).buffer;
    }
  }
  mod.addDecoder(5, async () => FixedLzwDecoder as never, undefined, false);
  registered.add(mod);
}
