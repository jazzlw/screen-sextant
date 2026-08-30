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

/* ------------------------------- keystone --------------------------------- */
/* Build a synthetic off-centerline shot: place a real rectangle in 3D, rotate
   it away from fronto-parallel, project it, and check rectify() recovers the
   dimensions and geometry we started with. */
function project3(p, W, H, f){
  return [W/2 + p[0]*f/p[2], H/2 + p[1]*f/p[2]];
}
/* A screen `wide` x `tall` whose centre sits at distance `dist` along the
   camera axis, yawed by `yaw` and pitched by `pitch` about its own centre.
   yaw = 0 is fronto-parallel. */
function stageScreen(wide, tall, dist, yaw, pitch){
  const cy=Math.cos(yaw), sy=Math.sin(yaw);
  const cp=Math.cos(pitch), sp=Math.sin(pitch);
  // screen-local corners, TL TR BR BL, in a plane with +x right and +y down
  const local=[[-wide/2,-tall/2],[wide/2,-tall/2],[wide/2,tall/2],[-wide/2,tall/2]];
  return local.map(([u,v])=>{
    // yaw about the screen's vertical axis, then pitch about its horizontal one
    let x = u*cy,        y = v,        z = -u*sy;
    const y2 = y*cp - z*sp, z2 = y*sp + z*cp;
    return [x, y2, z2 + dist];
  });
}
const RSET = {W:4032, H:3024, f35:26};
const RF = RSET.W*RSET.f35/36;

t("rectify() reproduces the fronto-parallel answer exactly", () => {
  const pts3 = stageScreen(45, 45/2.39, 96, 0, 0);
  const quad = pts3.map(p => project3(p, RSET.W, RSET.H, RF));
  const rec = SA.rectify(quad, RSET.W, RSET.H, RSET.f35);
  ok(rec.ok, "rectify failed: " + rec.reason);
  const flat = SA.measure(SA.minAreaRect(quad), RSET.W, RSET.H, RSET.f35);
  near(rec.h, flat.h, 1e-6, "horizontal vs the rect path");
  near(rec.ar, 2.39, 1e-6, "aspect");
  near(rec.obliquity, 0, 1e-6, "obliquity");
  near(rec.skew, 0, 1e-6, "skew");
  near(SA.perpDistance(45, rec), 96, 1e-6, "distance");
  return "the general path degenerates to the simple one, to 1e-6";
});

t("rectify() recovers aspect and distance from an off-centerline seat", () => {
  const out=[];
  for(const yawDeg of [5, 15, 25, 35]){
    const pts3 = stageScreen(45, 45/2.39, 96, yawDeg*Math.PI/180, 0);
    const quad = pts3.map(p => project3(p, RSET.W, RSET.H, RF));
    const rec = SA.rectify(quad, RSET.W, RSET.H, RSET.f35);
    ok(rec.ok, "rectify failed at " + yawDeg + "deg: " + rec.reason);
    near(rec.ar, 2.39, 1e-6, "aspect at " + yawDeg + "deg");
    near(rec.obliquity, yawDeg, 1e-6, "obliquity at " + yawDeg + "deg");
    // yawing about the screen's own centre keeps the line-of-sight distance
    // at 96 while the perpendicular distance to the plane shrinks by cos(yaw)
    near(SA.perpDistance(45, rec), 96*Math.cos(yawDeg*Math.PI/180), 1e-6,
         "perpendicular distance at " + yawDeg + "deg");
    near(SA.centerDistance(45, rec), 96, 1e-6, "line-of-sight at " + yawDeg + "deg");
    near(rec.h, 2*Math.atan(45/192)*180/Math.PI, 1e-6, "head-on at " + yawDeg + "deg");
    out.push(yawDeg + "deg ok");
  }
  return out.join("  ") + "  (aspect, obliquity, distance and subtense all exact)";
});

t("rectify() handles yaw and pitch together", () => {
  const pts3 = stageScreen(45, 45/2.39, 96, 22*Math.PI/180, -9*Math.PI/180);
  const quad = pts3.map(p => project3(p, RSET.W, RSET.H, RF));
  const rec = SA.rectify(quad, RSET.W, RSET.H, RSET.f35);
  ok(rec.ok, "rectify failed: " + rec.reason);
  near(rec.ar, 2.39, 1e-6, "aspect");
  near(SA.perpDistance(45, rec), 96*Math.cos(22*Math.PI/180)*Math.cos(9*Math.PI/180), 1e-6,
       "perpendicular distance");
  near(SA.centerDistance(45, rec), 96, 1e-6, "line-of-sight");
  // combined obliquity is larger than either angle alone
  ok(rec.obliquity > 22 && rec.obliquity < 26, "obliquity was " + fmt(rec.obliquity));
  return "yaw 22 + pitch -9 -> obliquity " + fmt(rec.obliquity) + "deg, aspect still 2.39";
});

t("keystone is exactly the error the old fronto-parallel path made", () => {
  // The same shot read both ways: this is the size of the bug being fixed.
  const rows=[];
  for(const yawDeg of [10, 20, 30, 40]){
    const pts3 = stageScreen(45, 45/2.39, 96, yawDeg*Math.PI/180, 0);
    const quad = pts3.map(p => project3(p, RSET.W, RSET.H, RF));
    const rec = SA.rectify(quad, RSET.W, RSET.H, RSET.f35);
    const naive = SA.measure(SA.minAreaRect(quad), RSET.W, RSET.H, RSET.f35);
    const arErr = (naive.ar/rec.ar - 1)*100;
    const dErr  = (SA.distance(45, SA.minAreaRect(quad).w, naive.f)/96 - 1)*100;
    ok(Math.abs(arErr) > 0.5, "expected a real aspect error at " + yawDeg + "deg");
    rows.push(yawDeg+"deg: ar "+fmt(arErr)+"%, dist "+fmt(dErr)+"%");
  }
  return rows.join("   ");
});

t("rectify() reports skew when the focal length is wrong", () => {
  // Marking a true rectangle with a bad f35 breaks the perpendicularity the
  // rectification assumes -- which is exactly what `skew` is there to surface.
  // Needs pitch as well as yaw: under pure yaw the vertical edges stay
  // parallel in the image and symmetry pins the skew to zero for any f.
  const pts3 = stageScreen(45, 45/2.39, 96, 25*Math.PI/180, 14*Math.PI/180);
  const quad = pts3.map(p => project3(p, RSET.W, RSET.H, RF));
  const truth = SA.rectify(quad, RSET.W, RSET.H, RSET.f35);
  near(truth.skew, 0, 1e-6, "correct f35 should be square");
  const seen=[];
  for(const bad of [20, 33]){
    const r = SA.rectify(quad, RSET.W, RSET.H, bad);
    ok(Math.abs(r.skew) > 1, "f35=" + bad + " should show skew, got " + fmt(r.skew));
    seen.push(bad+"mm -> "+fmt(r.skew)+"deg");
  }
  return "correct f35 -> 0.000deg;  " + seen.join(", ");
});

t("rectify() refuses a crossed or degenerate quad instead of guessing", () => {
  const good = stageScreen(45,45/2.39,96,0,0).map(p=>project3(p,RSET.W,RSET.H,RF));
  const cases = {
    "bowtie":        [good[0], good[1], good[3], good[2]],
    "collapsed":     [good[0], good[0], good[0], good[0]],
    "three corners": good.slice(0,3),
    "null":          null,
  };
  for(const name in cases){
    const r = SA.rectify(cases[name], RSET.W, RSET.H, RSET.f35);
    ok(r && r.ok === false && r.reason, name + " should be rejected, got " + JSON.stringify(r));
  }
  return Object.keys(cases).length + " bad shapes rejected with a reason";
});

t("isConvexQuad accepts rectangles and rejects bowties", () => {
  ok(SA.isConvexQuad([[0,0],[10,0],[10,5],[0,5]]), "axis-aligned rectangle");
  ok(SA.isConvexQuad([[0,0],[10,1],[9,6],[1,5]]), "a keystoned quad");
  ok(!SA.isConvexQuad([[0,0],[10,0],[0,5],[10,5]]), "bowtie");
  ok(!SA.isConvexQuad([[0,0],[1,0],[2,0],[3,0]]), "collinear");
  ok(!SA.isConvexQuad([[0,0],[1,1]]), "too few points");
  return "winding checked all the way round";
});

t("centerDistance exceeds perpendicular distance off the centerline", () => {
  const flat = SA.rectify(stageScreen(45,45/2.39,96,0,0).map(p=>project3(p,RSET.W,RSET.H,RF)),
                          RSET.W, RSET.H, RSET.f35);
  near(SA.centerDistance(45, flat), SA.perpDistance(45, flat), 1e-6,
       "on the centerline the two agree");
  const out=[];
  for(const yawDeg of [20, 40]){
    const rec = SA.rectify(stageScreen(45,45/2.39,96,yawDeg*Math.PI/180,0)
                             .map(p=>project3(p,RSET.W,RSET.H,RF)),
                           RSET.W, RSET.H, RSET.f35);
    const perp = SA.perpDistance(45, rec), ctr = SA.centerDistance(45, rec);
    ok(ctr > perp, "center distance should exceed perpendicular at " + yawDeg + "deg");
    out.push(yawDeg+"deg: perp "+fmt(perp)+" vs line-of-sight "+fmt(ctr));
  }
  return out.join("   ");
});

/* ----------------------------- edge snapping ------------------------------ */
/* Render a screen into a luminance buffer: a quad of given interior brightness
   on a wall of given brightness, with optional dark bands inside the screen to
   reproduce the case the threshold mask cannot handle. */
function renderScene(w,h,quad,opts){
  opts = opts||{};
  const wall = opts.wall != null ? opts.wall : 40;
  const screen = opts.screen != null ? opts.screen : 180;
  const g = new Float64Array(w*h);
  const inside = (x,y) => {
    let sign = 0;
    for(let i=0;i<4;i++){
      const a=quad[i], b=quad[(i+1)%4];
      const z=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
      if(Math.abs(z) < 1e-12) continue;
      const t = z>0?1:-1;
      if(!sign) sign=t; else if(t!==sign) return false;
    }
    return true;
  };
  // fractional position across the quad, for placing dark bands
  const c = SA.quadCentroid(quad);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let v = wall;
    if(inside(x,y)){
      v = screen;
      for(const band of (opts.bands||[])){
        // band = {from,to,level} as a fraction down the quad
        const fy = (y - (quad[0][1]+quad[1][1])/2) /
                   (((quad[2][1]+quad[3][1])/2) - ((quad[0][1]+quad[1][1])/2));
        if(fy >= band.from && fy <= band.to) v = band.level;
      }
    }
    g[y*w+x] = v + (opts.noise ? ((x*7+y*13)%11 - 5)*opts.noise : 0);
  }
  return g;
}
function worstCorner(a,b){
  let m=0;
  for(let i=0;i<4;i++) m=Math.max(m, Math.hypot(a[i][0]-b[i][0], a[i][1]-b[i][1]));
  return m;
}

t("snapQuad recovers a screen from a deliberately wrong starting rectangle", () => {
  const W2=400, H2=300;
  const quad=[[110,70],[290,70],[290,220],[110,220]];
  const g = renderScene(W2,H2,quad,{noise:1});
  const out=[];
  // start from rects that are too small, too large, and offset
  for(const [dw,dh,dx,dy] of [[-16,-16,0,0],[14,14,0,0],[-10,8,6,-5],[0,0,0,0]]){
    const start={cx:200+dx, cy:145+dy, w:180+dw, h:150+dh, t:0};
    const got = SA.snapQuad(g,W2,H2,start);
    ok(got, "declined for start " + JSON.stringify([dw,dh,dx,dy]));
    const err = worstCorner(got, quad);
    ok(err < 1.5, "corner error " + fmt(err) + "px for start " + [dw,dh,dx,dy]);
    out.push(fmt(err));
  }
  return "worst corner error: " + out.join(", ") + " px";
});

t("snapQuad finds an edge the threshold mask cannot", () => {
  /* The measured failure: the picture is dark right at one edge, so the lit
     region stops short of the screen. The step from dark picture to lit wall
     is still there, which is what snapping uses. */
  const W2=400, H2=300;
  const quad=[[110,70],[290,70],[290,220],[110,220]];
  const g = renderScene(W2,H2,quad,{wall:40, screen:180,
                                    bands:[{from:0.78, to:1.0, level:70}], noise:1});
  // a rect fitted to the *lit* part only, as the mask would produce
  const litOnly = {cx:200, cy:(70+(70+150*0.78))/2, w:180, h:150*0.78, t:0};
  const naive = SA.corners(litOnly);
  ok(worstCorner(naive, quad) > 25, "setup: the mask-derived rect should be short");

  const got = SA.snapQuad(g,W2,H2,litOnly);
  ok(got, "snapQuad declined on the case it exists for");
  const err = worstCorner(got, quad);
  ok(err < 2, "corner error " + fmt(err) + "px");
  return "mask short by " + fmt(worstCorner(naive,quad)) + "px, snapped to " + fmt(err) + "px";
});

t("snapQuad handles a rolled screen", () => {
  const W2=460, H2=360;
  const r = {cx:230, cy:180, w:200, h:150, t:7*Math.PI/180};
  const quad = SA.corners(r);
  const g = renderScene(W2,H2,quad,{noise:1});
  const start = {cx:232, cy:177, w:186, h:140, t:5*Math.PI/180};
  const got = SA.snapQuad(g,W2,H2,start);
  ok(got, "declined on a rolled screen");
  const err = worstCorner(got, quad);
  ok(err < 2, "corner error " + fmt(err) + "px");
  return fmt(err) + "px on a 7-degree roll started from 5";
});

t("snapQuad declines when there is no edge to find", () => {
  const W2=300, H2=200;
  const flat = new Float64Array(W2*H2).fill(120);
  ok(SA.snapQuad(flat,W2,H2,{cx:150,cy:100,w:120,h:90,t:0}) === null, "uniform image");

  const noise = new Float64Array(W2*H2);
  for(let i=0;i<noise.length;i++) noise[i] = (i*2654435761 % 255);
  const got = SA.snapQuad(noise,W2,H2,{cx:150,cy:100,w:120,h:90,t:0});
  ok(got === null || SA.isConvexQuad(got), "noise produced a non-convex quad");

  ok(SA.snapQuad(null,W2,H2,{cx:150,cy:100,w:120,h:90,t:0}) === null, "no buffer");
  ok(SA.snapQuad(flat,W2,H2,{cx:150,cy:100,w:2,h:2,t:0}) === null, "degenerate rect");
  return "no edge, no quad";
});

t("sampleAt interpolates and refuses to read outside the image", () => {
  const g = [0,100, 200,300];                    // 2x2
  near(SA.sampleAt(g,2,2,0,0), 0, 1e-9, "corner");
  near(SA.sampleAt(g,2,2,1,0), 100, 1e-9, "corner");
  near(SA.sampleAt(g,2,2,0.5,0), 50, 1e-9, "halfway along the top");
  near(SA.sampleAt(g,2,2,0.5,0.5), 150, 1e-9, "centre");
  ok(SA.sampleAt(g,2,2,-0.01,0) === null, "left of the image");
  ok(SA.sampleAt(g,2,2,0,1.01) === null, "below the image");
  return "bilinear, bounds-checked";
});

t("fitLineRobust discards the outlier that would tilt the line", () => {
  const pts=[];
  for(let i=0;i<40;i++) pts.push([i*4, 100]);
  pts.push([80, 160], [84, 30]);                 // two samples off the edge
  const naive = SA.fitLine(pts);
  const robust = SA.fitLineRobust(pts, 1);
  ok(robust && robust.n < pts.length, "should have trimmed something");
  ok(robust.line.rms < naive.rms/3,
     "rms " + fmt(robust.line.rms) + " vs naive " + fmt(naive.rms));
  ok(Math.abs(robust.line.dy) < 0.02, "line should stay horizontal");
  return "kept " + robust.n + "/" + robust.of + ", rms " +
         fmt(naive.rms) + " -> " + fmt(robust.line.rms);
});

/* ---------------------- quad refinement from a rect fit ------------------- */
t("refineQuad recovers a keystoned quad from its boundary points", () => {
  const out=[];
  for(const yawDeg of [12, 24]){
    const quad = stageScreen(45,45/2.39,96,yawDeg*Math.PI/180,0)
                   .map(p=>project3(p,RSET.W,RSET.H,RF));
    // sample the quad's outline the way detect() collects boundary pixels
    const pts=[];
    for(let e=0;e<4;e++){
      const a=quad[e], b=quad[(e+1)%4];
      for(let i=0;i<=140;i++){
        const s=i/140;
        pts.push([a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s]);
      }
    }
    const r = SA.minAreaRect(pts);
    const got = SA.refineQuad(pts, r);
    ok(got, "refineQuad returned null at " + yawDeg + "deg");
    let worst=0;
    for(let i=0;i<4;i++)
      worst=Math.max(worst, Math.hypot(got[i][0]-quad[i][0], got[i][1]-quad[i][1]));
    ok(worst < 2, "worst corner error " + fmt(worst) + "px at " + yawDeg + "deg");
    const rec = SA.rectify(got, RSET.W, RSET.H, RSET.f35);
    near(rec.ar, 2.39, 0.01, "aspect via refined quad at " + yawDeg + "deg");
    out.push(yawDeg+"deg: worst corner "+fmt(worst)+"px, ar "+fmt(rec.ar));
  }
  return out.join("   ");
});

t("refineQuad ignores the boundaries of holes in the mask", () => {
  // A screen showing real content is not a solid blob: dark passages punch
  // holes, whose edges are boundary pixels too. Measured on a living-room
  // photo, 22% of the boundary points were interior. They must not pull the
  // sides inward.
  const quad = stageScreen(45,45/2.39,96,10*Math.PI/180,0)
                 .map(p=>project3(p,RSET.W,RSET.H,RF));
  const pts=[];
  for(let e=0;e<4;e++){
    const a=quad[e], b=quad[(e+1)%4];
    const n=Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]));   // one point per pixel
    for(let i=0;i<=n;i++){
      const s=i/n;
      pts.push([a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s]);
    }
  }
  const clean = SA.refineQuad(pts, SA.minAreaRect(pts));
  ok(clean, "setup: the clean outline should refine");

  // now add three interior holes, well inside the quad
  const c = SA.quadCentroid(quad);
  const holed = pts.slice();
  for(const [ox,oy,rad] of [[0,0,180],[-300,80,120],[260,-60,90]])
    for(let i=0;i<160;i++){
      const th=i/160*Math.PI*2;
      holed.push([c[0]+ox+rad*Math.cos(th), c[1]+oy+rad*0.6*Math.sin(th)]);
    }
  const withHoles = SA.refineQuad(holed, SA.minAreaRect(holed));
  ok(withHoles, "should still refine with holes present");
  let worst=0;
  for(let i=0;i<4;i++)
    worst=Math.max(worst, Math.hypot(withHoles[i][0]-clean[i][0],
                                     withHoles[i][1]-clean[i][1]));
  ok(worst < 2, "holes shifted the corners by " + fmt(worst) + "px");
  return "3 interior holes, 480 extra boundary points, corners moved " + fmt(worst) + "px";
});

t("refineQuad declines when a side is not actually a straight edge", () => {
  /* The real failure, reproduced. A living-room screen showing dark content
     at one edge produces a component whose boundary there follows the
     picture, not the screen. Fitting a line to it and calling it an edge
     turned a serviceable rectangle (aspect 0.60) into a quad reading aspect
     0.36 at 50 degrees of obliquity with a 12.8 degree skew -- confidently
     wrong, where declining leaves a usable answer. */
  const quad = stageScreen(45,45/2.39,96,0,0).map(p=>project3(p,RSET.W,RSET.H,RF));
  const pts=[];
  for(let e=0;e<4;e++){
    const a=quad[e], b=quad[(e+1)%4];
    for(let i=0;i<=200;i++){
      const s=i/200;
      // bite a ragged chunk out of the bottom edge, as dark content does
      if(e===2 && s>0.25 && s<0.8){
        const bite=90+70*Math.sin(s*37);
        pts.push([a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s - bite]);
      } else {
        pts.push([a[0]+(b[0]-a[0])*s, a[1]+(b[1]-a[1])*s]);
      }
    }
  }
  const r = SA.minAreaRect(pts);
  ok(r, "the rect should still fit");
  ok(SA.refineQuad(pts, r) === null,
     "a ragged side must be rejected, not fitted");
  return "ragged edge rejected; the rectangle stands";
});

t("fitLine reports the residual that makes rejection possible", () => {
  const straight=[], ragged=[];
  for(let i=0;i<80;i++){
    straight.push([i*3, 200]);
    ragged.push([i*3, 200 + (i%7)*11 - 33]);
  }
  const a = SA.fitLine(straight), b = SA.fitLine(ragged);
  near(a.rms, 0, 1e-9, "a straight line has no residual");
  ok(b.rms > 8, "a ragged one should, got " + fmt(b.rms));
  ok(a.n === 80 && b.n === 80, "point counts reported");
  return "straight rms " + fmt(a.rms) + " vs ragged " + fmt(b.rms);
});

t("refineQuad declines rather than returning a worse fit", () => {
  ok(SA.refineQuad([], null) === null, "no rect");
  ok(SA.refineQuad([[0,0]], {cx:0,cy:0,w:10,h:10,t:0}) === null, "too few points");
  // scattered noise should not produce four confident edges near the rect
  const noise=[];
  for(let i=0;i<400;i++) noise.push([(i*37)%500, (i*91)%300]);
  const r = SA.minAreaRect(noise);
  const got = SA.refineQuad(noise, r);
  ok(got === null || SA.isConvexQuad(got), "returned a non-convex quad from noise");
  return "null on thin or implausible input, so detect() keeps the rect";
});

t("fitLine finds the principal axis, including near-vertical", () => {
  const vert=[];
  for(let i=0;i<40;i++) vert.push([100 + (i%2?0.01:-0.01), i*3]);
  const lv = SA.fitLine(vert);
  ok(Math.abs(lv.dx) < 0.01, "vertical line direction was " + fmt(lv.dx));
  const diag=[];
  for(let i=0;i<40;i++) diag.push([i, i]);
  const ld = SA.fitLine(diag);
  ok(Math.abs(Math.abs(ld.dx)-Math.abs(ld.dy)) < 1e-6, "45 degree line");
  ok(SA.fitLine([[0,0],[1,1]]) === null, "too few points");
  return "ordinary least squares would have blown up on the vertical case";
});

t("intersectLines meets crossing lines and rejects parallel ones", () => {
  const a = {px:0, py:0, dx:1, dy:0};
  const b = {px:5, py:-3, dx:0, dy:1};
  const p = SA.intersectLines(a,b);
  near(p[0], 5, 1e-9, "x"); near(p[1], 0, 1e-9, "y");
  ok(SA.intersectLines(a, {px:0, py:9, dx:1, dy:0}) === null, "parallel");
  ok(SA.intersectLines(a, null) === null, "missing line");
  return "meets at (5, 0), declines parallel";
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

t("dump() names the container and finds the Exif segment", () => {
  const r = SA_EXIF.dump(makeExifJpeg(true, PHONE));
  ok(r.container === "JPEG", "container was " + r.container);
  ok(r.exifAt > 0, "should locate the TIFF header, got " + r.exifAt);
  ok(r.byteOrder.indexOf("little") > 0, "byte order was " + r.byteOrder);
  const names = r.ifds.map(i => i.name);
  ok(names.length >= 2, "expected IFD0 and the Exif sub-IFD, got " + names);
  const sub = r.ifds.find(i => i.name.indexOf("sub-IFD") >= 0);
  const f35 = sub.entries.find(e => e.tag === 0xA405);
  ok(f35 && f35.name === "FocalLengthIn35mmFilm", "f35 entry missing from the dump");
  ok(f35.value === 24, "f35 value was " + (f35 && f35.value));
  ok(f35.typeName === "SHORT", "f35 type was " + f35.typeName);
  return r.ifds.map(i => i.name + ":" + i.entries.length).join("  ");
});

t("dump() distinguishes the three ways a focal length can be absent", () => {
  // 1: not a JPEG at all -- a HEIC that never got transcoded
  const heic = new Uint8Array(24);
  heic.set([0,0,0,24], 0);
  "ftypheic".split("").forEach((c,i) => heic[4+i] = c.charCodeAt(0));
  const a = SA_EXIF.dump(heic.buffer);
  ok(a.container.indexOf("ISOBMFF") === 0, "HEIC container read as " + a.container);
  ok(a.exifAt < 0 && a.note, "should say why it found nothing");

  // 2: a JPEG carrying no Exif APP1 at all
  const bare = new Uint8Array([0xFF,0xD8, 0xFF,0xDB,0,4,1,2, 0xFF,0xD9]);
  const b = SA_EXIF.dump(bare.buffer);
  ok(b.container === "JPEG", "container was " + b.container);
  ok(b.exifAt < 0, "should find no Exif segment");
  ok(b.note.indexOf("stripped") > 0, "note was " + b.note);
  ok(b.segments.length >= 2, "should still list the markers it did find");

  // 3: Exif present, but the focal length tag is not in it
  const c = SA_EXIF.dump(makeExifJpeg(true, {make:"Apple", model:"iPhone", focal:6.86}));
  ok(c.exifAt > 0, "should find the Exif segment");
  const sub = c.ifds.find(i => i.name.indexOf("sub-IFD") >= 0);
  ok(sub && !sub.entries.some(e => e.tag === 0xA405), "f35 should be absent here");
  ok(sub.entries.some(e => e.tag === 0x920A), "but FocalLength should be present");
  return "HEIC / no-APP1 / no-tag all separable";
});

t("segments() lists JPEG markers and identifies APP segments", () => {
  const segs = SA_EXIF.segments(makeExifJpeg(true, PHONE, {leadingXmp:true}));
  const app1 = segs.filter(s => s.marker === "APP1");
  ok(app1.length === 2, "expected two APP1 segments, got " + app1.length);
  ok(app1[0].id.indexOf("http") === 0, "first APP1 should be XMP, id was " + app1[0].id);
  ok(app1[1].id.indexOf("Exif") === 0, "second APP1 should be Exif, id was " + app1[1].id);
  ok(segs[0].marker === "SOI", "should start at SOI");
  return segs.map(s => s.marker + (s.id ? "(" + s.id.slice(0,6) + ")" : "")).join(" ");
});

t("dump() never throws on malformed input", () => {
  for(const buf of [new ArrayBuffer(0), new ArrayBuffer(3),
                    new Uint8Array([0xFF,0xD8,0xFF,0xE1,0,4]).buffer,
                    makeExifJpeg(true, PHONE).slice(0, 30)]){
    const r = SA_EXIF.dump(buf);
    ok(r && typeof r.container === "string", "no report for a " + buf.byteLength + "-byte input");
  }
  return "4 malformed inputs, all reported rather than thrown";
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
  const base = {make:"Apple", model:"iPhone 15 Pro", focal:6.86};
  const a = SA_EXIF.deviceKey(base, 4032, 3024);
  const b = SA_EXIF.deviceKey(base, 8064, 6048);
  ok(a !== b, "pixel pitch changes with resolution, so the key must too");
  return a;
});

t("deviceKey separates the lenses of one phone", () => {
  // The trap: a phone's lenses differ by up to 10x and all shoot the same
  // pixel dimensions, so a body-only key would cross-apply calibrations.
  const body = {make:"Apple", model:"iPhone 15 Pro"};
  const keys = new Set();
  for(const lens of [
        {focal:2.22, lens:"iPhone 15 Pro back camera 2.22mm f/2.2"},
        {focal:6.86, lens:"iPhone 15 Pro back camera 6.86mm f/1.78"},
        {focal:15.66, lens:"iPhone 15 Pro back camera 15.66mm f/2.8"}]){
    const k = SA_EXIF.deviceKey({...body, ...lens}, 4032, 3024);
    ok(k, "should produce a key for " + lens.focal + "mm");
    keys.add(k);
  }
  ok(keys.size === 3, "expected 3 distinct keys, got " + keys.size + ": " + [...keys]);
  // the focal length alone is enough to separate them when LensModel is absent
  const noName = new Set([2.22, 6.86, 15.66].map(f =>
    SA_EXIF.deviceKey({...body, focal:f}, 4032, 3024)));
  ok(noName.size === 3, "focal length alone should separate lenses: " + [...noName]);
  return "ultra-wide, main and tele never share a key";
});

t("deviceKey refuses to key an unidentifiable file", () => {
  // No lens information means nothing trustworthy to cache against: saving a
  // calibration here would silently apply it to a different lens later.
  ok(SA_EXIF.deviceKey({make:null, model:null}, 100, 50) === null, "nothing known");
  ok(SA_EXIF.deviceKey({make:"Apple", model:"iPhone"}, 100, 50) === null,
     "body without lens is not enough");
  ok(SA_EXIF.deviceKey({focal:6.86}, 100, 50) === null, "lens without body is not enough");
  ok(SA_EXIF.deviceKey({make:"Apple", model:"iPhone", focal:6.86}, 100, 50) !== null,
     "body plus lens is enough");
  return "null rather than a key that would cross-apply";
});

t("strippedByCapture recognises the iOS in-page capture signature", () => {
  // Measured on an iPhone 16 Pro: in-page capture keeps orientation and pixel
  // dimensions, drops Make, Model and both focal lengths. A Camera-app photo
  // picked from the library keeps everything.
  const stripped = SA_EXIF.parse(makeExifJpeg(true, {orientation:6, pixelW:4032, pixelH:3024}));
  ok(stripped.hasExif === true, "the Exif block itself does survive");
  ok(SA_EXIF.strippedByCapture(stripped), "should recognise the stripped capture");

  const full = SA_EXIF.parse(makeExifJpeg(true, PHONE));
  ok(!SA_EXIF.strippedByCapture(full), "a full header must not be flagged");

  // no Exif at all is a different fault and must not be blamed on capture
  const none = SA_EXIF.parse(new Uint8Array([0xFF,0xD8,0xFF,0xD9]).buffer);
  ok(none.hasExif === false, "hasExif should be false with no segment");
  ok(!SA_EXIF.strippedByCapture(none), "no Exif is not the capture signature");

  // any one identifying tag surviving is enough to rule it out
  for(const extra of [{make:"Apple"}, {model:"iPhone"}, {focal:6.86}, {f35:24}]){
    const partial = SA_EXIF.parse(makeExifJpeg(true, {orientation:6, ...extra}));
    ok(!SA_EXIF.strippedByCapture(partial),
       "should not flag when " + Object.keys(extra)[0] + " survived");
  }
  return "signature is exact: Exif present, camera identity absent";
});

t("identifiable() agrees with deviceKey", () => {
  const cases = [
    [{}, false],
    [{make:"Apple"}, false],
    [{focal:6.86}, false],
    [{make:"Apple", focal:6.86}, true],
    [{model:"iPhone", lens:"main"}, true],
    [{make:"Apple", model:"iPhone", focal:0}, false],
  ];
  for(const [x, want] of cases){
    ok(SA_EXIF.identifiable(x) === want, JSON.stringify(x) + " -> expected " + want);
    ok((SA_EXIF.deviceKey(x, 100, 50) !== null) === want,
       JSON.stringify(x) + ": deviceKey and identifiable disagree");
  }
  return cases.length + " cases, the two functions never disagree";
});

/* ------------------------------ lens presets ------------------------------ */
t("every lens preset is well formed and plausible", () => {
  const ids = new Set();
  for(const p of SA_LENS.PRESETS){
    ok(p.id && !ids.has(p.id), "duplicate or missing id: " + p.id);
    ids.add(p.id);
    ok(p.label && p.group && p.note, "preset " + p.id + " is missing text");
    ok(SA_EXIF.plausibleF35(p.f35), "preset " + p.id + " has an implausible f35: " + p.f35);
    ok(p.tol > 0 && p.tol < 0.2, "preset " + p.id + " has a silly tolerance: " + p.tol);
    ok(SA_LENS.byId(p.id) === p, "byId failed for " + p.id);
  }
  ok(SA_LENS.byId("nope") === null, "unknown id should be null");
  return SA_LENS.PRESETS.length + " presets across " + SA_LENS.groups().length + " groups";
});

t("presets are ordered so no group is interleaved", () => {
  const seen = [];
  let last = null;
  for(const p of SA_LENS.PRESETS){
    if(p.group !== last){
      ok(seen.indexOf(p.group) < 0, "group " + p.group + " appears in two blocks");
      seen.push(p.group);
      last = p.group;
    }
  }
  return SA_LENS.groups().join(" / ");
});

t("tolerance ranks provenance in the right order", () => {
  const cal = SA_LENS.tolFor("cal"), exif = SA_LENS.tolFor("exif");
  const preset = SA_LENS.tolFor("preset", "main-26");
  ok(cal < exif, "a measurement should beat a rounded nominal");
  ok(exif < preset, "EXIF should beat a guess the user confirmed");
  ok(SA_LENS.tolFor("manual") === 0, "a typed number carries no claim");
  ok(SA_LENS.tolFor("preset", "nope") > 0, "unknown preset id still gets a tolerance");
  return "cal " + cal + " < exif " + exif + " < preset " + preset;
});

/* ------------------------- known limitations ------------------------------ */
known("no lens-distortion model", () =>
  "the pinhole model assumes straight lines stay straight. True enough for a " +
  "phone's main camera after the built-in correction, ~1% off-axis on an " +
  "ultrawide. A screen near the frame edge on an ultrawide is the worst case.");

known("skew cannot detect a wrong focal length under pure yaw", () =>
  "when one pair of screen edges stays parallel in the image, symmetry pins " +
  "the skew residual to zero for any f35, so the rectangle constraint carries " +
  "no information about focal length there. It only bites when both pairs converge.");

known("optical centre assumed at the image centre", () =>
  "true to well under a pixel of consequence on phone cameras, but it is an " +
  "assumption rather than a measurement");

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
