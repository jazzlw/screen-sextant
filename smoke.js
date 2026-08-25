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

/* Pull the inline script out of index.html and give it test hooks. */
const HTML = read("index.html");
const FOUND = HTML.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g);
if(!FOUND) throw new Error("no inline <script> found in index.html");
const INLINE = FOUND[FOUND.length-1].replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
const HOOKS = `
window.__t={update,handles,moveHandle,setF35,showCalState,calRead,calWrite,detect,defaultRect,
  getRect:()=>rect, setRect:r=>{rect=r;}, setImg:i=>{img=i;}, setF:v=>{f35=v;},
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
// a 2.39:1 screen 45ft wide at 96ft, centered
const half = 22.5*F/96, halfV = (22.5/2.39)*F/96;
const centered = {cx:W/2, cy:H/2, w:2*half, h:2*halfV, t:0};

t.setDims(W,H); t.setImg({}); t.setF(26);

check("update() runs and fills the primary readout", () => {
  t.setRect({...centered});
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
  t.setRect({...centered});
  $("sw").value = "45"; $("unit").value = "ft";
  t.update();
  ok($("dist").innerHTML.indexOf("96.0") === 0, "expected 96.0 ft, got " + $("dist").innerHTML);
  const ft = $("dist").innerHTML;
  $("sw").value = String(45*0.3048); $("unit").value = "m";
  t.update();
  ok($("dist").innerHTML.indexOf("29.3") === 0, "expected 29.3 m, got " + $("dist").innerHTML);
  return ft.replace(/<[^>]+>/g," ") + "  ->  " + $("dist").innerHTML.replace(/<[^>]+>/g," ");
});

check("framing note stays hidden when the screen is centered", () => {
  t.setRect({...centered});
  t.update();
  ok($("framing").className === "note", "className was " + $("framing").className);
  return "no divergence, no note";
});

check("framing note appears and escalates as the shot drifts off center", () => {
  const seen = [];
  for(const dx of [400, 900]){
    t.setRect({...centered, cx:centered.cx+dx});
    t.update();
    seen.push(dx + "px -> '" + $("framing").className + "'");
    ok($("framing").className.indexOf("on") >= 0, "note hidden at dx=" + dx);
  }
  ok($("framing").className.indexOf("warn") >= 0, "should escalate to warn at dx=900");
  ok($("framing").innerHTML.indexOf("Re-aim") > 0, "warn text should tell the user what to do");
  return seen.join("   ");
});

check("verdict text tracks the meter zones", () => {
  const zones = [];
  for(const w of [0.9, 1.22, 1.55, 1.99, 2.37]){
    const hw = half*w;
    t.setRect({...centered, w:2*hw});
    t.update();
    const deg = parseFloat($("needle")._child.textContent);
    zones.push(deg.toFixed(0) + "° " + $("verdict").innerHTML.match(/<strong>([^<]+)</)[1]);
  }
  ok(new Set(zones.map(z=>z.split(" ")[1])).size === 5, "expected 5 distinct verdicts: " + zones);
  return zones.join("  |  ");
});

check("needle stays inside the track at both extremes", () => {
  for(const w of [0.05, 6]){
    const hw = half*w;
    t.setRect({...centered, w:2*hw});
    t.update();
    const pos = parseFloat($("needle").style.left.match(/([\d.]+)%/)[1]);
    ok(pos >= 0 && pos <= 100, "needle at " + pos + "% for scale " + w);
  }
  return "clamped to 0-100%";
});

check("calibration round-trips through storage and can be forgotten", () => {
  STORE = {};
  t.setMeta({make:"Apple", model:"iPhone 15 Pro"}, "Apple iPhone 15 Pro@4032");
  t.setF(26);
  $("f35").value = "25.4";
  t.calWrite({...t.calRead(), "Apple iPhone 15 Pro@4032": 25.4});
  ok(t.calRead()["Apple iPhone 15 Pro@4032"] === 25.4, "did not persist");
  t.showCalState();
  ok($("calibRow").style.display === "flex", "calib row should show");
  ok($("calibNote").innerHTML.indexOf("25.4 mm") >= 0, "note was " + $("calibNote").innerHTML);
  return $("calibNote").innerHTML.replace(/<[^>]+>/g,"");
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
  for(const k of ["exif","cal","assumed","manual"]){
    t.setF35(26, k);
    seen.push(k + "='" + $("f35src").textContent + "'");
    ok($("f35src").textContent, "no label for " + k);
  }
  return seen.join("  ");
});

check("the 8 resize handles each follow the pointer", () => {
  for(let i=0;i<8;i++){
    t.setRect({...centered});
    const before = t.handles()[i];
    t.moveHandle(i, before[0]+40, before[1]+40);
    const after = t.handles()[i];
    ok(Math.abs(after[0]-(before[0]+40)) < 1e-6 || Math.abs(after[1]-(before[1]+40)) < 1e-6,
       "handle " + i + " did not follow: " + before + " -> " + after);
  }
  return "each handle moves the edges it sits on";
});

check("the rotation handle pivots the rect without resizing it", () => {
  const out = [];
  for(const deg of [5, -12, 30]){
    t.setRect({...centered});
    const rad = deg*Math.PI/180;
    // put the pointer where the rect's "up" axis should end up pointing
    const R = 500;
    t.moveHandle(8, centered.cx + R*Math.sin(rad), centered.cy - R*Math.cos(rad));
    const r = t.getRect();
    ok(Math.abs(r.w-centered.w) < 1e-6 && Math.abs(r.h-centered.h) < 1e-6,
       "rotation resized the rect at " + deg + "deg");
    ok(Math.abs(r.cx-centered.cx) < 1e-6 && Math.abs(r.cy-centered.cy) < 1e-6,
       "rotation moved the center at " + deg + "deg");
    ok(Math.abs(r.t*180/Math.PI - deg) < 1e-6,
       "wanted " + deg + "deg, got " + (r.t*180/Math.PI));
    out.push(deg + "deg ok");
  }
  return out.join("  ") + "  (size and center preserved)";
});

check("rotating the rect leaves every reported angle unchanged", () => {
  t.setRect({...centered});
  $("sw").value = "45"; $("unit").value = "ft";
  t.update();
  const flat = [$("hAng").innerHTML, $("vAng").textContent, $("dAng").textContent,
                $("aspect").innerHTML, $("dist").innerHTML];
  t.setRect({...centered, t: 7*Math.PI/180});
  t.update();
  const rolled = [$("hAng").innerHTML, $("vAng").textContent, $("dAng").textContent,
                  $("aspect").innerHTML, $("dist").innerHTML];
  for(let i=0;i<flat.length;i++)
    ok(flat[i] === rolled[i], "readout " + i + " changed: " + flat[i] + " -> " + rolled[i]);
  ok($("roll").innerHTML.indexOf("7.0") === 0, "roll cell should read 7.0, got " + $("roll").innerHTML);
  return "7 degrees of roll: V still " + rolled[1] + ", AR still " +
         rolled[3].replace(/<[^>]+>/g," ") + ", D still " + rolled[4].replace(/<[^>]+>/g," ");
});

check("moveHandle() cannot collapse the rect", () => {
  for(let i=0;i<9;i++){
    t.setRect({...centered});
    t.moveHandle(i, W/2, H/2);            // drag every handle to the center
    t.moveHandle(i, W/2, H/2);
    const b = t.getRect();
    ok(b.w >= 8 - 1e-9 && b.h >= 8 - 1e-9,
       "handle " + i + " collapsed the rect to " + b.w + "x" + b.h);
    ok(!Number.isNaN(b.cx+b.cy+b.w+b.h+b.t), "handle " + i + " produced NaN");
  }
  return "8px floor holds on every handle";
});

check("a degenerate box does not produce NaN in the readout", () => {
  t.setRect({cx:100, cy:100, w:8, h:8, t:0});
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
    const r = t.getRect();
    const ar = r.w/r.h;
    ok(Math.abs(r.t*180/Math.PI - phi) < 0.4,
       "roll at " + phi + "deg came back " + (r.t*180/Math.PI).toFixed(2));
    ok(Math.abs(ar/2.39 - 1) < 0.02,
       "aspect at " + phi + "deg came back " + ar.toFixed(3));
    // center maps back to native resolution: 260 / (520/4032)
    ok(Math.abs(r.cx - 260*4032/520) < 12, "cx at " + phi + "deg was " + r.cx.toFixed(0));
    out.push(phi + "deg -> " + (r.t*180/Math.PI).toFixed(2) + "deg, " + ar.toFixed(2) + ":1");
  }
  SCENE = null;
  return out.join("   ");
});

check("detect() falls back to a default rect on a blank frame", () => {
  SCENE = (w,h) => new Uint8ClampedArray(w*h*4);   // all black, no component
  t.detect(0);
  const r = t.getRect();
  ok(r && r.w > 0 && r.h > 0 && r.t === 0, "expected the default rect, got " + JSON.stringify(r));
  ok(Math.abs(r.cx - W/2) < 1e-9, "default should be centered");
  SCENE = null;
  return "centered default, " + r.w.toFixed(0) + "x" + r.h.toFixed(0);
});

print("\n" + (fails ? fails + " FAILED" : "all glue checks passed"));
