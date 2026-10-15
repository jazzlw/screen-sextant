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
   least squares would fail on the near-vertical sides.

   Returns the RMS perpendicular residual alongside the line. That number is
   what says whether the points describe a straight edge at all: fed the ragged
   boundary of a dark patch of picture content, the fit still returns a line,
   and without the residual there is no way to tell that line from a real one. */
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
  const ux = dx/len, uy = dy/len;
  let se = 0;
  for(const p of pts){
    const perp = (p[0]-mx)*(-uy) + (p[1]-my)*ux;
    se += perp*perp;
  }
  return {px:mx, py:my, dx:ux, dy:uy, rms:Math.sqrt(se/n), n:n};
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

  /* Take the outer silhouette, not every boundary pixel.

     A screen showing real content is not a solid blob: dark passages in the
     picture punch holes in the mask, and the edges of those holes are
     boundary pixels too. Measured on a living-room photo, 22% of them were
     interior, and feeding them to the line fits drags the sides inward.
     For each position along a side, only the most extreme point can be part
     of that side, so keeping just the extremum discards holes by
     construction. */
  const SKIP = 0.18;
  const BAND = 0.30;                                 // how far a side may slant in
  const ext = [new Map(), new Map(), new Map(), new Map()];   // top,right,bottom,left
  const keep = (m, key, val, p, wantMax) => {
    const cur = m.get(key);
    if(!cur || (wantMax ? val > cur.v : val < cur.v)) m.set(key, {v:val, p:p});
  };
  for(const p of pts){
    const [u,v] = toLocal(r, p[0], p[1]);
    const du = Math.abs(Math.abs(u)-hw), dv = Math.abs(Math.abs(v)-hh);
    /* Assign to the nearest side first, then take the extremum within that
       assignment. Taking the extremum globally instead would be wrong for a
       trapezoid: the far edge is shorter than the near one, so for rows it
       does not span, points from the top and bottom edges would win the
       "leftmost" slot and drag the fit across the shape. */
    if(dv < du){
      if(Math.abs(u) > hw*(1-SKIP)) continue;
      const side = v < 0 ? 0 : 2;
      // must also lie in a band along that side of the rect: the extremum
      // rule alone relies on every bucket holding an outer point, which dense
      // pixel data gives but sparse input does not
      if(Math.abs(v) < hh - BAND*r.h) continue;
      keep(ext[side], Math.round(u), v, p, side === 2);
    } else {
      if(Math.abs(v) > hh*(1-SKIP)) continue;
      const side = u > 0 ? 1 : 3;
      if(Math.abs(u) < hw - BAND*r.w) continue;
      keep(ext[side], Math.round(v), u, p, side === 1);
    }
  }
  const groups = ext.map(m => Array.from(m.values(), e => e.p));

  const L = groups.map(fitLine);
  if(L.some(l => !l)) return null;

  /* A side whose points scatter is not an edge. This is the check that
     matters: without it the refinement happily fits a line to the boundary of
     a dark region of picture content and reports it as the screen's edge,
     turning a serviceable rectangle into a badly skewed quad. */
  const span = Math.hypot(r.w, r.h);
  for(let i=0;i<4;i++)
    if(L[i].rms > 0.012*span) return null;
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

/* --------------------------------------------------------------------------
   Edge snapping.

   refineQuad works from the threshold mask, and inherits its central flaw:
   the mask is the *lit* region, not the screen. Where the picture happens to
   be dark at an edge, the mask stops short, and no threshold recovers it --
   a black patch of picture and a black bezel are the same pixels.

   The screen's edge is still there in the image, though, as a luminance
   discontinuity between picture and wall. Measured on a living-room photo the
   step at the bottom edge was 150 -> 59 across two pixels, in a region the
   mask had already given up on. So search for the step directly: walk
   perpendicular to each side of the initial rectangle, take the strongest
   gradient, and fit a line to where those peaks land.

   Photometric in, geometric out, and it never asks the picture to be bright.
   -------------------------------------------------------------------------- */

/* Bilinear sample of a luminance buffer; null outside the image. */
function sampleAt(g,w,h,x,y){
  if(!(x >= 0 && y >= 0 && x <= w-1 && y <= h-1)) return null;
  const x0=Math.floor(x), y0=Math.floor(y);
  const x1=Math.min(x0+1,w-1), y1=Math.min(y0+1,h-1);
  const fx=x-x0, fy=y-y0;
  return g[y0*w+x0]*(1-fx)*(1-fy) + g[y0*w+x1]*fx*(1-fy)
       + g[y1*w+x0]*(1-fx)*fy     + g[y1*w+x1]*fx*fy;
}

function median(a){
  if(!a.length) return 0;
  const b = a.slice().sort((x,y)=>x-y);
  const m = b.length>>1;
  return b.length%2 ? b[m] : (b[m-1]+b[m])/2;
}

/* Least-squares line with two rounds of outlier trimming. A handful of
   samples will always land on something that is not the edge -- a cable, a
   reflection, the corner of a speaker -- and one bad sample in forty is
   enough to tilt a line that then propagates into both adjacent corners. */
function fitLineRobust(pts, tol){
  let cur = pts, line = fitLine(cur);
  if(!line) return null;
  for(let iter=0; iter<2; iter++){
    const lim = Math.max(tol, 2*line.rms);
    const keep = cur.filter(p =>
      Math.abs((p[0]-line.px)*(-line.dy) + (p[1]-line.py)*line.dx) <= lim);
    if(keep.length < 8 || keep.length === cur.length) break;
    const next = fitLine(keep);
    if(!next) break;
    cur = keep; line = next;
  }
  return {line: line, n: cur.length, of: pts.length};
}

/* --------------------------------------------------------------------------
   Detection, start to finish, over a luminance buffer.

   Lives here rather than in index.html so the same code can be run headless
   against real photos (tools/eval.py, tools/overlay.py) instead of each tool
   keeping its own copy of the mask stage and drifting from the app.
   -------------------------------------------------------------------------- */

/* Otsu's split of a 256-bin luminance histogram. */
function otsu(g){
  const hist = new Uint32Array(256);
  for(let i=0;i<g.length;i++) hist[g[i]]++;
  const N = g.length; let sum = 0;
  for(let t=0;t<256;t++) sum += t*hist[t];
  let sumB=0, wB=0, best=0, thr=128;
  for(let t=0;t<256;t++){
    wB += hist[t]; if(!wB) continue;
    const wF = N-wB; if(!wF) break;
    sumB += t*hist[t];
    const mB = sumB/wB, mF = (sum-sumB)/wF;
    const v = wB*wF*(mB-mF)*(mB-mF);
    if(v > best){ best = v; thr = t; }
  }
  return thr;
}

/* Every 4-connected component above thr, as a label image plus per-label
   area. */
function labelAll(g,w,h,thr){
  const lab = new Int32Array(w*h).fill(-1);
  const stack = new Int32Array(w*h);
  const area = [];
  let id = 0;
  for(let i=0;i<g.length;i++){
    if(g[i]<=thr || lab[i]!==-1) continue;
    let sp=0; stack[sp++]=i; lab[i]=id;
    let a=0;
    while(sp){
      const p=stack[--sp], px=p%w, py=(p/w)|0;
      a++;
      if(px>0   && g[p-1]>thr && lab[p-1]===-1){lab[p-1]=id;stack[sp++]=p-1;}
      if(px<w-1 && g[p+1]>thr && lab[p+1]===-1){lab[p+1]=id;stack[sp++]=p+1;}
      if(py>0   && g[p-w]>thr && lab[p-w]===-1){lab[p-w]=id;stack[sp++]=p-w;}
      if(py<h-1 && g[p+w]>thr && lab[p+w]===-1){lab[p+w]=id;stack[sp++]=p+w;}
    }
    area.push(a); id++;
  }
  return {lab:lab, area:area};
}

/* Largest component above thr: its boundary pixels (as pixel centres), its
   area and the label image, or null if nothing is lit. What the mask alone
   sees -- the detector no longer stops here, but the overlay tool shows it. */
function brightestBlob(g,w,h,thr){
  const L = labelAll(g,w,h,thr);
  if(!L.area.length) return null;
  let id = 0;
  for(let i=1;i<L.area.length;i++) if(L.area[i] > L.area[id]) id = i;
  return {pts:boundaries(L.lab,w,h,[id]).get(id), area:L.area[id], lab:L.lab, id:id};
}

/* How much of a quad's outline is a real screen edge.

   Whatever surrounds a screen -- masking, a bezel, a dark wall -- is darker
   than the picture right at the boundary, on every side. Picture content,
   furniture and lamps do not produce that: their outlines are partial, or
   flip polarity part-way round. So walk each side and count the samples where
   a step down from inside to outside is present within a small band of the
   line. The band absorbs a slightly misplaced corner and the bow of a curved
   screen, whose straight chord sits a few pixels off the actual edge.

   Returns {score, sides:[4 fractions], step}: score is the mean side support,
   pulled down by the weakest side so that three good sides and one invented
   one do not pass. */
function edgeSupport(g,w,h,quad,opts){
  const o = Object.assign({samples:40, skip:0.08, band:0.02, minStep:8,
                           relStep:0.12, depth:3}, opts||{});
  const sides = [];
  let stepSum = 0, stepN = 0;
  for(let i=0;i<4;i++){
    const A = quad[i], B = quad[(i+1)%4];
    const ex = B[0]-A[0], ey = B[1]-A[1];
    const len = Math.hypot(ex,ey);
    if(!(len >= 6)) return {score:0, sides:[0,0,0,0], step:0};
    const nx = ey/len, ny = -ex/len;
    const band = Math.max(2, Math.round(o.band*len));
    let hit = 0;
    for(let k=0;k<o.samples;k++){
      const t = o.skip + (1-2*o.skip)*k/(o.samples-1);
      const px = A[0]+ex*t, py = A[1]+ey*t;
      let best = -Infinity, bestIn = 0;
      for(let d=-band; d<=band; d++){
        let si = 0, so = 0, ok = true;
        for(let j=1;j<=o.depth;j++){
          const a = sampleAt(g,w,h, px+nx*(d-j+0.5), py+ny*(d-j+0.5));
          const b = sampleAt(g,w,h, px+nx*(d+j-0.5), py+ny*(d+j-0.5));
          if(a == null || b == null){ ok = false; break; }
          si += a; so += b;
        }
        if(!ok) continue;
        const c = (si-so)/o.depth;
        if(c > best){ best = c; bestIn = si/o.depth; }
      }
      if(best >= Math.max(o.minStep, o.relStep*bestIn)){ hit++; stepSum += best; stepN++; }
    }
    sides.push(hit/o.samples);
  }
  const mean = (sides[0]+sides[1]+sides[2]+sides[3])/4;
  const min = Math.min(sides[0],sides[1],sides[2],sides[3]);
  return {score: mean*(0.5+0.5*min), sides:sides, step: stepN ? stepSum/stepN : 0};
}

function quadArea(q){
  let a = 0;
  for(let i=0;i<4;i++){
    const p = q[i], r = q[(i+1)%4];
    a += p[0]*r[1] - r[0]*p[1];
  }
  return Math.abs(a)/2;
}

/* A side as a gently bowed curve: along the fitted line, offset by
   c0 + c1*s + c2*s^2. Used only when it explains the points clearly better
   than the line does -- a cinema's curved screen does, a TV does not, and
   giving a straight edge a curvature term would just fit its noise. */
function fitBow(pts, line){
  const flat = {px:line.px, py:line.py, dx:line.dx, dy:line.dy, c:[0,0,0]};
  if(pts.length < 12) return flat;
  const nx = -line.dy, ny = line.dx;
  let sd = pts.map(p => [(p[0]-line.px)*line.dx + (p[1]-line.py)*line.dy,
                         (p[0]-line.px)*nx + (p[1]-line.py)*ny]);
  const solve = q => {
    // least squares for d = c0 + c1 s + c2 s^2, via the 3x3 normal equations
    const M = [[0,0,0],[0,0,0],[0,0,0]], v = [0,0,0];
    for(const [x,y] of q){
      const b = [1, x, x*x];
      for(let i=0;i<3;i++){ v[i] += b[i]*y; for(let j=0;j<3;j++) M[i][j] += b[i]*b[j]; }
    }
    for(let i=0;i<3;i++){                       // Gauss-Jordan, partial pivot
      let piv = i;
      for(let r=i+1;r<3;r++) if(Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
      [M[i],M[piv]] = [M[piv],M[i]]; [v[i],v[piv]] = [v[piv],v[i]];
      if(Math.abs(M[i][i]) < 1e-12) return null;
      for(let r=0;r<3;r++){
        if(r === i) continue;
        const f = M[r][i]/M[i][i];
        for(let j=i;j<3;j++) M[r][j] -= f*M[i][j];
        v[r] -= f*v[i];
      }
    }
    return [v[0]/M[0][0], v[1]/M[1][1], v[2]/M[2][2]];
  };
  const resid = (q,c) => q.map(([x,y]) => y - (c[0] + c[1]*x + c[2]*x*x));
  const rms = r => Math.sqrt(r.reduce((a,b) => a+b*b, 0)/Math.max(1,r.length));
  let c = solve(sd);
  if(!c) return flat;
  for(let it=0; it<2; it++){
    const r = resid(sd, c), lim = Math.max(1, 2.5*rms(r));
    const keep = sd.filter((p,i) => Math.abs(r[i]) <= lim);
    if(keep.length < 12 || keep.length === sd.length) break;
    const c2 = solve(keep);
    if(!c2) break;
    sd = keep; c = c2;
  }
  const lineRms = rms(sd.map(p => p[1]));
  const bowRms = rms(resid(sd, c));
  if(!(lineRms > 0.6 && bowRms < 0.7*lineRms)) return flat;
  return {px:line.px, py:line.py, dx:line.dx, dy:line.dy, c:c};
}

/* Where two bowed sides meet, by Newton on their tangents, starting from the
   straight-line corner. */
function meetBows(a, b, start){
  const pt = (k,s) => {
    const d = k.c[0] + k.c[1]*s + k.c[2]*s*s;
    return [k.px + k.dx*s - k.dy*d, k.py + k.dy*s + k.dx*d];
  };
  const tan = (k,s) => {
    const dd = k.c[1] + 2*k.c[2]*s;
    const p = pt(k,s);
    return {px:p[0], py:p[1], dx:k.dx - k.dy*dd, dy:k.dy + k.dx*dd};
  };
  const along = (k,p) => (p[0]-k.px)*k.dx + (p[1]-k.py)*k.dy;
  let p = start;
  for(let it=0; it<8; it++){
    const q = intersectLines(tan(a, along(a,p)), tan(b, along(b,p)));
    if(!q) return null;
    if(Math.hypot(q[0]-p[0], q[1]-p[1]) < 0.01){ p = q; break; }
    p = q;
  }
  return Math.hypot(p[0]-start[0], p[1]-start[1]) < 50 ? p : null;
}

/* Snap each side onto the screen's real edge, using its polarity.

   An earlier version took luminance steps of either sign and the outermost
   line with broad support. Both choices fail on real photos: text
   on a title card is a step, so is the top of a row of seats, and "outermost"
   happily walks onto either. What only the screen's edge has is a step DOWN
   going outward, along the whole side. So for each side, count -- per
   candidate line -- the samples where the inside is brighter than the outside
   right at that line, take the best-supported line, and among lines that are
   nearly as well supported, the outermost: a picture inset in a lit frame has
   two full-length edges, and the screen is the outer one.

   Several passes with shrinking reach, as before, so a seed that is well off
   can still be pulled in without the final answer being loose.

   Returns [TL,TR,BR,BL] or null if any side has no convincing edge. */
function snapEdges(g,w,h,seed,opts){
  const o = Object.assign({samples:48, skip:0.1, passes:[0.25,0.1,0.04],
                           maxReach:40, slopes:13, slopeSpan:6, depth:2,
                           minStep:4, relStep:0.1, near:0.9, minSupport:0.5,
                           track:0.025, maxBow:0.06},
                          opts||{});
  if(!g || !seed) return null;
  let quad = (seed.cx !== undefined) ? corners(asRect(seed))
                                     : seed.map(p => p.slice());
  if(quad.length !== 4 || !isConvexQuad(quad)) return null;
  const shortest = q => {
    let m = Infinity;
    for(let i=0;i<4;i++)
      m = Math.min(m, Math.hypot(q[(i+1)%4][0]-q[i][0], q[(i+1)%4][1]-q[i][1]));
    return m;
  };
  // signed step across the line at (x,y) along outward normal (nx,ny):
  // mean inside minus mean outside, and the inside level for the relative test
  const step = (x,y,nx,ny) => {
    let si=0, so=0;
    for(let j=1;j<=o.depth;j++){
      const a = sampleAt(g,w,h, x-nx*(j-0.5), y-ny*(j-0.5));
      const b = sampleAt(g,w,h, x+nx*(j-0.5), y+ny*(j-0.5));
      if(a == null || b == null) return null;
      si += a; so += b;
    }
    return [(si-so)/o.depth, si/o.depth];
  };

  let C = [];
  /* Samples along a (possibly bowed) side that have an inside-brighter step
     within a pixel of it. The side's normal is the line's left normal, which
     for TL,TR,BR,BL winding points out of the quad. */
  const onEdge = k => {
    const c = k.c || [0,0,0], n = 64;
    const px0 = k.px, py0 = k.py, ux = k.dx, uy = k.dy, nx = -uy, ny = ux;
    // span the side between the current corners projected onto it
    let lo = Infinity, hi = -Infinity;
    for(const q of quad){
      const sv = (q[0]-px0)*ux + (q[1]-py0)*uy;
      const dv = (q[0]-px0)*nx + (q[1]-py0)*ny;
      if(Math.abs(dv) < 0.25*shortest(quad)){ lo = Math.min(lo, sv); hi = Math.max(hi, sv); }
    }
    if(!(hi > lo)) return 0;
    let hits = 0;
    for(let i=0;i<n;i++){
      const sv = lo + (hi-lo)*(0.08 + 0.84*i/(n-1));
      const dv = c[0] + c[1]*sv + c[2]*sv*sv;
      const dd = c[1] + 2*c[2]*sv, tl = Math.hypot(1, dd);
      const tx = (ux + nx*dd)/tl, ty = (uy + ny*dd)/tl;   // tangent
      const ox = ty, oy = -tx;                           // outward normal
      const bx = px0 + ux*sv + nx*dv, by = py0 + uy*sv + ny*dv;
      for(let e=-1;e<=1;e++){
        const st = step(bx+ox*e, by+oy*e, ox, oy);
        if(st && st[0] >= Math.max(o.minStep, o.relStep*st[1])){ hits++; break; }
      }
    }
    return hits;
  };

  let snappedSides = 0;
  for(const frac of o.passes){
    const R = Math.max(2, Math.min(o.maxReach, Math.round(frac*shortest(quad))));
    const L = [];
    C = [];
    snappedSides = 0;
    for(let i=0;i<4;i++){
      const A = quad[i], B = quad[(i+1)%4];
      const ex = B[0]-A[0], ey = B[1]-A[1];
      const len = Math.hypot(ex,ey);
      if(len < 8) return null;
      const ux = ex/len, uy = ey/len, nx = uy, ny = -ux;
      // hit[k][d+R]: is there an inside-brighter step at offset d?
      const S = o.samples, D = 2*R+1;
      const hit = new Uint8Array(S*D), mag = new Float32Array(S*D);
      const sk = new Float64Array(S);
      for(let k=0;k<S;k++){
        const t = o.skip + (1-2*o.skip)*k/(S-1);
        sk[k] = (t-0.5)*len;
        const px = A[0]+ex*t, py = A[1]+ey*t;
        for(let d=-R; d<=R; d++){
          const st = step(px+nx*d, py+ny*d, nx, ny);
          if(!st) continue;
          mag[k*D+d+R] = st[0];
          if(st[0] >= Math.max(o.minStep, o.relStep*st[1])) hit[k*D+d+R] = 1;
        }
      }
      // score every line d(s) = d0 + b*s; a sample counts if it hits within +-1
      let best = 0;
      const lines = [];
      for(let si=0; si<o.slopes; si++){
        const b = Math.tan((-o.slopeSpan + 2*o.slopeSpan*si/(o.slopes-1))*Math.PI/180);
        for(let d0=-R; d0<=R; d0++){
          let n = 0;
          for(let k=0;k<S;k++){
            const d = Math.round(d0 + b*sk[k]);
            if(d < -R-1 || d > R+1) continue;
            const base = k*D;
            if((d-1 >= -R && d-1 <= R && hit[base+d-1+R]) ||
               (d   >= -R && d   <= R && hit[base+d+R])   ||
               (d+1 >= -R && d+1 <= R && hit[base+d+1+R])) n++;
          }
          lines.push([n, d0, b]);
          if(n > best) best = n;
        }
      }
      /* No convincing edge on this side -- a dark passage of picture against
         dark masking, or a head in the way. Keep the side where it is rather
         than throw away the three sides that did snap. */
      if(best < o.minSupport*S){
        L.push({px:A[0], py:A[1], dx:ux, dy:uy});
        C.push({px:A[0], py:A[1], dx:ux, dy:uy, c:[0,0,0]});
        continue;
      }
      let pick = null;
      for(const ln of lines)
        if(ln[0] >= o.near*best && (!pick || ln[1] > pick[1] ||
           (ln[1] === pick[1] && ln[0] > pick[0]))) pick = ln;

      /* Sub-pixel: at each sample, the strongest inside-brighter step near
         the chosen line, refined by a parabola through its neighbours. Near
         is a few percent of the side, not a fixed pixel or two, because the
         edge of a curved screen leaves any straight line by that much at the
         ends -- and it is the ends that locate the corners. */
      const win = Math.max(2, Math.round(o.track*len));
      const pts = [];
      for(let k=0;k<S;k++){
        const dc = Math.round(pick[1] + pick[2]*sk[k]);
        let bj = null, bm = 0;
        for(let d=dc-win; d<=dc+win; d++){
          if(d < -R || d > R) continue;
          const j = k*D+d+R;
          if(hit[j] && mag[j] > bm){ bm = mag[j]; bj = d; }
        }
        if(bj == null) continue;
        let sub = 0;
        if(bj > -R && bj < R){
          const a1 = mag[k*D+bj-1+R], c1 = mag[k*D+bj+1+R], den = a1 - 2*bm + c1;
          if(Math.abs(den) > 1e-9) sub = Math.max(-0.5, Math.min(0.5, 0.5*(a1-c1)/den));
        }
        const t = sk[k]/len + 0.5, d = bj + sub;
        pts.push([A[0]+ex*t + nx*d, A[1]+ey*t + ny*d]);
      }
      const fit = fitLineRobust(pts, 1.0);
      if(!fit) return null;
      snappedSides++;
      // orient along the side, so the line's normal is the side's outward one
      if(fit.line.dx*ux + fit.line.dy*uy < 0){ fit.line.dx = -fit.line.dx; fit.line.dy = -fit.line.dy; }
      L.push(fit.line);
      /* A bow is only believed if more of the side sits on an edge along the
         curve than along the line, and if it is modest: a quadratic will also
         happily chase a patch of picture content along a third of the side. */
      let bow = fitBow(pts, fit.line);
      if(bow.c[2] !== 0){
        const half = len/2;
        const sag = Math.abs(bow.c[2])*half*half;
        if(sag > o.maxBow*len || onEdge(bow) < onEdge(fit.line)) bow = fitBow([], fit.line);
      }
      C.push(bow);
    }
    const next = [intersectLines(L[0],L[3]), intersectLines(L[0],L[1]),
                  intersectLines(L[2],L[1]), intersectLines(L[2],L[3])];
    if(next.some(q => !q) || !isConvexQuad(next)) return null;
    quad = next;
  }
  if(!snappedSides) return null;            // nothing in the image to snap to
  /* The corners of a curved screen are where its bowed edges meet, not where
     their best straight approximations do. Sides that showed no bow have a
     zero curvature term and this changes nothing for them. */
  const pairs = [[0,3],[0,1],[2,1],[2,3]];
  const bowed = pairs.map((pr,i) => meetBows(C[pr[0]], C[pr[1]], quad[i]));
  if(bowed.every(p => p) && isConvexQuad(bowed)) quad = bowed;
  return quad;
}

/* Boundary pixels of several labels in one pass over the label image. */
function boundaries(lab,w,h,ids){
  const want = new Map();
  for(const id of ids) want.set(id, []);
  for(let i=0;i<lab.length;i++){
    const pts = want.get(lab[i]);
    if(!pts) continue;
    const id = lab[i], x = i%w, y = (i/w)|0;
    if(x===0 || y===0 || x===w-1 || y===h-1 ||
       lab[i-1]!==id || lab[i+1]!==id || lab[i-w]!==id || lab[i+w]!==id)
      pts.push([x+0.5, y+0.5]);
  }
  return want;
}

const EDGE_OPTS = {minStep:4, band:0.035, depth:2};
const EDGE_TIGHT = {minStep:4, band:0.015, depth:2};

/* The whole detector. Returns {quad:[TL,TR,BR,BL], source, score} in the
   buffer's own pixel coordinates, or null when nothing usable is lit.

   One threshold and the largest blob is the right model for a dark
   auditorium and the wrong one almost everywhere else: in a lit room the
   biggest bright thing is the wall, and in a cinema a dark passage of picture
   splits the screen into pieces. So propose many candidates -- every sizeable
   blob at several thresholds around the given one -- and let the image decide
   between them by edgeSupport, which asks the one question a screen always
   answers yes to: is there a dark border all the way round?

   opts.search=false proposes from thr alone, for when the user has set the
   threshold by hand and means it. opts.snap passes options to snapEdges. */
function detectScreen(g,w,h,thr,opts){
  const o = Object.assign({search:true, levels:[0.35,0.5,0.7,1,1.3],
                           perLevel:6, minArea:0.002, keep:5,
                           sizeWeight:0.4}, opts||{});
  const N = w*h;
  /* opts.also: further {g, thr} buffers of the same image to propose from.
     Luma barely registers saturated blue -- a news channel on a TV is darker
     than the wall around it -- so the app also passes max(R,G,B). Neither
     channel is better everywhere, and each candidate is snapped and scored on
     the buffer that proposed it. */
  const sources = [{g:g, thr:thr}].concat(o.search && o.also ? o.also : []);
  const seeds = [];
  for(const src of sources){
  const levels = new Set();
  for(const k of (o.search ? o.levels : [1]))
    levels.add(Math.max(4, Math.min(251, Math.round(src.thr*k))));
  const g = src.g;
  for(const t of levels){
    const L = labelAll(g,w,h,t);
    const ids = L.area.map((a,i) => i).filter(i => L.area[i] >= Math.max(40, o.minArea*N))
                      .sort((p,q) => L.area[q]-L.area[p]).slice(0, o.perLevel);
    if(!ids.length) continue;
    const B = boundaries(L.lab,w,h,ids);
    for(const id of ids){
      const pts = B.get(id);
      const fit = minAreaRect(pts);
      if(!fit || !(fit.w > 4) || !(fit.h > 4)) continue;
      const grown = {cx:fit.cx, cy:fit.cy, w:fit.w+1, h:fit.h+1, t:fit.t};
      const quad = corners(grown);
      // a screen cut off by the frame cannot be measured, and the frame
      // itself is the commonest impostor: the wall touches every edge
      if(quad.some(p => p[0] < 1 || p[1] < 1 || p[0] > w-1 || p[1] > h-1)) continue;
      seeds.push({quad:quad, pts:pts, fit:fit, t:t, g:g,
                  e:edgeSupport(g,w,h,quad,EDGE_OPTS)});
    }
  }
  }
  if(!seeds.length) return null;

  const rank = c => c.e.score * Math.pow(quadArea(c.quad)/N, o.sizeWeight);
  seeds.sort((p,q) => rank(q) - rank(p));

  /* Each seed yields one candidate: itself or its snapped refinement. That
     choice is made on a tight band, which only an outline actually on the
     edge passes -- the loose band that lets edgeSupport recognise a screen
     from a rough seed also lets a rough seed score as well as a precise one.
     Candidates are then compared with each other on the loose band, so a
     curved screen, whose straight sides cannot sit on its edge everywhere,
     is not penalised against a smaller, flatter impostor. */
  const cands = [];
  for(const sd of seeds.slice(0, o.keep)){
    const g = sd.g;
    let pick = {quad:sd.quad, source:"rectangle", t:edgeSupport(g,w,h,sd.quad,EDGE_TIGHT)};
    let alt = snapEdges(g,w,h,sd.quad,o.snap), src = "snapped";
    if(!alt){ alt = refineQuad(sd.pts, sd.fit); src = "edge-fit"; }
    if(alt){
      const t = edgeSupport(g,w,h,alt,EDGE_TIGHT);
      // the snap is the better-informed estimate; only a clearly worse score
      // says it went astray
      if(t.score >= pick.t.score - 0.05) pick = {quad:alt, source:src, t:t};
    }
    pick.e = edgeSupport(g,w,h,pick.quad,EDGE_OPTS);
    cands.push(pick);
  }
  let best = cands[0];
  for(const c of cands) if(rank(c) > rank(best)) best = c;
  const out = {quad:best.quad, source:best.source, score:best.e.score};
  if(o.debug) out.cands = cands.map(c => ({quad:c.quad, source:c.source,
    score:c.e.score, sides:c.e.sides, rank:rank(c), area:quadArea(c.quad)/N}));
  return out;
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
        isConvexQuad, refineQuad, fitLine, fitLineRobust, intersectLines,
        snapEdges, fitBow, meetBows, sampleAt, median, otsu, brightestBlob, detectScreen, labelAll, edgeSupport, quadArea,
        cross3, dot3, norm3, unit3};
})();
