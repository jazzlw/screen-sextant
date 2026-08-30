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
               zoom:null, pixelW:null, pixelH:null, lens:null, hasExif:false};
  try{
    const dv = new DataView(buf);
    const base = findTiff(dv);
    if(base < 0) return out;
    out.hasExif = true;

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

/* ---------------------------------------------------------------------------
   Diagnostics. parse() answers "what is the focal length"; these answer "what
   is actually in this file", which is the question when parse() comes back
   empty and you need to know whether the tag is missing, the Exif segment is
   missing, or the file is not a JPEG at all. Three different problems.
   --------------------------------------------------------------------------- */

const TYPE_NAME = {1:"BYTE", 2:"ASCII", 3:"SHORT", 4:"LONG", 5:"RATIONAL",
                   7:"UNDEFINED", 9:"SLONG", 10:"SRATIONAL"};

const TAG_NAME = {
  0x010E:"ImageDescription", 0x010F:"Make", 0x0110:"Model", 0x0112:"Orientation",
  0x011A:"XResolution", 0x011B:"YResolution", 0x0128:"ResolutionUnit",
  0x0131:"Software", 0x0132:"DateTime", 0x013B:"Artist", 0x0213:"YCbCrPositioning",
  0x8298:"Copyright", 0x8769:"ExifIFDPointer", 0x8825:"GPSInfoIFDPointer",
  0x829A:"ExposureTime", 0x829D:"FNumber", 0x8822:"ExposureProgram",
  0x8827:"ISOSpeedRatings", 0x9000:"ExifVersion", 0x9003:"DateTimeOriginal",
  0x9004:"DateTimeDigitized", 0x9201:"ShutterSpeedValue", 0x9202:"ApertureValue",
  0x9204:"ExposureBiasValue", 0x9205:"MaxApertureValue", 0x9207:"MeteringMode",
  0x9209:"Flash", 0x920A:"FocalLength", 0x927C:"MakerNote", 0x9286:"UserComment",
  0xA000:"FlashpixVersion", 0xA001:"ColorSpace", 0xA002:"PixelXDimension",
  0xA003:"PixelYDimension", 0xA005:"InteroperabilityIFDPointer",
  0xA402:"ExposureMode", 0xA403:"WhiteBalance", 0xA404:"DigitalZoomRatio",
  0xA405:"FocalLengthIn35mmFilm", 0xA406:"SceneCaptureType", 0xA408:"Contrast",
  0xA409:"Saturation", 0xA40A:"Sharpness", 0xA432:"LensSpecification",
  0xA433:"LensMake", 0xA434:"LensModel", 0xA435:"LensSerialNumber",
  0xA460:"CompositeImage",
};

const MARKER_NAME = {
  0xD8:"SOI", 0xD9:"EOI", 0xDA:"SOS", 0xDB:"DQT", 0xC4:"DHT", 0xDD:"DRI",
  0xC0:"SOF0 baseline", 0xC1:"SOF1", 0xC2:"SOF2 progressive", 0xC3:"SOF3",
  0xFE:"COM",
};
function markerName(m){
  if(MARKER_NAME[m]) return MARKER_NAME[m];
  if(m >= 0xE0 && m <= 0xEF) return "APP" + (m - 0xE0);
  return "0x" + m.toString(16).toUpperCase();
}

function tagName(t){
  return TAG_NAME[t] || ("0x" + t.toString(16).toUpperCase().padStart(4,"0"));
}

/* What kind of file is this really? A camera-captured image that arrives as
   HEIC rather than JPEG explains an empty parse() on its own. */
function container(buf){
  try{
    const dv = new DataView(buf);
    // Check each magic against its own length requirement -- a truncated but
    // genuine JPEG should still be named as one.
    if(dv.byteLength < 2) return "too short (" + dv.byteLength + " bytes)";
    if(dv.getUint16(0) === 0xFFD8) return "JPEG";
    if(dv.byteLength >= 4 && dv.getUint32(0) === 0x89504E47) return "PNG";
    if(dv.byteLength >= 12){
      let box = "";
      for(let i=4;i<8;i++) box += String.fromCharCode(dv.getUint8(i));
      if(box === "ftyp"){
        let brand = "";
        for(let i=8;i<12;i++) brand += String.fromCharCode(dv.getUint8(i));
        return "ISOBMFF/" + brand.trim() + " (HEIC family - no Exif parser here)";
      }
    }
    if(dv.getUint16(0) === 0x4949 || dv.getUint16(0) === 0x4D4D) return "TIFF";
    return "unrecognised";
  }catch(e){ return "unreadable"; }
}

/* Every JPEG marker segment, so a missing APP1 is visible as an absence
   rather than inferred from a null. */
function segments(buf){
  const out = [];
  try{
    const dv = new DataView(buf);
    if(dv.byteLength < 2 || dv.getUint16(0) !== 0xFFD8) return out;
    out.push({marker:"SOI", at:0, length:0, id:null});
    let p = 2;
    while(p < dv.byteLength - 1){
      if(dv.getUint8(p) !== 0xFF){ p++; continue; }
      const m = dv.getUint8(p+1);
      if(m === 0xFF){ p++; continue; }                     // fill byte
      if(m === 0x01 || (m >= 0xD0 && m <= 0xD8)){
        out.push({marker:markerName(m), at:p, length:0, id:null});
        p += 2; continue;
      }
      if(m === 0xD9){ out.push({marker:"EOI", at:p, length:0, id:null}); break; }
      if(p + 4 > dv.byteLength) break;
      const len = dv.getUint16(p+2);
      let id = null;
      if(m >= 0xE0 && m <= 0xEF){
        id = "";
        for(let i=0;i<Math.min(16, len-2);i++){
          const c = dv.getUint8(p+4+i);
          if(!c) break;
          id += (c >= 32 && c < 127) ? String.fromCharCode(c) : ".";
        }
      }
      out.push({marker:markerName(m), at:p, length:len, id:id});
      if(m === 0xDA) break;                                // image data follows
      if(len < 2) break;
      p += 2 + len;
    }
  }catch(e){}
  return out;
}

/* Every entry in every IFD, named and typed. Long binary blobs report their
   size rather than their contents. */
function ifdEntries(dv, base, ifd, le){
  const out = [];
  if(ifd + 2 > dv.byteLength) return out;
  const n = dv.getUint16(ifd, le);
  if(n > 512) return out;                                  // implausible; bail
  for(let i=0;i<n;i++){
    const e = ifd + 2 + i*12;
    if(e + 12 > dv.byteLength) break;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e+2, le);
    const count = dv.getUint32(e+4, le);
    const size = SIZE[type];
    let val;
    if(!size) val = "<unknown type " + type + ">";
    else if(size*count > 64 && type !== 2) val = "<" + (size*count) + " bytes>";
    else val = value(dv, base, e, le);
    out.push({tag, name:tagName(tag), type, typeName:TYPE_NAME[type] || ("type"+type),
              count, value: val});
  }
  return out;
}

/* Full report for the diagnostics page. Never throws. */
function dump(buf){
  const report = {container: container(buf), bytes: buf && buf.byteLength || 0,
                  segments: [], exifAt: -1, byteOrder: null, ifds: [], note: null};
  try{
    report.segments = segments(buf);
    const dv = new DataView(buf);
    const base = findTiff(dv);
    report.exifAt = base;
    if(base < 0){
      report.note = report.container === "JPEG"
        ? "JPEG with no Exif APP1 segment: the metadata was never written, or was stripped."
        : "No JPEG Exif segment to read.";
      return report;
    }
    const bo = dv.getUint16(base);
    if(bo !== 0x4949 && bo !== 0x4D4D){ report.note = "Exif segment has a bad byte order mark."; return report; }
    const le = (bo === 0x4949);
    report.byteOrder = le ? "II (little-endian)" : "MM (big-endian)";

    const ifd0 = base + dv.getUint32(base+4, le);
    report.ifds.push({name:"IFD0 (image)", entries: ifdEntries(dv, base, ifd0, le)});

    const sub = tag(dv, base, ifd0, EXIF_PTR, le);
    if(sub != null)
      report.ifds.push({name:"Exif sub-IFD", entries: ifdEntries(dv, base, base+sub, le)});
    else
      report.note = "IFD0 present but no Exif sub-IFD pointer, which is where the focal length lives.";

    const gps = tag(dv, base, ifd0, 0x8825, le);
    if(gps != null)
      report.ifds.push({name:"GPS IFD", entries: ifdEntries(dv, base, base+gps, le)});

    // IFD1 holds the thumbnail; occasionally the only place tags survive
    const next = dv.getUint32(ifd0 + 2 + dv.getUint16(ifd0, le)*12, le);
    if(next > 0 && base + next < dv.byteLength)
      report.ifds.push({name:"IFD1 (thumbnail)", entries: ifdEntries(dv, base, base+next, le)});
  }catch(e){ report.note = "Parse aborted: " + e.message; }
  return report;
}

/* Plausible 35mm-equivalent focal length for a phone or compact camera.
   Guards against a garbage tag becoming a confident wrong answer. */
function plausibleF35(v){ return typeof v === "number" && v > 5 && v < 400; }

/* Digital zoom, where the camera reports it. A spec-compliant camera updates
   FocalLengthIn35mmFilm to describe the recorded image, so zoom costs
   sharpness rather than accuracy -- verified on an iPhone 16 Pro. The spec
   writes 0 for "not used", so only values above 1 mean anything. */
function zoomed(x){ return typeof x === "number" && x > 1.01; }

/* Apparent crop factor implied by the two focal-length tags.

   Note this is the crop of the *recorded image*, not of the sensor: measured
   on an iPhone 16 Pro, the same lens reads 3.55x un-zoomed and 6.65x at 1.875x
   zoom, because f35 tracks the delivered frame while FocalLength stays
   physical. So it rises with zoom rather than being blind to it -- the
   opposite of what this comment used to claim. */
function cropFactor(x){
  if(!(x.f35 > 0) || !(x.focal > 0)) return null;
  return x.f35 / x.focal;
}

/* Stable key for caching a calibrated f35.

   The lens matters as much as the body, and this is easy to get wrong: a phone
   carries several lenses differing by up to 10x in focal length, and they can
   all produce the same pixel dimensions. Keying on make/model/resolution alone
   would apply an ultra-wide calibration to a telephoto shot and label it
   "calibrated". So the lens identity goes in the key, and the pixel count too,
   since the pixel pitch changes with capture resolution even though the lens
   does not.

   Returns null when the file identifies neither body nor lens -- there is
   nothing trustworthy to key on, and identifiable() is how callers know to
   refuse to save. */
function deviceKey(x, W, H){
  if(!identifiable(x)) return null;
  const body = [x.make, x.model].filter(Boolean).join(" ") || "unknown body";
  const lens = x.lens || (x.focal > 0 ? x.focal.toFixed(2) + "mm" : null);
  return [body, lens].filter(Boolean).join(" / ") + "@" + Math.max(W, H);
}

/* An Exif block that survived but carries nothing identifying the camera.

   iOS Safari's in-page camera capture re-encodes the photo and writes a
   minimal Exif block: orientation, resolution and pixel dimensions survive,
   while Make, Model and both focal lengths do not. A photo taken in the
   Camera app and chosen from the library is untouched, so this is worth
   naming precisely -- the fix is which button the user presses, not anything
   the page can do. */
function strippedByCapture(x){
  return !!x && x.hasExif === true &&
         !x.make && !x.model && !x.lens &&
         !(x.f35 > 0) && !(x.focal > 0);
}

/* Can this file's camera and lens be pinned down well enough to cache a
   calibration against? Needs the lens, one way or another: the body alone
   does not determine the focal length. */
function identifiable(x){
  if(!x) return false;
  const hasBody = !!(x.make || x.model);
  const hasLens = !!(x.lens || (x.focal > 0));
  return hasBody && hasLens;
}

return {parse, plausibleF35, zoomed, cropFactor, deviceKey, identifiable,
        strippedByCapture, tag, findTiff,
        dump, container, segments, tagName, markerName};
})();
