// =====================================================================
//  OUTFIT RULES - all the numbers that decide which outfit you get.
//
//  How to edit:
//   - Change a number, save the file, then reload the app.
//   - In "scores", positive numbers are rewards and negative numbers
//     are penalties. Bigger = matters more.
//   - Turn on "Debug view" in the app's Settings tab to see exactly how
//     each rule added or removed points from an outfit.
//   - Temperatures are in °C and use the "feels like" temperature.
// =====================================================================

export const RULES = {

  // ---------- Weather: when do you need a layer or coat? ----------
  weather: {
    dayStartHour: 7,          // only look at the weather between these hours
    dayEndHour: 19,
    useColdestHour: false,    // true = dress for the coldest hour, false = the daytime average

    layerBelowC: 16,          // below this: add a layer (jumper, cardigan, overshirt)
    coatBelowC: 10,           // below this: a coat instead of a layer
    layerAndCoatBelowC: 5,    // below this: a layer AND a coat

    rainChancePercent: 50,    // rain chance (%) at any point in the day that counts as "rainy"
    rainTotalMm: 1,           // or this much total rain (mm) across the day
                              // rainy days always add a coat (ideally waterproof)

    // How warm (1-5) your clothes should be at each temperature.
    // Read top-down: the first line where the temperature is at least minC wins.
    warmthBands: [
      { minC: 24,  warmth: 1 },
      { minC: 18,  warmth: 2 },
      { minC: 12,  warmth: 3 },
      { minC: 6,   warmth: 4 },
      { minC: -99, warmth: 5 },
    ],
  },

  // ---------- Casual-to-smart slider ----------
  formality: {
    tolerance: 1,             // items within ±1 of the slider are allowed
    fallbackTolerance: 2,     // if nothing fits, widen to ±2 rather than show nothing
    accessoryFrom: 3,         // slider at this level or higher adds a belt/accessory
  },

  // ---------- Colour rules ----------
  colour: {
    maxColours: 2,                  // most non-neutral colours allowed in one outfit (hard rule)
    sameColourWithinDegrees: 20,    // two hues this close on the colour wheel count as the same colour
    analogousMaxDegrees: 60,        // hues up to this far apart are "analogous" (neighbours)
    complementaryMinDegrees: 150,   // hues at least this far apart are "complementary" (opposites)

    requireTopBottomContrast: true, // hard rule: top and bottom must differ in lightness
    minTopBottomContrast: 15,       // ...by at least this much (lightness is 0 = black to 100 = white)

    // How a detected colour is sorted into a neutral family.
    // h = hue 0-360, s = saturation 0-100, l = lightness 0-100.
    // Checked in this order; anything left over counts as "coloured".
    neutrals: {
      blackMaxL: 16,
      greyMaxS: 12,                 // very low saturation = grey (or white if light enough)
      whiteMinL: 85,
      navy:  { hMin: 200, hMax: 255, lMax: 32, sMin: 12 },
      denim: { hMin: 195, hMax: 235, sMin: 12, sMax: 60, lMin: 30, lMax: 70 },
      brown: { hMin: 0,   hMax: 45,  sMin: 15, sMax: 55, lMin: 16, lMax: 45 },
      beige: { hMin: 20,  hMax: 60,  sMin: 8,  sMax: 55, lMin: 50, lMax: 92 },
    },
  },

  // ---------- Pattern rules ----------
  pattern: {
    maxBold: 1,               // most bold-pattern pieces allowed in one outfit (hard rule)
  },

  // Style tags you can pick from when adding an item. Add or rename freely.
  styleTags: ['classic', 'smart casual', 'sporty', 'streetwear', 'minimal', 'outdoor'],

  // ---------- Scores (the points system) ----------
  scores: {
    colour: {
      allNeutral: 6,          // only neutrals: safe and always works
      singleAccent: 8,        // one colour with neutrals
      monochrome: 10,         // one colour repeated in different pieces
      analogous: 12,          // two neighbouring colours
      complementary: 12,      // two opposite colours
      clash: -12,             // two colours that are neither
      contrastMax: 6,         // up to this much for strong top/bottom lightness contrast
    },
    beltMatchesShoes: 8,
    beltClashesShoes: -12,
    patternMixPerExtra: -5,   // for each patterned piece after the first
    styleMatch: 15,           // full reward when every piece shares a style tag (scaled down when fewer do)
    formalityOffPerPoint: -4, // each step an item sits away from the slider
    warmthOffPerPoint: -3,    // each step an item is too warm or too cool for today
    rain: {
      waterproofCoat: 6,
      notWaterproofCoat: -20,
      waterproofShoes: 4,
      notWaterproofShoes: -4,
    },
    missingOuterwear: -15,    // weather needs a layer/coat but none are clean
    recentlyWorn: -12,        // per item worn yesterday; fades to 0 over recentDays
    recentDays: 7,
    sameOutfitRecently: -10,  // same top + bottom + shoes worn within sameOutfitDays
    sameOutfitDays: 14,
    novelty: 8,               // full bonus when no two pieces have ever been worn together
    tryNewNoveltyMultiplier: 4, // "Try something new" multiplies the novelty bonus by this
  },

  // ---------- Picking from the best outfits ----------
  selection: {
    poolSize: 12,             // Reshuffle picks from the top this-many outfits
    spread: 6,                // how evenly it picks: small = nearly always the best, big = more random
    tryNewSpread: 15,         // the spread used when "Try something new" is on
  },
};
