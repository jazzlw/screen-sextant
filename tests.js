/* Assertions over the pure geometry in geom.js.
   Runs in a browser via tests.html, or headlessly:

     /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
       -e 'var window={};' geom.js tests.js

   Method under test: synthesize a screen of known size at a known distance,
   project it through a known focal length, and check the tool recovers the
   inputs. Anything that only agrees by coincidence fails. */
var SA_TESTS = (function(){
"use strict";
const results = [];
const P = 1e-9;

function t(name, fn){
  try{
    const detail = fn();
    results.push({name, state:"pass", detail: detail||""});
  }catch(e){
    results.push({name, state:"fail", detail: e.message});
  }
}
/* A limitation we have measured and not yet fixed. Reported, never green. */
function known(name, fn){
  let detail=""; try{ detail=fn()||""; }catch(e){ detail="threw: "+e.message; }
  results.push({name, state:"known", detail});
}
function ok(cond,msg){ if(!cond) throw new Error(msg||"assertion failed"); }
function near(a,b,tol,msg){
  if(!(Math.abs(a-b)<=tol)) throw new Error((msg||"")+" expected "+b+", got "+a+" (tol "+tol+")");
  return true;
}
const fmt = n => Math.round(n*1000)/1000;

/* ---- a reference setup: iPhone main camera, 45ft scope screen at 96ft ---- */
const W=4032, H=3024, F35=26;
const F = W*F35/36;                       // 2912 px
const SCREEN_W=45, SCREEN_H=45/2.39, D=96;

/* project a point on a fronto-parallel plane at distance D to a pixel */
function px(X,Y){ return {x: W/2 + X*F/D, y: H/2 + Y*F/D}; }
/* the reference box, optionally translated in the frame by (dx,dy) px */
function refBox(dx,dy){
  const a=px(-SCREEN_W/2,-SCREEN_H/2), b=px(SCREEN_W/2,SCREEN_H/2);
  return {x1:a.x+(dx||0), y1:a.y+(dy||0), x2:b.x+(dx||0), y2:b.y+(dy||0)};
}
const TRUTH_H = 2*Math.atan(SCREEN_W/(2*D))*180/Math.PI;   // 26.375 deg

/* ------------------------------- focal length ----------------------------- */
t("fpx matches max(W,H)*f35/36", () =>
  near(SA.fpx(4032,3024,26), 4032*26/36, P) && "2912 px");

t("fpx is orientation-agnostic", () => {
  near(SA.fpx(4032,3024,26), SA.fpx(3024,4032,26), P);
  return "portrait == landscape";
});

/* --------------------------- round trip: the core ------------------------- */
t("head-on subtense recovers the synthesized screen", () => {
  const m = SA.measure(refBox(0,0), W, H, F35);
  near(m.h, TRUTH_H, 1e-6, "horizontal");
  return fmt(m.h)+" deg (truth "+fmt(TRUTH_H)+")";
});

t("distance() recovers the synthesized throw", () => {
  const box = refBox(0,0);
  const m = SA.measure(box, W, H, F35);
  const d = SA.distance(SCREEN_W, box.x2-box.x1, m.f);
  near(d, D, 1e-9, "distance");
  return fmt(d)+" ft (truth "+D+")";
});

t("distance() is exact for an off-center box", () => {
  const box = refBox(600,220);
  const m = SA.measure(box, W, H, F35);
  near(SA.distance(SCREEN_W, box.x2-box.x1, m.f), D, 1e-9);
  return "unaffected by framing";
});

t("the half-angle distance formula overreads off-center", () => {
  // What the tool used to do: D = (W/2)/tan(theta_seen/2).
  const box = refBox(600,0);
  const m = SA.measure(box, W, H, F35);
  const bad = (SCREEN_W/2)/Math.tan(m.seenH*Math.PI/360);
  const err = (bad/D-1)*100;
  ok(err > 3, "expected the old formula to overread by >3%, got "+fmt(err)+"%");
  return "+"+fmt(err)+"% at 600px off axis (exact formula: 0%)";
});

/* ------------------------ head-on vs as-seen ------------------------------ */
t("head-on subtense is invariant under translation in frame", () => {
  const a = SA.measure(refBox(0,0), W, H, F35);
  for(const [dx,dy] of [[300,0],[900,0],[0,400],[700,300]]){
    near(SA.measure(refBox(dx,dy), W, H, F35).h, a.h, 1e-9, "dx="+dx+" dy="+dy);
  }
  return "same number wherever the screen sits in the photo";
});

t("as-seen subtense shrinks off-axis and never exceeds head-on", () => {
  let prev = Infinity, note = [];
  for(const dx of [0,300,600,900,1200]){
    const m = SA.measure(refBox(dx,0), W, H, F35);
    ok(m.seenH <= m.h + P, "as-seen exceeded head-on at dx="+dx);
    ok(m.seenH < prev + P, "not monotonic at dx="+dx);
    prev = m.seenH;
    note.push(fmt(m.off)+"deg:"+fmt(m.seenH));
  }
  return note.join("  ");
});

t("as-seen equals the differenced arctangents on the box midline", () => {
  const box = refBox(600,0);            // vertically centered
  const m = SA.measure(box, W, H, F35);
  const diff = (Math.atan((box.x2-W/2)/m.f)-Math.atan((box.x1-W/2)/m.f))*180/Math.PI;
  near(m.seenH, diff, 1e-9);
  return fmt(diff)+" deg";
});

t("as-seen and head-on agree when the screen is centered", () => {
  const m = SA.measure(refBox(0,0), W, H, F35);
  near(m.seenH, m.h, 1e-9, "horizontal");
  near(m.seenV, m.v, 1e-9, "vertical");
  return "no divergence to report when aimed at screen center";
});

/* -------------------- the mistake the model exists to avoid --------------- */
t("naive degrees-per-pixel scaling inflates, worse as the box grows", () => {
  // The shortcut: take the angular rate at the optical axis, 1/f rad per pixel,
  // and multiply by the pixel width. Since w/f > 2*atan(w/2f), this always
  // overreads, and the gap widens as the box fills more of the frame.
  const f = SA.fpx(W,H,F35), out = [];
  let prev = 0;
  for(const w of [1365, 2000, 3000, 3800]){
    const box = {x1:W/2-w/2, y1:1000, x2:W/2+w/2, y2:1500};
    const truth = SA.measure(box, W, H, F35).h;
    const naive = SA.deg(w/f);
    const err = (naive/truth-1)*100;
    ok(naive > truth, "expected overread at w="+w);
    ok(err > prev, "expected the error to grow at w="+w);
    prev = err;
    out.push(Math.round(w/W*100)+"% of frame: +"+fmt(err)+"%");
  }
  return out.join("   ");
});

/* -------------------------------- geometry -------------------------------- */
t("angleBetween handles the standard cases", () => {
  near(SA.deg(SA.angleBetween([1,0,0],[0,1,0])), 90, P, "orthogonal");
  near(SA.deg(SA.angleBetween([1,2,3],[1,2,3])), 0, 1e-6, "identical");
  near(SA.deg(SA.angleBetween([-1,0,0],[1,0,0])), 180, 1e-6, "opposed");
  near(SA.angleBetween([0,0,0],[1,0,0]), 0, P, "degenerate");
  return "no NaN from acos domain overshoot";
});

t("diagonal equals the true angle between corner rays when centered", () => {
  const box = refBox(0,0);
  const m = SA.measure(box, W, H, F35);
  const a = SA.ray(box.x1,box.y1,W,H,m.f), b = SA.ray(box.x2,box.y2,W,H,m.f);
  near(m.d, SA.deg(SA.angleBetween(a,b)), 1e-9);
  return fmt(m.d)+" deg";
});

t("diagonal exceeds horizontal, horizontal exceeds vertical", () => {
  const m = SA.measure(refBox(0,0), W, H, F35);
  ok(m.d > m.h && m.h > m.v, "ordering violated: "+[m.d,m.h,m.v]);
  return fmt(m.d)+" > "+fmt(m.h)+" > "+fmt(m.v);
});

t("distance scales linearly, so it is unit-agnostic", () => {
  const box = refBox(0,0), m = SA.measure(box, W, H, F35);
  const ft = SA.distance(SCREEN_W, box.x2-box.x1, m.f);
  const m_ = SA.distance(SCREEN_W*0.3048, box.x2-box.x1, m.f);
  near(m_/ft, 0.3048, 1e-12);
  return fmt(ft)+" ft == "+fmt(m_)+" m";
});

t("distance rejects a degenerate box", () =>
  ok(Number.isNaN(SA.distance(45,0,2912)), "expected NaN") || "NaN, not Infinity");

/* ------------------------------ aspect ratio ------------------------------ */
t("aspect ratio comes back as the pixel ratio", () => {
  const m = SA.measure(refBox(0,0), W, H, F35);
  near(m.ar, 2.39, 1e-9);
  return "2.39:1 in, 2.39:1 out";
});

t("nearestAR snaps within 5% and abstains outside it", () => {
  ok(SA.nearestAR(2.40)==="2.39 Scope", "2.40 should snap to scope");
  ok(SA.nearestAR(1.777)==="1.78 HD", "1.777 should snap to HD");
  ok(SA.nearestAR(1.85)==="1.85 Flat", "1.85 should snap to flat");
  ok(SA.nearestAR(2.15)===null, "2.15 is 7.5% from 2.00, should abstain");
  ok(SA.nearestAR(9)===null, "9:1 should abstain");
  return "abstains rather than guessing";
});

/* --------------------------- rotated rect fitting ------------------------- */
/* Sample the outline of a rectangle rolled by `phi`, the way detect() sees a
   connected component's boundary. */
function rolledOutline(cx,cy,w,h,phi,n){
  n = n||60;
  const c=Math.cos(phi), s=Math.sin(phi), pts=[];
  const at=(u,v)=>pts.push([cx+u*c-v*s, cy+u*s+v*c]);
  for(let i=0;i<=n;i++){
    const f=i/n, u=-w/2+w*f, v=-h/2+h*f;
    at(u,-h/2); at(u,h/2); at(-w/2,v); at(w/2,v);
  }
  return pts;
}

t("convexHull keeps the extreme points and drops interior ones", () => {
  const pts = [[0,0],[10,0],[10,10],[0,10],[5,5],[3,7],[8,2]];
  const hull = SA.convexHull(pts);
  ok(hull.length===4, "expected 4 hull points, got "+hull.length+": "+JSON.stringify(hull));
  for(const corner of [[0,0],[10,0],[10,10],[0,10]])
    ok(hull.some(p=>p[0]===corner[0]&&p[1]===corner[1]), "missing corner "+corner);
  return "4 corners kept, 3 interior points dropped";
});

t("convexHull survives degenerate inputs", () => {
  ok(SA.convexHull([]).length===0, "empty");
  ok(SA.convexHull([[1,1]]).length===1, "single point");
  ok(SA.convexHull([[1,1],[2,2]]).length===2, "two points");
  const collinear = SA.convexHull([[0,0],[1,1],[2,2],[3,3]]);
  ok(collinear.length>=1 && collinear.length<=4, "collinear gave "+collinear.length);
  return "no crash, no empty hull from non-empty input";
});

t("minAreaRect recovers a rolled rectangle's true size and angle", () => {
  const out=[];
  for(const phi of [0,1,2,3,5,12,-7]){
    const p = phi*Math.PI/180;
    const r = SA.minAreaRect(rolledOutline(500,400,239,100,p));
    near(r.w, 239, 0.6, "width at "+phi+"deg");
    near(r.h, 100, 0.6, "height at "+phi+"deg");
    near(SA.deg(r.t), phi, 0.35, "angle at "+phi+"deg");
    near(r.cx, 500, 0.6, "cx at "+phi+"deg");
    near(r.cy, 400, 0.6, "cy at "+phi+"deg");
    out.push(phi+"->"+fmt(SA.deg(r.t)));
  }
  return "recovered angles: "+out.join(" ");
});

t("minAreaRect beats the bounding box exactly where the old code failed", () => {
  // 2 degrees of roll: the axis-aligned bbox reads 8.3% tall and 2.24:1.
  const p = 2*Math.PI/180;
  const pts = rolledOutline(500,400,239,100,p);
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const q of pts){ x1=Math.min(x1,q[0]); y1=Math.min(y1,q[1]);
                       x2=Math.max(x2,q[0]); y2=Math.max(y2,q[1]); }
  const bboxAR = (x2-x1)/(y2-y1);
  const fit = SA.minAreaRect(pts);
  ok(Math.abs(bboxAR-2.39) > 0.1, "bbox should be badly wrong, got "+fmt(bboxAR));
  near(fit.w/fit.h, 2.39, 0.02, "fitted aspect");
  return "bbox 2.24:1 (off by "+fmt((bboxAR/2.39-1)*100)+"%), fit "+fmt(fit.w/fit.h)+":1";
});

t("normalizeRect keeps the width axis near horizontal", () => {
  for(const phi of [0, 30, 60, 89, 91, 120, -80, 170]){
    const r = SA.normalizeRect({cx:0,cy:0,w:200,h:100,t:phi*Math.PI/180});
    ok(Math.abs(SA.deg(r.t)) <= 45.0001, phi+"deg normalized to "+fmt(SA.deg(r.t)));
  }
  // a rect described the "tall" way must come back as the same shape
  const a = SA.normalizeRect({cx:0,cy:0,w:100,h:239,t:Math.PI/2});
  near(a.w, 239, 1e-9, "width after swap");
  near(a.h, 100, 1e-9, "height after swap");
  return "t always in [-45,45], w/h swapped to match";
});

t("measure() is roll-invariant", () => {
  // The same physical screen, photographed with the phone rolled. Every
  // reported angle must be identical; only `roll` changes.
  const base = SA.measure({cx:W/2, cy:H/2, w:1365, h:571, t:0}, W, H, F35);
  const out = [];
  for(const phi of [1,2,5,10]){
    const m = SA.measure({cx:W/2, cy:H/2, w:1365, h:571, t:phi*Math.PI/180}, W, H, F35);
    near(m.h, base.h, 1e-9, "horizontal at "+phi+"deg");
    near(m.v, base.v, 1e-9, "vertical at "+phi+"deg");
    near(m.ar, base.ar, 1e-9, "aspect at "+phi+"deg");
    near(m.roll, phi, 1e-9, "roll readout at "+phi+"deg");
    out.push(phi+"deg: V="+fmt(m.v));
  }
  return "V held at "+fmt(base.v)+" throughout ("+out.length+" angles)";
});

t("measure() still accepts a legacy axis-aligned box", () => {
  const box = refBox(0,0);
  const a = SA.measure(box, W, H, F35);
  const b = SA.measure(SA.asRect(box), W, H, F35);
  for(const k of ["h","v","d","seenH","seenV","off","ar"])
    near(a[k], b[k], 1e-12, k);
  ok(a.roll===0, "a box has no roll");
  return "box and rect forms agree on every field";
});

t("corners and edgeMids sit where the rect says they do", () => {
  const r = {cx:100, cy:50, w:200, h:100, t:Math.PI/6};
  const cs = SA.corners(r), ms = SA.edgeMids(r);
  // every corner is the same distance from the center
  const half = Math.hypot(100,50);
  for(const c of cs) near(Math.hypot(c[0]-r.cx, c[1]-r.cy), half, 1e-9, "corner radius");
  // opposite edge midpoints straddle the center
  near((ms[0][0]+ms[2][0])/2, r.cx, 1e-9, "top/bottom midpoint x");
  near((ms[1][1]+ms[3][1])/2, r.cy, 1e-9, "left/right midpoint y");
  // the width axis midpoints are w apart
  near(Math.hypot(ms[1][0]-ms[3][0], ms[1][1]-ms[3][1]), r.w, 1e-9, "left-to-right span");
  near(Math.hypot(ms[0][0]-ms[2][0], ms[0][1]-ms[2][1]), r.h, 1e-9, "top-to-bottom span");
  return "geometry consistent at 30 degrees of roll";
});

t("toLocal and toWorld invert each other", () => {
  const r = {cx:-30, cy:220, w:10, h:10, t:-1.1};
  for(const [x,y] of [[0,0],[100,-40],[-7,3.5]]){
    const [u,v] = SA.toLocal(r,x,y);
    const [x2,y2] = SA.toWorld(r,u,v);
    near(x2,x,1e-9,"x"); near(y2,y,1e-9,"y");
  }
  return "round trip clean at arbitrary roll";
});

/* ------------------------------ EXIF reader ------------------------------- */
/* Synthesize a JPEG carrying an Exif APP1 segment, so the reader can be
   tested without binary fixtures in the repo. Both endiannesses, values
   both inline (<=4 bytes) and out-of-line, are exercised. */
function ascii(s){
  const a = new Uint8Array(s.length+1);
  for(let i=0;i<s.length;i++) a[i] = s.charCodeAt(i);
  return a;                                   // trailing NUL
}
function rational(num,den,le){
  const b = new ArrayBuffer(8), d = new DataView(b);
  d.setUint32(0,num,le); d.setUint32(4,den,le);
  return new Uint8Array(b);
}
function makeExifJpeg(le, f, opts){
  opts = opts||{};
  const ifd0=[], sub=[];
  const E=(a,tag,type,count,inline,bytes)=>a.push({tag,type,count,inline,bytes});

  if(f.make!=null)        E(ifd0,0x010F,2,f.make.length+1,null,ascii(f.make));
  if(f.model!=null)       E(ifd0,0x0110,2,f.model.length+1,null,ascii(f.model));
  if(f.orientation!=null) E(ifd0,0x0112,3,1,f.orientation,null);

  const hasSub = ["focal","f35","zoom","pixelW","pixelH","lens"].some(k=>f[k]!=null);
  let ptrIdx=-1;
  if(hasSub){ E(ifd0,0x8769,4,1,0,null); ptrIdx=ifd0.length-1; }

  if(f.focal!=null)  E(sub,0x920A,5,1,null,rational(Math.round(f.focal*100),100,le));
  if(f.f35!=null)    E(sub,0xA405,3,1,f.f35,null);
  if(f.zoom!=null)   E(sub,0xA404,5,1,null,rational(Math.round(f.zoom*1000),1000,le));
  if(f.pixelW!=null) E(sub,0xA002,4,1,f.pixelW,null);
  if(f.pixelH!=null) E(sub,0xA003,4,1,f.pixelH,null);
  if(f.lens!=null)   E(sub,0xA434,2,f.lens.length+1,null,ascii(f.lens));

  const ifdBytes = n => 2 + n*12 + 4;
  const ifd0Off = 8;
  const subOff  = ifd0Off + ifdBytes(ifd0.length);
  const dataOff = subOff + (hasSub ? ifdBytes(sub.length) : 0);
  if(ptrIdx>=0) ifd0[ptrIdx].inline = subOff;

  let dataSize = 0;
  for(const e of ifd0.concat(sub))
    if(e.bytes && e.bytes.length>4) dataSize += e.bytes.length + (e.bytes.length%2);
  const tiffLen = dataOff + dataSize;

  const out = new Uint8Array(128 + tiffLen);
  const dv = new DataView(out.buffer);
  let p = 0;
  const marker = v => { dv.setUint16(p,v); p+=2; };      // JPEG fields are big-endian
  const idStr  = s => { for(let i=0;i<s.length;i++) out[p++] = s.charCodeAt(i); };

  marker(0xFFD8);
  if(opts.leadingXmp){                                   // an APP1 that is not Exif
    const id = "http://ns.adobe.com/xap/1.0/\0";
    marker(0xFFE1); marker(2+id.length); idStr(id);
  }
  marker(0xFFE1); marker(2+6+tiffLen); idStr("Exif\0\0");

  const B = p;
  dv.setUint16(B, le?0x4949:0x4D4D);
  dv.setUint16(B+2, 0x002A, le);
  dv.setUint32(B+4, ifd0Off, le);

  let dcur = dataOff;
  const writeIfd = (off, entries) => {
    dv.setUint16(B+off, entries.length, le);
    entries.forEach((e,i)=>{
      const at = B+off+2+i*12;
      dv.setUint16(at, e.tag, le);
      dv.setUint16(at+2, e.type, le);
      dv.setUint32(at+4, e.count, le);
      if(e.bytes){
        if(e.bytes.length <= 4){ out.set(e.bytes, at+8); }
        else {
          dv.setUint32(at+8, dcur, le);
          out.set(e.bytes, B+dcur);
          dcur += e.bytes.length + (e.bytes.length%2);
        }
      } else if(e.type === 3){ dv.setUint16(at+8, e.inline, le); }
      else { dv.setUint32(at+8, e.inline, le); }
    });
    dv.setUint32(B+off+2+entries.length*12, 0, le);      // no next IFD
  };
  writeIfd(ifd0Off, ifd0);
  if(hasSub) writeIfd(subOff, sub);
  return out.buffer.slice(0, B+tiffLen);
}

const PHONE = {make:"Apple", model:"iPhone 15 Pro", orientation:6,
               focal:6.86, f35:24, zoom:1, pixelW:4032, pixelH:3024,
               lens:"iPhone 15 Pro back camera 6.86mm f/1.78"};

t("EXIF round-trips every field, little-endian", () => {
  const x = SA_EXIF.parse(makeExifJpeg(true, PHONE));
  ok(x.make==="Apple", "make: "+x.make);
  ok(x.model==="iPhone 15 Pro", "model: "+x.model);
  ok(x.orientation===6, "orientation: "+x.orientation);
  ok(x.f35===24, "f35: "+x.f35);
  near(x.focal, 6.86, 1e-9, "focal");
  near(x.zoom, 1, 1e-9, "zoom");
  ok(x.pixelW===4032 && x.pixelH===3024, "pixel dims: "+x.pixelW+"x"+x.pixelH);
  ok(x.lens && x.lens.indexOf("6.86mm")>=0, "lens: "+x.lens);
  return "9 tags, ASCII + SHORT + LONG + RATIONAL";
});

t("EXIF round-trips every field, big-endian", () => {
  const le = SA_EXIF.parse(makeExifJpeg(true, PHONE));
  const be = SA_EXIF.parse(makeExifJpeg(false, PHONE));
  for(const k in le) ok(JSON.stringify(le[k])===JSON.stringify(be[k]),
    "endianness changed "+k+": "+le[k]+" vs "+be[k]);
  return "MM matches II on all fields";
});

t("EXIF reads an ASCII value short enough to sit inline", () => {
  // 3 bytes with the NUL, so it lives in the entry rather than the data area
  const x = SA_EXIF.parse(makeExifJpeg(true, {make:"LG", f35:20}));
  ok(x.make==="LG", "make: "+x.make);
  ok(x.f35===20, "f35: "+x.f35);
  return "inline and out-of-line paths both work";
});

t("EXIF skips a non-Exif APP1 to find the real one", () => {
  const x = SA_EXIF.parse(makeExifJpeg(true, PHONE, {leadingXmp:true}));
  ok(x.f35===24, "did not reach the Exif segment past XMP");
  return "marker walk steps over XMP";
});

t("EXIF degrades to nulls rather than throwing", () => {
  const cases = {
    "empty":        new ArrayBuffer(0),
    "not a jpeg":   new Uint8Array([1,2,3,4,5,6,7,8]).buffer,
    "SOI only":     new Uint8Array([0xFF,0xD8]).buffer,
    "no APP1":      new Uint8Array([0xFF,0xD8,0xFF,0xDB,0,4,1,2,0xFF,0xD9]).buffer,
    "truncated":    makeExifJpeg(true, PHONE).slice(0, 20),
  };
  for(const name in cases){
    const x = SA_EXIF.parse(cases[name]);
    ok(x && x.f35===null, name+" should yield a null f35, got "+(x&&x.f35));
  }
  return Object.keys(cases).length+" malformed inputs, no throw";
});

t("EXIF ignores a rational with a zero denominator", () => {
  const buf = makeExifJpeg(true, {focal:6.86, f35:24});
  const dv = new DataView(buf);
  // Zero out the focal length's denominator wherever it landed in the data area
  let patched = false;
  for(let i=0;i+8<=dv.byteLength;i++){
    if(dv.getUint32(i,true)===686 && dv.getUint32(i+4,true)===100){
      dv.setUint32(i+4, 0, true); patched = true; break;
    }
  }
  ok(patched, "test setup: never found the 686/100 rational to corrupt");
  const x = SA_EXIF.parse(buf);
  ok(x.focal===null, "expected null, got "+x.focal);
  ok(x.f35===24, "unrelated tags should survive");
  return "no division by zero, no Infinity";
});

t("plausibleF35 rejects values a phone cannot have", () => {
  ok(SA_EXIF.plausibleF35(26), "26mm is normal");
  ok(SA_EXIF.plausibleF35(120), "120mm is a long tele");
  ok(!SA_EXIF.plausibleF35(0), "zero");
  ok(!SA_EXIF.plausibleF35(4), "4mm is below any phone equivalent");
  ok(!SA_EXIF.plausibleF35(9000), "absurd");
  ok(!SA_EXIF.plausibleF35(null), "missing");
  ok(!SA_EXIF.plausibleF35("26"), "a string is not a measurement");
  return "guards against a garbage tag becoming a confident answer";
});

t("zoomed() treats the spec's 0 as 'not used'", () => {
  ok(!SA_EXIF.zoomed(0),    "0 means digital zoom was not used");
  ok(!SA_EXIF.zoomed(1),    "1x is not zoomed");
  ok(!SA_EXIF.zoomed(null), "absent tag is not evidence of zoom");
  ok(SA_EXIF.zoomed(2),     "2x should warn");
  ok(SA_EXIF.zoomed(1.5),   "1.5x should warn");
  return "only >1.01 warns";
});

t("cropFactor divides the two focal-length tags", () => {
  near(SA_EXIF.cropFactor({f35:24, focal:6.86}), 24/6.86, 1e-9);
  ok(SA_EXIF.cropFactor({f35:24, focal:null})===null, "needs both tags");
  ok(SA_EXIF.cropFactor({f35:0, focal:6.86})===null, "rejects zero");
  return fmt(24/6.86)+"x for an iPhone main camera";
});

t("deviceKey separates resolutions of the same camera", () => {
  const a = SA_EXIF.deviceKey({make:"Apple",model:"iPhone 15 Pro"}, 4032, 3024);
  const b = SA_EXIF.deviceKey({make:"Apple",model:"iPhone 15 Pro"}, 8064, 6048);
  ok(a !== b, "pixel pitch changes with resolution, so the key must too");
  ok(SA_EXIF.deviceKey({make:null,model:null}, 100, 50) === "unknown@100",
     "unidentified device still gets a usable key");
  return a;
});

/* ------------------------- known limitations ------------------------------ */
known("keystone from an off-centerline seat is uncorrected", () =>
  "a non-fronto-parallel screen breaks the uniform-magnification assumption " +
  "that head-on subtense and distance() both rest on");

/* --------------------------------- report --------------------------------- */
const pass = results.filter(r=>r.state==="pass").length;
const fail = results.filter(r=>r.state==="fail").length;
const kn   = results.filter(r=>r.state==="known").length;
const summary = {pass, fail, known:kn, total:results.length};

if(typeof document === "undefined"){
  for(const r of results){
    const tag = r.state==="pass" ? "ok  " : r.state==="fail" ? "FAIL" : "known";
    print(tag+"  "+r.name+(r.detail?"\n        "+r.detail:""));
  }
  print("\n"+pass+" passed, "+fail+" failed, "+kn+" known limitations");
}

return {results, summary};
})();
