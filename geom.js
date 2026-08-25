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

/* ---------------------------------------------------------------------------
   Keystone: single-view rectification of a quadrilateral.

   Everything above assumes the screen is fronto-parallel, which is what makes
   magnification uniform and lets w_px/f_px stand in for W_real/D. Sit off the
   centerline and that breaks: the near edge images larger than the far one,
   the aspect ratio is wrong, and the distance is wrong with it.

   With f_px known and the four corners marked, the fix is exact and closed
   form. Two vanishing points give the 3D directions of the screen's edges;
   their cross product is the plane normal; back-projecting each corner ray
   onto that plane recovers the rectangle up to a single overall scale --
   which is all the angles need, since they depend only on ratios.

   Quad order is [top-left, top-right, bottom-right, bottom-left].
   --------------------------------------------------------------------------- */

function cross3(a,b){
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot3(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function norm3(v){ return Math.hypot(v[0],v[1],v[2]); }
function unit3(v){
  const n=norm3(v);
  return n < 1e-12 ? null : [v[0]/n, v[1]/n, v[2]/n];
}

/* Is the quad convex and consistently wound? A dragged-through corner makes
   a bowtie, whose "rectification" is arithmetic without meaning. */
function isConvexQuad(q){
  if(!q || q.length !== 4) return false;
  let sign = 0;
  for(let i=0;i<4;i++){
    const a=q[i], b=q[(i+1)%4], c=q[(i+2)%4];
    const z=(b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
    if(Math.abs(z) < 1e-9) continue;
    const s = z > 0 ? 1 : -1;
    if(sign === 0) sign = s;
    else if(s !== sign) return false;
  }
  return sign !== 0;
}

function quadFromRect(r){ return corners(r); }

function quadCentroid(q){
  return [(q[0][0]+q[1][0]+q[2][0]+q[3][0])/4,
          (q[0][1]+q[1][1]+q[2][1]+q[3][1])/4];
}

/* Full rectification. Returns {ok:false, reason} rather than throwing or
   quietly emitting nonsense, so the caller can hold the last good reading. */
function rectify(quad,W,H,f35){
  const bad = reason => ({ok:false, reason});
  if(!quad || quad.length !== 4) return bad("need four corners");
  if(!isConvexQuad(quad)) return bad("corners are crossed");

  const f = fpx(W,H,f35);
  const m = quad.map(p => ray(p[0],p[1],W,H,f));

  // Vanishing directions: intersect the two width edges, then the two height
  // edges. Each cross product of rays is the plane through the camera centre
  // containing that edge; two such planes meet along the edge direction.
  const d1 = unit3(cross3(cross3(m[0],m[1]), cross3(m[3],m[2])));
  const d2 = unit3(cross3(cross3(m[0],m[3]), cross3(m[1],m[2])));
  if(!d1 || !d2) return bad("edges are degenerate");

  /* A rectangle's edge directions are perpendicular. How far off they land is
     a diagnostic: either the marked shape is not a rectangle, or f35 is wrong.
     Reported, never silently corrected.

     Blind in one important case. If either pair of edges stays parallel in the
     image -- a pure yaw with the screen vertically centred, say -- symmetry
     forces the skew to zero for *any* f, so a wrong focal length leaves no
     trace here. It only bites when both pairs converge. */
  const skew = 90 - deg(Math.acos(Math.min(1,Math.abs(dot3(d1,d2)))));

  const n0 = unit3(cross3(d1,d2));
  if(!n0) return bad("edge directions are parallel");

  /* Put the screen plane at n.P = 1, which fixes the arbitrary scale and
     makes the perpendicular distance from the camera exactly 1. */
  let n = n0;
  const denom = m.map(r => dot3(n,r));
  if(denom.some(d => Math.abs(d) < 1e-9)) return bad("screen plane passes through the lens");
  if(denom.every(d => d < 0)) n = [-n[0],-n[1],-n[2]];
  else if(!denom.every(d => d > 0)) return bad("corners straddle the lens plane");

  const P = m.map(r => {
    const l = 1/dot3(n,r);
    return [r[0]*l, r[1]*l, r[2]*l];
  });
  const seg = (a,b) => Math.hypot(P[b][0]-P[a][0], P[b][1]-P[a][1], P[b][2]-P[a][2]);

  // opposite edges are equal for a true rectangle; average for robustness
  const width  = (seg(0,1) + seg(3,2))/2;
  const height = (seg(0,3) + seg(1,2))/2;
  if(!(width > 0) || !(height > 0)) return bad("degenerate rectangle");

  const C = [(P[0][0]+P[1][0]+P[2][0]+P[3][0])/4,
             (P[0][1]+P[1][1]+P[2][1]+P[3][1])/4,
             (P[0][2]+P[1][2]+P[2][2]+P[3][2])/4];
  const cDist = norm3(C);
  if(!(cDist > 0)) return bad("screen centre is at the lens");

  /* Head-on equivalent divides by the line-of-sight distance to the screen
     centre, not the perpendicular distance to its plane.

     Dividing by the perpendicular distance would make the number grow as you
     slide sideways along a constant-radius arc, since the plane gets nearer
     even as the screen does not. Using the line-of-sight distance holds it
     constant along that arc, which is what "the same seat, moved onto the
     centreline" has to mean. Both agree when fronto-parallel, where cDist
     is 1 by construction. */

  // How far off the screen's own centreline the camera sits.
  const obliquity = cDist < 1e-12 ? 0
    : deg(Math.acos(Math.min(1, Math.abs(dot3(n,C))/cDist)));

  // as-seen: the true angle between the edge rays, through the quad's midlines
  const mid = (a,b) => [(quad[a][0]+quad[b][0])/2, (quad[a][1]+quad[b][1])/2];
  const R = p => ray(p[0],p[1],W,H,f);
  const [L,Rt,T,B] = [mid(0,3), mid(1,2), mid(0,1), mid(3,2)];

  // roll of the width axis as it appears in the image
  const e0 = unit3([quad[1][0]-quad[0][0], quad[1][1]-quad[0][1], 0]) || [1,0,0];
  const e1 = unit3([quad[2][0]-quad[3][0], quad[2][1]-quad[3][1], 0]) || [1,0,0];
  const rollRect = normalizeRect({cx:0, cy:0, w:1, h:1,
                                  t:Math.atan2(e0[1]+e1[1], e0[0]+e1[0])});

  const ctr = quadCentroid(quad);
  return {
    ok: true,
    f: f,
    h: deg(2*Math.atan(width/(2*cDist))),
    v: deg(2*Math.atan(height/(2*cDist))),
    d: deg(2*Math.atan(Math.hypot(width,height)/(2*cDist))),
    seenH: deg(angleBetween(R(L), R(Rt))),
    seenV: deg(angleBetween(R(T), R(B))),
    off:   deg(angleBetween([0,0,f], ray(ctr[0],ctr[1],W,H,f))),
    roll:  deg(rollRect.t),
    ar: width/height,
    obliquity: obliquity,
    skew: skew,
    normal: n,
    // in units where the perpendicular distance from camera to screen is 1
    unitWidth: width,
    unitHeight: height,
    unitCenterDist: cDist,
  };
}

/* Perpendicular distance from the camera to the screen plane -- the D that
   SMPTE's 2*atan(W/2D) is defined against. */
function perpDistance(realWidth, rec){
  if(!rec || !rec.ok || !(rec.unitWidth > 0)) return NaN;
  return realWidth/rec.unitWidth;
}
/* Straight-line distance from the camera to the screen centre. Equal to the
   perpendicular distance only when sitting on the centreline. */
function centerDistance(realWidth, rec){
  return perpDistance(realWidth, rec) * (rec && rec.unitCenterDist || NaN);
}

/* --------------------------------------------------------------------------
   Turning the rotated-rect fit into a quad: a keystoned screen still has
   straight edges, so fit a line to the boundary points along each side and
   intersect adjacent pairs. Only the rectangle assumption fails, not the
   straightness one.
   -------------------------------------------------------------------------- */

/* Total-least-squares line fit: the principal axis of the point set. Ordinary
   least squares would fail on the near-vertical sides. */
function fitLine(pts){
  const n = pts.length;
  if(n < 8) return null;
  let mx=0, my=0;
  for(const p of pts){ mx+=p[0]; my+=p[1]; }
  mx/=n; my/=n;
  let sxx=0, sxy=0, syy=0;
  for(const p of pts){
    const dx=p[0]-mx, dy=p[1]-my;
    sxx+=dx*dx; sxy+=dx*dy; syy+=dy*dy;
  }
  const tr=sxx+syy, det=sxx*syy-sxy*sxy;
  const l1 = tr/2 + Math.sqrt(Math.max(0, tr*tr/4 - det));
  let dx, dy;
  if(Math.abs(sxy) > 1e-12){ dx=sxy; dy=l1-sxx; }
  else if(sxx >= syy){ dx=1; dy=0; }
  else { dx=0; dy=1; }
  const len = Math.hypot(dx,dy);
  if(len < 1e-12) return null;
  return {px:mx, py:my, dx:dx/len, dy:dy/len};
}

function intersectLines(a,b){
  if(!a || !b) return null;
  const den = a.dx*b.dy - a.dy*b.dx;
  if(Math.abs(den) < 1e-9) return null;            // parallel
  const t = ((b.px-a.px)*b.dy - (b.py-a.py)*b.dx)/den;
  const p = [a.px + t*a.dx, a.py + t*a.dy];
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : null;
}

/* Refine a rect fit to a quad. Returns null -- meaning "keep the rect" --
   whenever the result is not clearly better, rather than risking a worse fit. */
function refineQuad(pts, r){
  if(!r || !pts || pts.length < 60) return null;
  const hw=r.w/2, hh=r.h/2;
  if(!(hw>0) || !(hh>0)) return null;

  // assign each boundary point to its nearest side, skipping the corner
  // regions where two sides compete for the same points
  const SKIP = 0.18;
  const groups = [[],[],[],[]];                    // top, right, bottom, left
  for(const p of pts){
    const [u,v] = toLocal(r, p[0], p[1]);
    const du = Math.abs(Math.abs(u)-hw), dv = Math.abs(Math.abs(v)-hh);
    if(dv < du){
      if(Math.abs(u) > hw*(1-SKIP)) continue;
      groups[v < 0 ? 0 : 2].push(p);
    } else {
      if(Math.abs(v) > hh*(1-SKIP)) continue;
      groups[u > 0 ? 1 : 3].push(p);
    }
  }

  const L = groups.map(fitLine);
  if(L.some(l => !l)) return null;
  const quad = [intersectLines(L[0],L[3]), intersectLines(L[0],L[1]),
                intersectLines(L[2],L[1]), intersectLines(L[2],L[3])];
  if(quad.some(q => !q)) return null;
  if(!isConvexQuad(quad)) return null;

  // Reject a fit that wandered: every corner should land near the rect's.
  const rc = corners(r);
  const diag = Math.hypot(r.w, r.h);
  for(let i=0;i<4;i++)
    if(Math.hypot(quad[i][0]-rc[i][0], quad[i][1]-rc[i][1]) > 0.25*diag) return null;
  return quad;
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
        convexHull, minAreaRect,
        rectify, perpDistance, centerDistance, quadFromRect, quadCentroid,
        isConvexQuad, refineQuad, fitLine, intersectLines,
        cross3, dot3, norm3, unit3};
})();
