/* Nominal 35mm-equivalent focal lengths, for files that carry no focal length.

   These are manufacturer nominal figures, not measurements. They exist so a
   user with a metadata-stripped file can name the lens they used instead of
   typing a number they may not know. Two things follow from that:

   - Every preset carries a tolerance, and the readout shows the resulting
     angular uncertainty. An assumption must not be able to look like a
     measurement.
   - The dominant error is not the value, it is picking the wrong entry. A
     phone has several lenses, they differ by up to 10x, and they all shoot
     the same pixel dimensions. So a remembered preset is always displayed by
     name next to the reading, never applied silently.

   Self-calibration still beats every row here -- see README. */
window.SA_LENS = (function(){
"use strict";

/* tol is a fractional uncertainty on f35, covering the manufacturer's
   rounding and variation within the family. It does NOT cover choosing the
   wrong lens, which no tolerance can. */
const PRESETS = [
  {id:"uw-13",     group:"Ultra-wide",  label:"Phone ultra-wide (0.5×)",
   f35:13,  tol:0.06, note:"iPhone and most Android ultra-wides report ~13 mm"},

  {id:"main-24",   group:"Main camera", label:"Phone main camera, 24 mm",
   f35:24,  tol:0.04, note:"iPhone 14 Pro and later 48 MP main; many recent Android"},
  {id:"main-26",   group:"Main camera", label:"Phone main camera, 26 mm",
   f35:26,  tol:0.04, note:"iPhone 11–13 and SE; the most common phone main camera"},
  {id:"main-28",   group:"Main camera", label:"Phone main camera, 28 mm",
   f35:28,  tol:0.06, note:"older phones and some compacts"},

  {id:"crop-48",   group:"Cropped",     label:"Phone 2× crop, 48 mm",
   f35:48,  tol:0.05, note:"the sensor-crop “2×” on a 48 MP main camera"},

  {id:"tele-77",   group:"Telephoto",   label:"Phone telephoto 3×, 77 mm",
   f35:77,  tol:0.05, note:"iPhone Pro 3×; similar Android tele modules"},
  {id:"tele-120",  group:"Telephoto",   label:"Phone telephoto 5×, 120 mm",
   f35:120, tol:0.05, note:"iPhone 15 Pro Max / 16 Pro tetraprism and similar"},
];

function byId(id){
  for(const p of PRESETS) if(p.id === id) return p;
  return null;
}

/* Distinct group names, in the order they first appear. */
function groups(){
  const seen = [], out = [];
  for(const p of PRESETS) if(seen.indexOf(p.group) < 0){ seen.push(p.group); out.push(p.group); }
  return out;
}

/* Fractional uncertainty to attach to an f35 of a given provenance.
   Calibrated values are measurements; EXIF is a rounded nominal; presets are
   a guess the user confirmed; a typed number is the user's own business. */
const TOL = {cal:0.005, exif:0.02, manual:0, preset:0.04};
function tolFor(kind, presetId){
  if(kind === "preset"){
    const p = byId(presetId);
    return p ? p.tol : TOL.preset;
  }
  return TOL[kind] != null ? TOL[kind] : 0;
}

return {PRESETS, byId, groups, tolFor, TOL};
})();
