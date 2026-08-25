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

/* ---------------------------------------------------------------------------
   The screen model is a rotated rectangle: {cx, cy, w, h, t}, where t is the
   roll of the screen's own width axis in the image, in radians.

   An axis-aligned box cannot represent a hand-held shot. Circumscribing a
   rectangle rolled by only 2 degrees inflates its bounding box by 1.4%
   horizontally and 8.3% vertically, and drags a 2.39:1 aspect ratio down to
   2.24. That is larger than every other term in the error budget combined,
   and it always inflates -- it never averages out over repeat shots.
   --------------------------------------------------------------------------- */

function toLocal(r,x,y){
  const c=Math.cos(r.t), s=Math.sin(r.t), dx=x-r.cx, dy=y-r.cy;
  return [dx*c + dy*s, -dx*s + dy*c];
}
function toWorld(r,u,v){
  const c=Math.cos(r.t), s=Math.sin(r.t);
  return [r.cx + u*c - v*s, r.cy + u*s + v*c];
}
/* top-left, top-right, bottom-right, bottom-left, in the rect's own frame */
function corners(r){
  const hw=r.w/2, hh=r.h/2;
  return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(p=>toWorld(r,p[0],p[1]));
}
/* top, right, bottom, left */
function edgeMids(r){
  const hw=r.w/2, hh=r.h/2;
  return [[0,-hh],[hw,0],[0,hh],[-hw,0]].map(p=>toWorld(r,p[0],p[1]));
}

/* Accept a legacy axis-aligned box anywhere a rect is expected. */
function asRect(o){
  if(o && o.x1 !== undefined)
    return {cx:(o.x1+o.x2)/2, cy:(o.y1+o.y2)/2, w:o.x2-o.x1, h:o.y2-o.y1, t:0};
  return o;
}

/* Put the width axis on whichever side is closest to image-horizontal, so t
   lands in [-45, 45] degrees and w/h stay interpretable as width and height.
   Without this the calipers can return the same rectangle described four
   ways, and the aspect ratio flips to its reciprocal at random. */
function normalizeRect(r){
  let {cx,cy,w,h,t} = r;
  const HALF_PI = Math.PI/2;
  t = ((t % Math.PI) + Math.PI) % Math.PI;      // -> [0, PI)
  if(t > HALF_PI) t -= Math.PI;                 // -> (-PI/2, PI/2]
  if(Math.abs(t) > Math.PI/4){
    t += (t > 0 ? -HALF_PI : HALF_PI);
    const swap = w; w = h; h = swap;
  }
  return {cx, cy, w:Math.abs(w), h:Math.abs(h), t};
}

/* Andrew's monotone chain. Counter-clockwise in screen coords (y down). */
function convexHull(pts){
  if(pts.length < 3) return pts.slice();
  const p = pts.slice().sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half = src => {
    const out=[];
    for(const q of src){
      while(out.length>=2 && cross(out[out.length-2],out[out.length-1],q)<=0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  const lower = half(p), upper = half(p.slice().reverse());
  const hull = lower.concat(upper);
  return hull.length ? hull : p.slice(0,1);
}

/* Minimum-area enclosing rectangle by rotating calipers.

   Relies on the fact that a minimum-area rectangle always has one side
   collinear with an edge of the convex hull, so testing each hull edge as a
   candidate axis is exhaustive rather than a search. */
function minAreaRect(pts){
  const hull = convexHull(pts);
  if(hull.length < 2) return null;
  let best = null;
  for(let i=0;i<hull.length;i++){
    const a = hull[i], b = hull[(i+1)%hull.length];
    const len = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if(len < 1e-9) continue;
    const ux=(b[0]-a[0])/len, uy=(b[1]-a[1])/len;
    let minU=Infinity, maxU=-Infinity, minV=Infinity, maxV=-Infinity;
    for(const q of hull){
      const u =  q[0]*ux + q[1]*uy;
      const v = -q[0]*uy + q[1]*ux;
      if(u<minU) minU=u; if(u>maxU) maxU=u;
      if(v<minV) minV=v; if(v>maxV) maxV=v;
    }
    const w=maxU-minU, h=maxV-minV, area=w*h;
    if(!best || area < best.area){
      const cu=(minU+maxU)/2, cv=(minV+maxV)/2;
      best = {area, w, h, t:Math.atan2(uy,ux),
              cx: cu*ux - cv*uy, cy: cu*uy + cv*ux};
    }
  }
  return best ? normalizeRect(best) : null;
}

/* Every readout for a screen rect, in degrees.

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
   is why `off` is reported: it is the actionable number ("re-aim").

   w and h are measured along the screen's own axes, so every figure here is
   already roll-corrected. */
function measure(o,W,H,f35){
  const r = asRect(o);
  const f = fpx(W,H,f35);
  const w = Math.abs(r.w), h = Math.abs(r.h);
  const [top, right, bottom, left] = edgeMids(r);
  const R = p => ray(p[0],p[1],W,H,f);

  return {
    f: f,
    h: deg(2*Math.atan(w/(2*f))),
    v: deg(2*Math.atan(h/(2*f))),
    d: deg(2*Math.atan(Math.hypot(w,h)/(2*f))),
    seenH: deg(angleBetween(R(left), R(right))),
    seenV: deg(angleBetween(R(top), R(bottom))),
    off:   deg(angleBetween([0,0,f], ray(r.cx,r.cy,W,H,f))),
    roll:  deg(r.t),
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

return {deg, fpx, ray, angleBetween, distance, measure, nearestAR, STD,
        asRect, normalizeRect, toLocal, toWorld, corners, edgeMids,
        convexHull, minAreaRect};
})();
