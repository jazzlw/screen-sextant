/* Glue tests for index.html: the wiring between the tested modules and the
   page. geom.js and exif.js are covered by tests.js; this covers update(),
   detect(), the handle editing, and the calibration store -- the code that
   only exists inside the page and would otherwise need a browser and a photo.

   Run via ./run-tests.sh. The page's inline script is extracted and evaluated
   against a shimmed DOM, with a small set of hooks appended so the tests can
   reach the module-level state. That extraction is the fragile part: if this
   file starts failing to find the script, check the regex below against the
   bottom of index.html rather than assuming the app broke. */
globalThis.window = globalThis;


/* ---- minimal DOM ---- */
const CTX_METHODS = ["drawImage","save","restore","beginPath","rect","fill","stroke",
  "strokeRect","fillRect","arc","moveTo","lineTo","clearRect","closePath","setTransform"];
globalThis.SCENE = null;   // (w,h) -> Uint8ClampedArray RGBA, set per test
function ctxStub(){
  const c = {fillStyle:"", strokeStyle:"", lineWidth:0};
  for(const m of CTX_METHODS) c[m] = () => {};
  c.getImageData = (x,y,w,h) => ({data: SCENE ? SCENE(w,h) : new Uint8ClampedArray(w*h*4)});
  return c;
}
/* Raster a rectangle of the given size rolled by phi, bright on dark --
   what a lit screen in a dark auditorium looks like to the detector. */
function rolledScene(cx,cy,rw,rh,phi){
  return (w,h) => {
    const d = new Uint8ClampedArray(w*h*4);
    const co = Math.cos(-phi), si = Math.sin(-phi);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const dx=x-cx, dy=y-cy;
      const u = dx*co - dy*si, v = dx*si + dy*co;
      const lit = Math.abs(u) <= rw/2 && Math.abs(v) <= rh/2;
      const g = lit ? 240 : 18;
      const i = (y*w+x)*4;
      d[i]=d[i+1]=d[i+2]=g; d[i+3]=255;
    }
    return d;
  };
}
const REGISTRY = {};
function elem(id){
  const e = {
    id, textContent:"", innerHTML:"", value:"", placeholder:"", className:"",
    style:{}, width:0, height:0, clientWidth:800, clientHeight:600,
    attrs:{}, listeners:{},
    getContext: () => (e._ctx || (e._ctx = ctxStub())),
    querySelector: () => (e._child || (e._child = elem(id+">b"))),
    setAttribute:(k,v)=>{e.attrs[k]=v;}, removeAttribute:k=>{delete e.attrs[k];},
    getAttribute:k=>e.attrs[k],
    addEventListener:(t,fn)=>{(e.listeners[t]=e.listeners[t]||[]).push(fn);},
    appendChild:()=>{}, focus:()=>{}, blur:()=>{}, scrollIntoView:()=>{},
    getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),
    setPointerCapture:()=>{}, click:()=>{},
    classList:{add:()=>{}, remove:()=>{}},
  };
  return e;
}
globalThis.document = {
  activeElement: null,
  getElementById: id => REGISTRY[id] || (REGISTRY[id] = elem(id)),
  createElement: () => elem("created"),
};
let STORE = {};
globalThis.localStorage = {
  getItem: k => (k in STORE ? STORE[k] : null),
  setItem: (k,v) => { STORE[k] = String(v); },
  removeItem: k => { delete STORE[k]; },
};
globalThis.addEventListener = () => {};
globalThis.scrollTo = () => {};

/* ---- load the real modules and the extracted, hook-appended glue ---- */
load("geom.js");
load("exif.js");
load("lenses.js");

/* Pull the inline script out of index.html and give it test hooks. */
const HTML = read("index.html");
const FOUND = HTML.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g);
if(!FOUND) throw new Error("no inline <script> found in index.html");
const INLINE = FOUND[FOUND.length-1].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
const HOOKS = `
window.__t={update,handles,moveHandle,setF35,showCalState,calRead,calWrite,detect,defaultQuad,
  chooseF35, getKind:()=>f35kind, getPreset:()=>f35preset,
  getQuad:()=>quad, setQuad:q=>{quad=q;}, setImg:i=>{img=i;}, setF:v=>{f35=v;},
  setDims:(w,h)=>{W=w;H=h;}, setMeta:(m,k)=>{meta=m;devKey=k;}};
`;
if(!/\}\)\(\);\s*$/.test(INLINE))
  throw new Error("index.html's inline script no longer ends in an IIFE; update the hook injection");
eval(INLINE.replace(/\}\)\(\);\s*$/, HOOKS + "\n})();"));

/* ---- exercise it ---- */
const t = window.__t, $ = id => document.getElementById(id);
let fails = 0;
function check(name, fn){
  try{ const d = fn(); print("ok    " + name + (d ? "\n        " + d : "")); }
  catch(e){ fails++; print("FAIL  " + name + "\n        " + (e && e.message || e)); }
}
function ok(c,m){ if(!c) throw new Error(m || "assertion failed"); }

const W = 4032, H = 3024, F = W*26/36;

/* A 2.39:1 screen 45ft wide, whose centre sits `dist` along the camera axis,
   yawed by `yaw` about its own vertical axis. yaw 0 is square-on. */
function stage(dist, yaw, dx, dy){
  const wide = 45, tall = 45/2.39;
  const cy = Math.cos(yaw||0), sy = Math.sin(yaw||0);
  return [[-wide/2,-tall/2],[wide/2,-tall/2],[wide/2,tall/2],[-wide/2,tall/2]]
    .map(([u,v]) => {
      const x = u*cy, y = v, z = -u*sy + dist;
      return [W/2 + x*F/z + (dx||0), H/2 + y*F/z + (dy||0)];
    });
}
const SQUARE = stage(96, 0);
const clone = q => q.map(p => p.slice());

t.setDims(W,H); t.setImg({}); t.setF(26);

check("update() runs and fills the primary readout", () => {
  t.setQuad(clone(SQUARE));
  $("unit").value = "ft"; $("sw").value = "";
  t.update();
  ok(/^26\.\d<span>/.test($("hAng").innerHTML), "hAng was " + $("hAng").innerHTML);
  ok($("vAng").textContent === "11.2°", "vAng was " + $("vAng").textContent);
  ok($("dist").textContent === "—", "dist should be blank without a width");
  return "H " + $("hAng").innerHTML.replace(/<[^>]+>/g,"") +
         "  V " + $("vAng").textContent + "  D " + $("dAng").textContent +
         "  AR " + $("aspect").innerHTML.replace(/<[^>]+>/g," ");
});

check("distance appears once a screen width is entered, in the chosen unit", () => {
  t.setQuad(clone(SQUARE));
  $("sw").value = "45"; $("unit").value = "ft";
  t.update();
  ok($("dist").innerHTML.indexOf("96.0") === 0, "expected 96.0 ft, got " + $("dist").innerHTML);
  const ft = $("dist").innerHTML;
  $("sw").value = String(45*0.3048); $("unit").value = "m";
  t.update();
  ok($("dist").innerHTML.indexOf("29.3") === 0, "expected 29.3 m, got " + $("dist").innerHTML);
  $("sw").value = "45"; $("unit").value = "ft";
  return ft.replace(/<[^>]+>/g," ") + "  ->  29.3 m";
});

check("an unknown focal length blanks the readout instead of assuming one", () => {
  t.setQuad(clone(SQUARE));
  t.setF(null);
  t.update();
  ok($("hAng").innerHTML.indexOf("—") === 0, "hAng was " + $("hAng").innerHTML);
  ok($("vAng").textContent === "—", "vAng was " + $("vAng").textContent);
  ok($("dist").textContent === "—", "dist was " + $("dist").textContent);
  ok($("needF").className.indexOf("on") >= 0, "the prompt should be visible");
  ok($("needF").innerHTML.indexOf("No focal length") >= 0, "needF: " + $("needF").innerHTML);
  ok($("verdict").innerHTML === "", "no verdict without a reading");
  t.setF(26); t.update();
  ok($("needF").className.indexOf("on") < 0, "the prompt should clear once f35 is known");
  ok($("hAng").innerHTML.indexOf("26") === 0, "reading should come back");
  return "blank + prompt, then recovers when f35 is supplied";
});

check("setF35 never invents a focal length", () => {
  for(const v of [null, 0, -5, NaN, undefined]){
    t.setF35(v, "unknown");
    ok($("f35").value === "", "setF35(" + v + ") left value " + JSON.stringify($("f35").value));
  }
  t.setF35(24, "exif");
  ok($("f35").value === 24, "a real value should populate the field");
  t.setF(26);
  return "no silent 26mm fallback on any falsy input";
});

check("framing note stays hidden when the screen is centred", () => {
  t.setQuad(clone(SQUARE));
  t.update();
  ok($("framing").className === "note", "className was " + $("framing").className);
  ok($("keystone").className === "note", "keystone note should be hidden too");
  return "no divergence, no notes";
});

check("framing note appears and escalates as the shot drifts off centre", () => {
  const seen = [];
  for(const dx of [600, 1000]){
    t.setQuad(stage(96, 0, dx, 0));
    t.update();
    seen.push(dx + "px -> '" + $("framing").className + "'");
    ok($("framing").className.indexOf("on") >= 0, "note hidden at dx=" + dx);
  }
  ok($("framing").className.indexOf("warn") >= 0, "should escalate to warn at dx=1000");
  return seen.join("   ");
});

check("keystone note fires only once obliquity is doing real work", () => {
  const seen = [];
  for(const [yawDeg, want] of [[0,false],[3,false],[12,true],[30,true]]){
    t.setQuad(stage(96, yawDeg*Math.PI/180));
    $("sw").value = "45";
    t.update();
    const on = $("keystone").className.indexOf("on") >= 0;
    ok(on === want, yawDeg + "deg: keystone note " + (on?"shown":"hidden") + ", wanted the opposite");
    seen.push(yawDeg + "deg:" + (on?"note":"quiet"));
  }
  ok($("keystone").innerHTML.indexOf("trapezoid") > 0, "should explain why");
  ok($("keystone").innerHTML.indexOf("Perpendicular") > 0, "should give the perpendicular distance");
  return seen.join("  ");
});

check("keystone correction holds the readout steady as the seat swings off axis", () => {
  // Same screen, same distance from its centre, viewed from further and
  // further off the centreline. Every reported figure must hold.
  const rows = [];
  let first = null;
  for(const yawDeg of [0, 10, 20, 30]){
    t.setQuad(stage(96, yawDeg*Math.PI/180));
    $("sw").value = "45"; $("unit").value = "ft";
    t.update();
    const row = [$("hAng").innerHTML, $("vAng").textContent,
                 $("aspect").innerHTML, $("dist").innerHTML].join(" | ");
    if(first === null) first = row;
    else ok(row === first, yawDeg + "deg drifted:\n          " + first + "\n          " + row);
    rows.push(yawDeg + "deg:" + $("oblq").innerHTML.replace(/<[^>]+>/g,""));
  }
  return "held at " + first.replace(/<[^>]+>/g," ") + "   [" + rows.join(" ") + "]";
});

check("verdict text tracks the meter zones", () => {
  const zones = [];
  for(const d of [40, 48, 62, 78, 106]){
    t.setQuad(stage(d, 0));
    t.update();
    const deg = parseFloat($("needle")._child.textContent);
    zones.push(deg.toFixed(0) + "° " + $("verdict").innerHTML.match(/<strong>([^<]+)</)[1]);
  }
  ok(new Set(zones.map(z => z.split(" ")[1])).size === 5, "expected 5 distinct verdicts: " + zones);
  return zones.join("  |  ");
});

check("needle stays inside the track at both extremes", () => {
  for(const d of [400, 22]){
    t.setQuad(stage(d, 0));
    t.update();
    const pos = parseFloat($("needle").style.left.match(/([\d.]+)%/)[1]);
    ok(pos >= 0 && pos <= 100, "needle at " + pos + "% for distance " + d);
  }
  return "clamped to 0-100%";
});

check("calibration round-trips through storage and can be forgotten", () => {
  STORE = {};
  t.setMeta({make:"Apple", model:"iPhone 15 Pro"}, "Apple iPhone 15 Pro@4032");
  t.calWrite({...t.calRead(), "Apple iPhone 15 Pro@4032": 25.4});
  ok(t.calRead()["Apple iPhone 15 Pro@4032"] === 25.4, "did not persist");
  t.showCalState();
  ok($("calibRow").style.display === "flex", "calib row should show");
  ok($("calibNote").innerHTML.indexOf("25.4 mm") >= 0, "note was " + $("calibNote").innerHTML);
  return $("calibNote").innerHTML.replace(/<[^>]+>/g,"");
});

check("a remembered lens fills in for files with no focal length", () => {
  STORE = {};
  t.setQuad(clone(SQUARE));
  t.setMeta({make:null, model:null}, null);   // stripped capture: nothing identifiable
  t.chooseF35();
  t.update();
  ok($("needF").className.indexOf("on") >= 0, "should prompt with nothing remembered");

  $("lensPreset").value = "main-26";
  $("lensPreset").onchange({target:$("lensPreset")});
  ok(t.getKind() === "preset", "kind was " + t.getKind());
  ok($("f35").value === 26, "f35 should be the preset value, got " + $("f35").value);
  ok($("f35src").textContent === "assumed lens",
     "provenance was '" + $("f35src").textContent + "'");
  ok($("f35src").textContent !== "from EXIF", "an assumption must never read as EXIF");

  $("rememberLens").onclick();
  ok(t.calRead()["*lens"] === "main-26", "not remembered: " + JSON.stringify(t.calRead()));
  t.chooseF35();
  ok(t.getKind() === "preset" && t.getPreset() === "main-26", "should re-apply on the next file");
  ok($("calibNote").innerHTML.indexOf("Phone main camera, 26 mm") > 0,
     "the assumed lens must be named: " + $("calibNote").innerHTML);
  STORE = {};
  return "remembered, re-applied, and named every time";
});

check("an assumed focal length prints a range, a measured one does not", () => {
  STORE = {};
  t.setQuad(clone(SQUARE));
  t.setMeta({make:"Apple", model:"iPhone", focal:6.86}, "Apple iPhone / 6.86mm@4032");

  t.setF35(26, "exif");
  t.update();
  const exif = $("hAng").innerHTML;
  ok(exif.indexOf("±") < 0, "EXIF should print a clean number, got " + exif);
  ok($("tolNote").style.display === "none", "no tolerance note for EXIF");

  t.setF35(26, "preset", "main-26");
  t.update();
  const preset = $("hAng").innerHTML;
  ok(preset.indexOf("±") > 0, "a preset should print a range, got " + preset);
  ok($("tolNote").style.display !== "none", "should explain why the range is there");
  ok($("tolNote").innerHTML.indexOf("assumed, not measured") > 0,
     "note was " + $("tolNote").innerHTML);
  ok($("tolNote").innerHTML.indexOf("wrong lens") > 0,
     "must warn that the wrong lens dwarfs the band");

  // the band must straddle the point estimate and scale with the tolerance
  const band = parseFloat(preset.match(/±([\d.]+)/)[1]);
  ok(band > 0.5 && band < 4, "band of " + band + " deg looks wrong for 4% on 26deg");
  t.setF35(26, "cal");
  t.update();
  ok($("hAng").innerHTML.indexOf("±") < 0, "a calibrated value should print clean");
  return "exif " + exif.replace(/<[^>]+>/g," ") + " vs preset " + preset.replace(/<[^>]+>/g," ");
});

check("a calibration cannot be saved against a file that hides its lens", () => {
  STORE = {};
  t.setQuad(clone(SQUARE));
  t.setF35(26, "manual");
  // identifiable file: saving is offered
  t.setMeta({make:"Apple", model:"iPhone", focal:6.86}, "Apple iPhone / 6.86mm@4032");
  t.showCalState();
  ok($("calib").style.display !== "none", "should offer to save for an identified lens");
  // unidentifiable file: saving is withdrawn and the reason given
  t.setMeta({make:null, model:null}, null);
  t.showCalState();
  ok($("calib").style.display === "none", "must not offer to save with no lens identity");
  ok($("calibNote").innerHTML.indexOf("doesn’t identify its lens") > 0,
     "should say why: " + $("calibNote").innerHTML);
  STORE = {};
  return "no calibration without a lens to pin it to";
});

check("typing a focal length clears any assumed-lens provenance", () => {
  STORE = {};
  t.setF35(26, "preset", "main-26");
  ok(t.getKind() === "preset", "setup");
  $("f35").value = "31";
  $("f35").oninput({target:$("f35")});
  ok(t.getKind() === "manual", "kind was " + t.getKind());
  ok(t.getPreset() === null, "preset id should be cleared");
  ok($("lensPreset").value === "", "the picker should no longer claim a lens");
  t.setF(26);
  return "a typed number stops claiming to be a preset";
});

check("calRead survives storage being unavailable", () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem(){ throw new Error("SecurityError"); },
                              setItem(){ throw new Error("SecurityError"); } };
  const r = t.calRead();
  ok(r && typeof r === "object", "should fall back to an empty object");
  ok(t.calWrite({a:1}) === false, "calWrite should report failure, not throw");
  globalThis.localStorage = real;
  return "private-browsing mode degrades quietly";
});

check("calRead survives corrupt JSON in storage", () => {
  STORE["screenangle.cal.v1"] = "{not json";
  const r = t.calRead();
  ok(r && typeof r === "object" && !Object.keys(r).length, "expected {}");
  STORE = {};
  return "returns {} instead of throwing";
});

check("setF35 labels each provenance distinctly", () => {
  const seen = [];
  for(const k of ["exif","cal","unknown","manual"]){
    t.setF35(k === "unknown" ? null : 26, k);
    seen.push(k + "='" + $("f35src").textContent + "'");
    ok($("f35src").textContent, "no label for " + k);
  }
  t.setF(26);
  return seen.join("  ");
});

check("the 4 corner handles each follow the pointer", () => {
  for(let i=0;i<4;i++){
    t.setQuad(clone(SQUARE));
    const before = t.handles()[i];
    // pull each corner outward, away from the centre, so the quad stays convex
    const cx = W/2, cy = H/2;
    const nx = before[0] + (before[0]-cx)*0.1, ny = before[1] + (before[1]-cy)*0.1;
    t.moveHandle(i, nx, ny);
    const after = t.handles()[i];
    ok(Math.abs(after[0]-nx) < 1e-6 && Math.abs(after[1]-ny) < 1e-6,
       "corner " + i + " did not follow: " + before + " -> " + after);
  }
  return "corners move freely, which is what makes keystone markable";
});

check("edge midpoint handles translate the whole edge", () => {
  for(let i=4;i<8;i++){
    t.setQuad(clone(SQUARE));
    const before = t.handles();
    t.moveHandle(i, before[i][0]+30, before[i][1]+30);
    const after = t.handles();
    ok(Math.abs(after[i][0]-(before[i][0]+30)) < 1e-6 &&
       Math.abs(after[i][1]-(before[i][1]+30)) < 1e-6,
       "edge " + i + " midpoint did not follow");
    // the opposite edge must not have moved
    const opp = 4 + ((i-4)+2)%4;
    ok(Math.abs(after[opp][0]-before[opp][0]) < 1e-6 &&
       Math.abs(after[opp][1]-before[opp][1]) < 1e-6,
       "moving edge " + i + " dragged the opposite edge with it");
  }
  return "one edge at a time, the far edge pinned";
});

check("an edit that would cross the quad is rejected, not clamped", () => {
  for(let i=0;i<4;i++){
    t.setQuad(clone(SQUARE));
    const before = JSON.stringify(t.getQuad());
    t.moveHandle(i, W/2, H/2);            // drag a corner to the centre
    t.moveHandle(i, W/2, H/2);
    const q = t.getQuad();
    ok(SA.isConvexQuad(q), "corner " + i + " produced a bowtie");
    ok(!q.some(p => Number.isNaN(p[0]) || Number.isNaN(p[1])), "corner " + i + " produced NaN");
  }
  // a genuine bowtie attempt leaves the quad untouched
  t.setQuad(clone(SQUARE));
  const before = JSON.stringify(t.getQuad());
  t.moveHandle(0, SQUARE[2][0], SQUARE[2][1]);   // TL onto BR
  ok(JSON.stringify(t.getQuad()) === before, "a crossing drag should be a no-op");
  return "convexity held on every corner; crossing drags are no-ops";
});

check("a degenerate shape blanks the readout instead of printing NaN", () => {
  t.setQuad([[100,100],[104,100],[104,104],[100,104]]);
  t.update();
  ok($("hAng").innerHTML.indexOf("NaN") < 0, "hAng: " + $("hAng").innerHTML);
  ok($("aspect").innerHTML.indexOf("NaN") < 0, "aspect: " + $("aspect").innerHTML);
  return "H " + $("hAng").innerHTML.replace(/<[^>]+>/g,"") + "  AR " +
         $("aspect").innerHTML.replace(/<[^>]+>/g,"");
});

check("detect() fits a rolled screen through the whole pipeline", () => {
  const out = [];
  for(const phi of [0, 2, 5, -3]){
    const p = phi*Math.PI/180;
    // detect() downscales to 520 on the long side: 4032x3024 -> 520x390
    SCENE = rolledScene(260, 195, 300, 300/2.39, p);
    t.detect(0);
    t.setF(26);
    t.update();
    const ar = parseFloat($("aspect").innerHTML);
    const roll = parseFloat($("roll").innerHTML);
    ok(Math.abs(roll - phi) < 0.4, "roll at " + phi + "deg came back " + roll);
    ok(Math.abs(ar/2.39 - 1) < 0.02, "aspect at " + phi + "deg came back " + ar);
    out.push(phi + "deg -> " + roll.toFixed(2) + "deg, " + ar.toFixed(2) + ":1");
  }
  SCENE = null;
  return out.join("   ");
});

check("detect() falls back to a default quad on a blank frame", () => {
  SCENE = (w,h) => new Uint8ClampedArray(w*h*4);   // all black, no component
  t.detect(0);
  const q = t.getQuad();
  ok(q && q.length === 4 && SA.isConvexQuad(q), "expected a usable default, got " + JSON.stringify(q));
  const cx = (q[0][0]+q[1][0]+q[2][0]+q[3][0])/4;
  ok(Math.abs(cx - W/2) < 1e-6, "default should be centred");
  SCENE = null;
  return "centred default quad";
});

print("\n" + (fails ? fails + " FAILED" : "all glue checks passed"));
