/* Pure geometry for the pinhole model. No DOM, no state.
   Loaded as a classic script by both index.html and tests.html so it works
   over file:// -- ES modules would be blocked by CORS there. */
window.SA = (function(){
"use strict";

const deg = r => r*180/Math.PI;

/* Focal length in pixels from the EXIF 35mm-equivalent focal length.
   max(W,H) rather than W: the 36mm dimension of a 35mm frame always
   corresponds to the long side of the image, so this is orientation-agnostic. */
function fpx(W,H,f35){ return Math.max(W,H)*f35/36; }

/* Ray from an image pixel through the pinhole, in camera coordinates.
   Optical center assumed at the image center -- true enough for phones. */
function ray(x,y,W,H,f){ return [x-W/2, y-H/2, f]; }

function angleBetween(a,b){
  const dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const na = Math.hypot(a[0],a[1],a[2]), nb = Math.hypot(b[0],b[1],b[2]);
  if(!na || !nb) return 0;
  return Math.acos(Math.max(-1,Math.min(1,dot/(na*nb))));
}

/* Distance to a fronto-parallel screen of known width.
   Exact pinhole similar triangles: D = W_real * f_px / w_px.

   Correct wherever the box sits in the frame. A half-angle formula
   D = (W/2)/tan(theta/2) is only equivalent when the box is centered on the
   optical axis, and overreads otherwise -- ~1% at 5 degrees off, ~5% at 13. */
function distance(realWidth,boxWidthPx,f){
  if(!(boxWidthPx>0)) return NaN;
  return realWidth*f/boxWidthPx;
}

/* Every readout for an axis-aligned box, in degrees.

   Two different quantities both get called "angular subtense" and they are
   not the same number:

   head-on (h,v,d) -- what you would measure sitting perpendicular to the
     screen center, 2*atan(W_real/2D). For a fronto-parallel plane the
     magnification is uniform, so W_real/D == w_px/f and this needs no
     real-world scale. Independent of where the box sits in the frame.
     This is the quantity SMPTE EG-18 and THX define their targets against,
     so it is what belongs on the meter.

   as-seen (seenH,seenV) -- the true angle between the edge rays from where
     the camera actually sat, measured through the box's own midline. A flat
     object viewed off-axis genuinely subtends less. Always <= head-on, by
     the concavity of atan, and equal when the box is centered.

   They diverge only when the photo is not aimed at the screen center, which
   is why `off` is reported: it is the actionable number ("re-aim"). */
function measure(box,W,H,f35){
  const f = fpx(W,H,f35);
  const w = box.x2-box.x1, h = box.y2-box.y1;
  const mx = (box.x1+box.x2)/2, my = (box.y1+box.y2)/2;
  const R = (x,y) => ray(x,y,W,H,f);

  return {
    f: f,
    h: deg(2*Math.atan(w/(2*f))),
    v: deg(2*Math.atan(h/(2*f))),
    d: deg(2*Math.atan(Math.hypot(w,h)/(2*f))),
    seenH: deg(angleBetween(R(box.x1,my), R(box.x2,my))),
    seenV: deg(angleBetween(R(mx,box.y1), R(mx,box.y2))),
    off:   deg(angleBetween([0,0,f], R(mx,my))),
    ar: h>0 ? w/h : NaN,
  };
}

const STD = [[1.33,"1.33 Academy"],[1.66,"1.66"],[1.78,"1.78 HD"],
             [1.85,"1.85 Flat"],[2.00,"2.00"],[2.39,"2.39 Scope"]];

/* Nearest standard ratio, or null if nothing is within 5%. */
function nearestAR(r){
  let best=null, dmin=Infinity;
  for(const s of STD){ const d=Math.abs(s[0]-r); if(d<dmin){dmin=d;best=s;} }
  if(!best) return null;
  return dmin/best[0] < 0.05 ? best[1] : null;
}

return {deg, fpx, ray, angleBetween, distance, measure, nearestAR, STD};
})();
