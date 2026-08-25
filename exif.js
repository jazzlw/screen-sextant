/* EXIF reader: JPEG APP1 -> TIFF header -> IFD0 -> Exif sub-IFD.
   Pure (ArrayBuffer in, plain object out) so tests.js can exercise it against
   synthesized headers in both endiannesses.

   JPEG only. HEIC still displays -- WebKit delegates to the system HEVC
   decoder -- but its metadata lives in an ISOBMFF box structure this does not
   parse, so the focal length has to be typed in by hand. Naming a concrete
   type in the file input's accept attribute makes iOS transcode to JPEG on
   the way in, which is why index.html asks for image/jpeg. */
window.SA_EXIF = (function(){
"use strict";

/* bytes per component, indexed by TIFF type code */
const SIZE = {1:1, 2:1, 3:2, 4:4, 5:8, 7:1, 9:4, 10:8};

const IFD0 = {
  make:        0x010F,   // ASCII
  model:       0x0110,   // ASCII
  orientation: 0x0112,   // SHORT
};
const SUB = {
  focal:  0x920A,        // RATIONAL, mm
  f35:    0xA405,        // SHORT, mm (35mm equivalent)
  zoom:   0xA404,        // RATIONAL; 0 means "digital zoom not used"
  pixelW: 0xA002,        // SHORT or LONG
  pixelH: 0xA003,
  lens:   0xA434,        // ASCII
};
const EXIF_PTR = 0x8769;

/* Read one IFD entry's value. Values of 4 bytes or fewer are inline in the
   entry; anything larger is at an offset relative to the TIFF header. */
function value(dv, base, e, le){
  const type = dv.getUint16(e+2, le);
  const count = dv.getUint32(e+4, le);
  const size = SIZE[type];
  if(!size || !count) return null;
  const bytes = size*count;
  const at = bytes <= 4 ? e+8 : base + dv.getUint32(e+8, le);
  if(at < 0 || at + bytes > dv.byteLength) return null;

  switch(type){
    case 1: case 7: return dv.getUint8(at);
    case 3:  return dv.getUint16(at, le);
    case 4:  return dv.getUint32(at, le);
    case 9:  return dv.getInt32(at, le);
    case 5: case 10: {
      const num = type === 5 ? dv.getUint32(at, le)   : dv.getInt32(at, le);
      const den = type === 5 ? dv.getUint32(at+4, le) : dv.getInt32(at+4, le);
      return den ? num/den : null;
    }
    case 2: {
      let s = "";
      for(let i=0;i<bytes;i++){
        const c = dv.getUint8(at+i);
        if(!c) break;
        s += String.fromCharCode(c);
      }
      s = s.trim();
      return s || null;
    }
  }
  return null;
}

/* Value of one tag in one IFD, or null. */
function tag(dv, base, ifd, want, le){
  if(ifd + 2 > dv.byteLength) return null;
  const n = dv.getUint16(ifd, le);
  for(let i=0;i<n;i++){
    const e = ifd + 2 + i*12;
    if(e + 12 > dv.byteLength) return null;
    if(dv.getUint16(e, le) === want) return value(dv, base, e, le);
  }
  return null;
}

/* Offset of the TIFF header inside a JPEG, or -1. */
function findTiff(dv){
  if(dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return -1;
  let p = 2;
  while(p < dv.byteLength - 4){
    if(dv.getUint8(p) !== 0xFF){ p++; continue; }
    const m = dv.getUint8(p+1);
    if(m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)){ p += 2; continue; }
    if(m === 0xDA || m === 0xD9) break;          // start of scan / end of image
    const len = dv.getUint16(p+2);
    if(len < 2) break;
    if(m === 0xE1 && p + 10 <= dv.byteLength){   // APP1; may be XMP instead
      let id = "";
      for(let i=0;i<4;i++) id += String.fromCharCode(dv.getUint8(p+4+i));
      if(id === "Exif") return p + 10;
    }
    p += 2 + len;
  }
  return -1;
}

/* Every field we care about, with null for anything absent or unparseable.
   Never throws -- a malformed header should degrade to manual entry, not
   break the load. */
function parse(buf){
  const out = {make:null, model:null, orientation:null, focal:null, f35:null,
               zoom:null, pixelW:null, pixelH:null, lens:null};
  try{
    const dv = new DataView(buf);
    const base = findTiff(dv);
    if(base < 0) return out;

    const bo = dv.getUint16(base);
    if(bo !== 0x4949 && bo !== 0x4D4D) return out;
    const le = (bo === 0x4949);
    const ifd0 = base + dv.getUint32(base+4, le);

    for(const k in IFD0) out[k] = tag(dv, base, ifd0, IFD0[k], le);

    const ptr = tag(dv, base, ifd0, EXIF_PTR, le);
    if(ptr != null){
      for(const k in SUB) out[k] = tag(dv, base, base + ptr, SUB[k], le);
    }
  }catch(e){ /* fall through to nulls */ }
  return out;
}

/* Plausible 35mm-equivalent focal length for a phone or compact camera.
   Guards against a garbage tag becoming a confident wrong answer. */
function plausibleF35(v){ return typeof v === "number" && v > 5 && v < 400; }

/* Digital zoom is the worst entry in the error budget -- a silent crop scales
   the reading by the crop factor with nothing in the image to reveal it. The
   spec writes 0 for "not used", so only values above 1 are a real warning. */
function zoomed(x){ return typeof x === "number" && x > 1.01; }

/* Sensor crop factor implied by the two focal-length tags. Diagnostic only:
   a digital crop leaves both tags untouched, so this does not detect zoom. */
function cropFactor(x){
  if(!(x.f35 > 0) || !(x.focal > 0)) return null;
  return x.f35 / x.focal;
}

/* Stable key for caching a calibrated f35: the lens is fixed per model, but
   the pixel pitch changes with capture resolution, so both matter. */
function deviceKey(x, W, H){
  const id = [x.make, x.model].filter(Boolean).join(" ") || "unknown";
  return id + "@" + Math.max(W, H);
}

return {parse, plausibleF35, zoomed, cropFactor, deviceKey, tag, findTiff};
})();
