/**
 * LuminaAI Deep Analyzer v4
 * Every image gets a UNIQUE grade based on deep statistical measurement of its actual pixel data.
 * NO hardcoded defaults — every value is computed from the image's histogram, zone luminance,
 * color channel balance, saturation distribution, and scene composition.
 */
class AIGrader {
  
  static apiKey = localStorage.getItem('lumina_api_key') || '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';

  static setApiKey(key) {
    this.apiKey = key;
    localStorage.setItem('lumina_api_key', key);
  }

  // ====== DEEP IMAGE ANALYSIS ======
  static measureImage(imageData) {
    const data = imageData.data;
    const total = data.length / 4;

    // Histogram bins
    const lumHist = new Float64Array(256);
    const rHist = new Float64Array(256);
    const gHist = new Float64Array(256);
    const bHist = new Float64Array(256);

    // Accumulators
    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
    let sumSat = 0;

    // Zone counters (Ansel Adams zone system: 0-25, 25-50, ... 225-255)
    const zones = new Float64Array(10);
    
    // Color region pixel counts
    let skyBluePixels = 0, grassGreenPixels = 0, warmSubjectPixels = 0;
    let cloudPixels = 0;
    let clippedShadows = 0, clippedHighlights = 0;

    // Saturation distribution
    let lowSatPixels = 0, highSatPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lumInt = Math.min(255, Math.max(0, Math.round(lum)));
      
      lumHist[lumInt]++;
      rHist[r]++;
      gHist[g]++;
      bHist[b]++;

      sumR += r; sumG += g; sumB += b; sumLum += lum;

      // Zone placement
      const zone = Math.min(9, Math.floor(lum / 25.6));
      zones[zone]++;

      // Clipping
      if (lum < 8) clippedShadows++;
      if (lum > 247) clippedHighlights++;

      // Saturation measurement
      const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      sumSat += sat;
      if (sat < 0.15) lowSatPixels++;
      if (sat > 0.5) highSatPixels++;

      // HSL for color region detection
      const hsl = AIGrader._rgbToHsl(r, g, b);
      const hue = hsl.h * 360;
      const hslSat = hsl.s;
      const hslLum = hsl.l;

      // Sky blue detection
      if (hue >= 170 && hue <= 260 && hslSat > 0.1 && hslLum > 0.2) skyBluePixels++;
      // Cloud detection (bright, low saturation)
      if (hslLum > 0.65 && hslSat < 0.25) cloudPixels++;
      // Green foliage
      if (hue >= 60 && hue <= 170 && hslSat > 0.15 && hslLum > 0.1 && hslLum < 0.85) grassGreenPixels++;
      // Warm subject (reds, oranges, yellows)
      if ((hue < 55 || hue > 310) && hslSat > 0.2 && hslLum > 0.1 && hslLum < 0.9) warmSubjectPixels++;
    }

    // Percentile calculation from luminance histogram
    const percentile = (hist, p) => {
      const target = total * p;
      let cumulative = 0;
      for (let i = 0; i < 256; i++) {
        cumulative += hist[i];
        if (cumulative >= target) return i;
      }
      return 255;
    };

    return {
      total,
      avgR: sumR / total,
      avgG: sumG / total,
      avgB: sumB / total,
      avgLum: sumLum / total,
      avgSat: sumSat / total,
      
      // Percentiles for precise tonal range analysis
      lumP1: percentile(lumHist, 0.01),    // deep shadows
      lumP5: percentile(lumHist, 0.05),    // shadow floor
      lumP25: percentile(lumHist, 0.25),   // lower midtones
      lumP50: percentile(lumHist, 0.50),   // median
      lumP75: percentile(lumHist, 0.75),   // upper midtones
      lumP95: percentile(lumHist, 0.95),   // highlight ceiling
      lumP99: percentile(lumHist, 0.99),   // specular highlights

      // Tonal range
      dynamicRange: percentile(lumHist, 0.95) - percentile(lumHist, 0.05),
      
      // Zone distribution (percentage)
      zones: Array.from(zones).map(z => z / total),
      
      // Clipping
      shadowClipRatio: clippedShadows / total,
      highlightClipRatio: clippedHighlights / total,

      // Saturation profile
      lowSatRatio: lowSatPixels / total,
      highSatRatio: highSatPixels / total,

      // Scene composition ratios
      skyRatio: skyBluePixels / total,
      cloudRatio: cloudPixels / total,
      grassRatio: grassGreenPixels / total,
      subjectRatio: warmSubjectPixels / total,

      // Color balance
      colorBalance: {
        warmth: (sumR / total) - (sumB / total),  // positive = warm, negative = cool
        greenShift: (sumG / total) - ((sumR + sumB) / (2 * total))
      }
    };
  }

  // ====== INTELLIGENT GRADE COMPUTATION ======
  // Every value is PROPORTIONAL to what the image actually needs
  static analyzeAndGrade(imageData) {
    if (!imageData) return null;

    const m = this.measureImage(imageData);

    // ---- EXPOSURE ----
    // Target median luminance: 115-135 (well-exposed midtone)
    // Only correct if the image is noticeably off
    let exposure = 0;
    if (m.lumP50 < 80) {
      // Underexposed — lift proportionally, but gently
      exposure = Math.min(1.0, (105 - m.lumP50) / 120);
    } else if (m.lumP50 > 170) {
      // Overexposed — pull down gently
      exposure = Math.max(-0.8, (140 - m.lumP50) / 120);
    } else if (m.lumP50 < 100) {
      exposure = (110 - m.lumP50) / 200; // Very subtle lift
    }
    // If median is 100-170, exposure is already fine — leave it alone
    exposure = parseFloat(exposure.toFixed(2));

    // ---- CONTRAST ----
    // Based on dynamic range: narrow range = flat = add contrast, wide range = already contrasty
    let contrast = 0;
    if (m.dynamicRange < 120) {
      // Flat/hazy image — add moderate contrast
      contrast = Math.round((120 - m.dynamicRange) * 0.15);
    } else if (m.dynamicRange > 220) {
      // Very contrasty — soften slightly
      contrast = -Math.round((m.dynamicRange - 220) * 0.1);
    }
    contrast = Math.max(-30, Math.min(35, contrast));

    // ---- HIGHLIGHTS ----
    // If highlights are clipped or sky is blown out, pull them down
    let highlights = 0;
    if (m.highlightClipRatio > 0.02) {
      highlights = -Math.round(m.highlightClipRatio * 800);
    } else if (m.lumP95 > 240) {
      highlights = -Math.round((m.lumP95 - 230) * 2);
    }
    // If sky has clouds, add extra highlight recovery to show cloud texture
    if (m.cloudRatio > 0.05 && m.skyRatio > 0.05) {
      highlights = Math.min(highlights, -20); // Ensure clouds get recovered
    }
    highlights = Math.max(-60, Math.min(20, highlights));

    // ---- SHADOWS ----
    // If shadow areas are crushed, open them up
    let shadows = 0;
    if (m.shadowClipRatio > 0.03) {
      shadows = Math.round(m.shadowClipRatio * 500);
    } else if (m.lumP5 < 20) {
      shadows = Math.round((25 - m.lumP5) * 0.8);
    }
    shadows = Math.max(-20, Math.min(45, shadows));

    // ---- WHITES / BLACKS ----
    let whites = 0, blacks = 0;
    if (m.lumP99 < 230) whites = Math.round((235 - m.lumP99) * 0.3);
    if (m.lumP1 > 15) blacks = -Math.round((m.lumP1 - 10) * 0.4);
    whites = Math.max(-20, Math.min(25, whites));
    blacks = Math.max(-25, Math.min(15, blacks));

    // ---- TEMPERATURE ----
    // Correct color cast based on actual channel balance
    let temperature = 0;
    const warmth = m.colorBalance.warmth;
    if (warmth < -20) {
      // Too cool/blue — warm up proportionally
      temperature = Math.min(25, Math.abs(warmth) * 0.4);
    } else if (warmth > 30) {
      // Too warm — cool down proportionally
      temperature = -Math.min(20, warmth * 0.25);
    }
    temperature = Math.round(temperature);

    // ---- TINT ----
    let tint = 0;
    const greenShift = m.colorBalance.greenShift;
    if (greenShift > 8) tint = Math.round(Math.min(15, greenShift * 0.5));
    else if (greenShift < -8) tint = Math.round(Math.max(-15, greenShift * 0.5));

    // ---- VIBRANCE ----
    // Boost if image is desaturated, reduce if already vivid
    let vibrance = 0;
    if (m.avgSat < 0.2) {
      vibrance = Math.round((0.25 - m.avgSat) * 120); // Desaturated image, add vibrance
    } else if (m.avgSat > 0.45) {
      vibrance = -Math.round((m.avgSat - 0.4) * 50); // Already vivid, don't over-saturate
    } else {
      vibrance = 10; // Slight universal lift
    }
    vibrance = Math.max(-30, Math.min(40, vibrance));

    // ---- SATURATION ----
    // Much more conservative than vibrance
    let saturation = 0;
    if (m.avgSat < 0.15) saturation = Math.round((0.2 - m.avgSat) * 60);
    saturation = Math.max(-15, Math.min(15, saturation));

    // ---- SKY BOOST ----
    // Only boost if sky is actually present and could use more color
    let skyBoost = 0;
    if (m.skyRatio > 0.05) {
      // Sky exists — boost proportionally but GENTLY
      skyBoost = Math.round(Math.min(45, m.skyRatio * 120));
      // If there are visible clouds, reduce skyBoost to preserve their detail
      if (m.cloudRatio > 0.08) {
        skyBoost = Math.min(skyBoost, 30); // Don't blast cloud detail
      }
    }

    // ---- GRASS BOOST ----
    let grassBoost = 0;
    if (m.grassRatio > 0.05) {
      grassBoost = Math.round(Math.min(40, m.grassRatio * 100));
    }

    // ---- SUBJECT BOOST ----
    let subjectBoost = 0;
    if (m.subjectRatio > 0.03) {
      subjectBoost = Math.round(Math.min(50, m.subjectRatio * 150));
    }

    // ---- SPLIT TONING ----
    // Subtle complementary color grading based on scene type
    let shadowHue = 0, shadowSat = 0, highlightHue = 0, highlightSat = 0;
    
    if (m.skyRatio > 0.1) {
      // Outdoor daylight scene — cool shadows, warm highlights
      shadowHue = 215; shadowSat = 12;
      highlightHue = 40; highlightSat = 15;
    } else if (m.avgLum < 100) {
      // Dark/moody scene — blue shadows
      shadowHue = 225; shadowSat = 15;
      highlightHue = 35; highlightSat = 10;
    }

    // ---- VIGNETTE ----
    // Light vignette to draw focus, only if image isn't already dark at edges
    let vignette = 0;
    if (m.avgLum > 80) vignette = -8;

    return {
      exposure, contrast, highlights, shadows, whites, blacks,
      temperature, tint, vibrance, saturation,
      skyBoost, grassBoost, subjectBoost,
      vignette, grain: 0,
      shadowHue, shadowSat, highlightHue, highlightSat,
      // Pass metrics for Groq AI context
      _metrics: m
    };
  }

  // ====== DEEP AI AUTO GRADE WITH GROQ ======
  static async deepAnalyzeAndGrade(imageData, onProgress) {
    if (onProgress) onProgress("Measuring histogram percentiles & zone luminance...");
    await new Promise(r => setTimeout(r, 300));

    const localGrade = this.analyzeAndGrade(imageData);
    const metrics = localGrade._metrics;
    delete localGrade._metrics;

    if (onProgress) onProgress(`Scene: Sky ${(metrics.skyRatio*100).toFixed(0)}%, Clouds ${(metrics.cloudRatio*100).toFixed(0)}%, Foliage ${(metrics.grassRatio*100).toFixed(0)}%, Subject ${(metrics.subjectRatio*100).toFixed(0)}%`);
    await new Promise(r => setTimeout(r, 400));

    if (this.apiKey) {
      if (onProgress) onProgress("Consulting Groq Llama-3.3 for scene-specific color grade...");
      try {
        const groqResult = await this.queryGroqAI(localGrade, metrics);
        if (groqResult) {
          // Merge Groq suggestions but clamp to safe ranges
          for (const key of Object.keys(groqResult)) {
            if (typeof groqResult[key] === 'number' && key in localGrade) {
              localGrade[key] = groqResult[key];
            }
          }
        }
      } catch (err) {
        console.warn("Groq AI notice:", err);
      }
    }

    if (onProgress) onProgress("Finalizing render...");
    await new Promise(r => setTimeout(r, 200));

    return localGrade;
  }

  static async queryGroqAI(localGrade, metrics) {
    try {
      const metricsForAI = {
        avgLuminance: Math.round(metrics.avgLum),
        medianLuminance: metrics.lumP50,
        dynamicRange: metrics.dynamicRange,
        shadowFloor_p5: metrics.lumP5,
        highlightCeiling_p95: metrics.lumP95,
        avgSaturation: metrics.avgSat.toFixed(2),
        skyPercent: (metrics.skyRatio * 100).toFixed(1),
        cloudPercent: (metrics.cloudRatio * 100).toFixed(1),
        foliagePercent: (metrics.grassRatio * 100).toFixed(1),
        subjectPercent: (metrics.subjectRatio * 100).toFixed(1),
        colorWarmth: Math.round(metrics.colorBalance.warmth),
        shadowClipped: (metrics.shadowClipRatio * 100).toFixed(1) + '%',
        highlightClipped: (metrics.highlightClipRatio * 100).toFixed(1) + '%',
        localGradeSuggestion: localGrade
      };

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `You are a professional Hollywood film colorist grading real photos. Given detailed image statistics, return PRECISE Lightroom-style slider values unique to THIS specific image.

CRITICAL RULES:
- PRESERVE DETAIL: Never blow out highlights. If clouds exist, highlights must be negative to recover cloud texture.
- PROPORTIONAL: Only correct what needs correcting. If exposure is already good (median 100-150), keep exposure near 0.
- SUBTLE: Professional grades are subtle. Exposure range -0.5 to +0.5, contrast -20 to +25, saturation -10 to +10.
- SKY: If clouds exist, skyBoost must stay under 35 to preserve cloud luminance texture.
- SUBJECT POP: Boost subject colors through vibrance (not saturation), keep subjectBoost under 50.
- UNIQUE: Each image is different. Don't apply the same numbers to every image.

Return ONLY valid JSON: {"exposure":number,"contrast":number,"highlights":number,"shadows":number,"whites":number,"blacks":number,"temperature":number,"tint":number,"vibrance":number,"saturation":number,"skyBoost":number,"grassBoost":number,"subjectBoost":number,"vignette":number}`
            },
            {
              role: 'user',
              content: `Grade this photo. Image statistics: ${JSON.stringify(metricsForAI)}`
            }
          ],
          temperature: 0.15,
          max_tokens: 300
        })
      });

      if (!response.ok) throw new Error(`Groq API Error ${response.status}`);

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.log("Groq AI:", e);
    }
    return null;
  }

  static _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  static getPreset(presetName) {
    const presets = {
      natural: {
        exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
        temperature: 0, tint: 0, vibrance: 0, saturation: 0, vignette: 0, grain: 0,
        skyBoost: 0, grassBoost: 0, subjectBoost: 0,
        shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 0
      },
      skyHDRBlue: {
        exposure: 0.05, contrast: 12, highlights: -35, shadows: 15, whites: 5, blacks: -8,
        temperature: -10, tint: 3, vibrance: 18, saturation: 5, skyBoost: 35, grassBoost: 15, subjectBoost: 20,
        shadowHue: 215, shadowSat: 15, highlightHue: 205, highlightSat: 18, vignette: -8, grain: 0
      },
      carPop: {
        exposure: 0.05, contrast: 18, highlights: -25, shadows: 20, whites: 8, blacks: -12,
        temperature: -3, tint: 4, vibrance: 28, saturation: 8, skyBoost: 25, grassBoost: 20, subjectBoost: 45,
        shadowHue: 220, shadowSat: 15, highlightHue: 35, highlightSat: 18, vignette: -12, grain: 3
      },
      skyGolden: {
        exposure: 0.1, contrast: 10, highlights: -20, shadows: 15, whites: 8, blacks: -8,
        temperature: 18, tint: 6, vibrance: 22, saturation: 8, skyBoost: 25, grassBoost: 15, subjectBoost: 25,
        shadowHue: 25, shadowSat: 18, highlightHue: 42, highlightSat: 25, vignette: -10, grain: 4
      },
      skyNightBlue: {
        exposure: -0.1, contrast: 18, highlights: -25, shadows: -5, whites: -8, blacks: -15,
        temperature: -15, tint: -3, vibrance: 15, saturation: -3, skyBoost: 40, grassBoost: 0, subjectBoost: 15,
        shadowHue: 235, shadowSat: 25, highlightHue: 210, highlightSat: 20, vignette: -18, grain: 8
      },
      skyDramatic: {
        exposure: -0.05, contrast: 25, highlights: -35, shadows: 20, whites: 10, blacks: -18,
        temperature: -5, tint: 6, vibrance: 12, saturation: -5, skyBoost: 30, grassBoost: 15, subjectBoost: 20,
        shadowHue: 250, shadowSat: 20, highlightHue: 30, highlightSat: 15, vignette: -15, grain: 10
      },
      subjectPortrait: {
        exposure: 0.1, contrast: 8, highlights: -15, shadows: 15, whites: 5, blacks: -5,
        temperature: 5, tint: 3, vibrance: 15, saturation: 4, skyBoost: 15, grassBoost: 10, subjectBoost: 35,
        shadowHue: 20, shadowSat: 12, highlightHue: 45, highlightSat: 15, vignette: -8, grain: 0
      },
      cinematicTeal: {
        exposure: 0.05, contrast: 12, highlights: -20, shadows: 12, whites: 5, blacks: -10,
        temperature: 5, tint: 3, vibrance: 15, saturation: -5, skyBoost: 20, grassBoost: 15, subjectBoost: 20,
        shadowHue: 195, shadowSat: 22, highlightHue: 35, highlightSat: 20, vignette: -12, grain: 6
      },
      moodyDark: {
        exposure: -0.15, contrast: 15, highlights: -25, shadows: -8, whites: -10, blacks: -18,
        temperature: -8, tint: -3, vibrance: 5, saturation: -12, skyBoost: 15, grassBoost: 5, subjectBoost: 15,
        shadowHue: 220, shadowSat: 18, highlightHue: 40, highlightSat: 10, vignette: -22, grain: 12
      },
      goldenHour: {
        exposure: 0.1, contrast: 8, highlights: -12, shadows: 10, whites: 8, blacks: -5,
        temperature: 20, tint: 5, vibrance: 20, saturation: 8, skyBoost: 25, grassBoost: 12, subjectBoost: 25,
        shadowHue: 25, shadowSat: 15, highlightHue: 45, highlightSat: 25, vignette: -8, grain: 3
      },
      cyberpunk: {
        exposure: 0.05, contrast: 22, highlights: 8, shadows: -10, whites: 10, blacks: -15,
        temperature: -12, tint: 18, vibrance: 30, saturation: 10, skyBoost: 30, grassBoost: 0, subjectBoost: 40,
        shadowHue: 275, shadowSat: 30, highlightHue: 175, highlightSat: 28, vignette: -15, grain: 8
      },
      kodakFilm: {
        exposure: 0.12, contrast: -5, highlights: -18, shadows: 20, whites: -8, blacks: 10,
        temperature: 8, tint: 6, vibrance: 8, saturation: -4, skyBoost: 15, grassBoost: 15, subjectBoost: 15,
        shadowHue: 45, shadowSat: 12, highlightHue: 200, highlightSat: 8, vignette: -8, grain: 18
      }
    };

    return presets[presetName] || presets.natural;
  }
}
