/**
 * Master 2D Canvas Color Engine v3
 * FIXED: Sky processing now preserves cloud detail by working in luminance-preserving color space.
 * Linear/Radial/Color masks with per-pixel exposure, saturation, temp, contrast adjustments.
 */
class ColorEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.originalImg = null;
    this.originalImageData = null;
    this.processedImageData = null;

    this.skyMaskMap = null;
    this.grassMaskMap = null;
    this.subjectMaskMap = null;
    this.customMaskMap = null;
    
    this.activeMaskType = null;
    this.sampledColor = null;
  }

  setImage(img) {
    this.originalImg = img;
    this.canvas.width = img.naturalWidth || img.width;
    this.canvas.height = img.naturalHeight || img.height;
    
    this.ctx.drawImage(img, 0, 0);
    this.originalImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.processedImageData = new ImageData(
      new Uint8ClampedArray(this.originalImageData.data),
      this.canvas.width,
      this.canvas.height
    );

    this.customMaskMap = new Float32Array(this.canvas.width * this.canvas.height);
    this.computeSemanticMasks();
  }

  // Semantic segmentation via HSL color analysis
  computeSemanticMasks() {
    if (!this.originalImageData) return;

    const data = this.originalImageData.data;
    const len = data.length / 4;
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.skyMaskMap = new Float32Array(len);
    this.grassMaskMap = new Float32Array(len);
    this.subjectMaskMap = new Float32Array(len);

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const idx = i / 4;
      const y = Math.floor(idx / width);
      const yRatio = y / height;

      const hsl = this.rgbToHsl(r, g, b);
      const hue = hsl.h * 360;
      const sat = hsl.s;
      const lum = hsl.l;

      // SKY: Blue/cyan hues in upper portion OR bright desaturated clouds
      // Use smooth vertical falloff so sky mask fades at horizon
      if (yRatio < 0.7) {
        const verticalWeight = Math.pow(1 - (yRatio / 0.7), 0.6);
        const isBlueSky = (hue >= 170 && hue <= 260 && sat > 0.08 && lum > 0.15);
        const isCloud = (lum > 0.6 && sat < 0.35);
        if (isBlueSky || isCloud) {
          this.skyMaskMap[idx] = Math.min(1.0, verticalWeight * (isBlueSky ? 0.9 : 0.5));
        }
      }

      // FOLIAGE: Green hues
      if (hue >= 60 && hue <= 170 && sat > 0.12 && lum > 0.08 && lum < 0.85) {
        this.grassMaskMap[idx] = Math.min(1.0, sat * 1.8);
      }

      // SUBJECT: Saturated warm hues (reds, oranges, yellows, magentas)
      if (((hue < 55 || hue > 310) && sat > 0.2 && lum > 0.1 && lum < 0.92) ||
          (sat > 0.45 && lum > 0.15 && lum < 0.85)) {
        this.subjectMaskMap[idx] = Math.min(1.0, sat * 1.4);
      }
    }
  }

  // Linear Gradient Mask (top-down, like Lightroom graduated filter)
  createLinearMask() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.customMaskMap = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      // Full at top, fades to zero at 60% height
      const weight = Math.max(0, 1 - (y / (height * 0.6)));
      for (let x = 0; x < width; x++) {
        this.customMaskMap[y * width + x] = weight;
      }
    }
    this.activeMaskType = 'linear';
  }

  // Radial Gradient Mask (center spotlight)
  createRadialMask() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2, cy = height / 2;
    const radius = Math.min(cx, cy) * 0.8;
    this.customMaskMap = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        this.customMaskMap[y * width + x] = Math.pow(Math.max(0, 1 - dist / radius), 1.5);
      }
    }
    this.activeMaskType = 'radial';
  }

  // Color Eyedropper Mask
  createColorSampleMask(targetR, targetG, targetB) {
    const data = this.originalImageData.data;
    const len = data.length / 4;
    this.customMaskMap = new Float32Array(len);
    for (let i = 0; i < data.length; i += 4) {
      const diff = Math.hypot(data[i] - targetR, data[i+1] - targetG, data[i+2] - targetB);
      if (diff < 80) {
        this.customMaskMap[i / 4] = Math.max(0, 1 - (diff / 80));
      }
    }
    this.activeMaskType = 'colorSample';
    this.sampledColor = { r: targetR, g: targetG, b: targetB };
  }

  setUserMaskFromCanvas(canvas) {
    if (!canvas || canvas.width === 0) {
      this.userMaskMap = null;
      return;
    }
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;
    this.userMaskMap = new Float32Array(len / 4);
    
    // Alpha channel holds the mask intensity (brush opacity)
    for (let i = 0, px = 0; i < len; i += 4, px++) {
      this.userMaskMap[px] = data[i + 3] / 255;
    }
  }

  extractSelection(selPath, mode) {
    if (!this.originalImageData || !selPath || selPath.length === 0) return null;

    const width = this.originalImg.width;
    const height = this.originalImg.height;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d');

    maskCtx.beginPath();
    if (mode === 'marquee') {
      const start = selPath[0];
      const end = selPath[selPath.length - 1];
      maskCtx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else {
      maskCtx.moveTo(selPath[0].x, selPath[0].y);
      for (let i = 1; i < selPath.length; i++) {
        maskCtx.lineTo(selPath[i].x, selPath[i].y);
      }
      maskCtx.closePath();
    }
    maskCtx.fillStyle = 'rgba(255, 255, 255, 1)';
    maskCtx.fill();

    const maskData = maskCtx.getImageData(0, 0, width, height).data;

    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (maskData[i + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;

    const extCanvas = document.createElement('canvas');
    extCanvas.width = boxW;
    extCanvas.height = boxH;
    const extCtx = extCanvas.getContext('2d');
    const extImgData = extCtx.createImageData(boxW, boxH);

    const origData = this.originalImageData.data;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const maskIdx = (y * width + x) * 4;
        if (maskData[maskIdx + 3] > 0) {
          const extIdx = ((y - minY) * boxW + (x - minX)) * 4;
          extImgData.data[extIdx] = origData[maskIdx];
          extImgData.data[extIdx + 1] = origData[maskIdx + 1];
          extImgData.data[extIdx + 2] = origData[maskIdx + 2];
          extImgData.data[extIdx + 3] = origData[maskIdx + 3];

          // Erase from original
          origData[maskIdx + 3] = 0;
        }
      }
    }

    extCtx.putImageData(extImgData, 0, 0);

    return {
      url: extCanvas.toDataURL('image/png'),
      x: minX,
      y: minY,
      width: boxW,
      height: boxH
    };
  }

  applyAdjustments(params, curveLUT = null) {
    if (!this.originalImageData) return;

    const src = this.originalImageData.data;
    const dst = this.processedImageData.data;
    const len = src.length;

    const exp = Math.pow(2, params.exposure || 0);
    const contrastVal = params.contrast || 0;
    const contrastFactor = contrastVal >= 0
      ? 1 + contrastVal / 100
      : 1 / (1 - contrastVal / 100);
    const temp = (params.temperature || 0) * 0.6;
    const tint = (params.tint || 0) * 0.5;
    const sat = 1 + (params.saturation || 0) / 100;
    const vib = (params.vibrance || 0) / 100;
    const shadowOffset = (params.shadows || 0) * 0.6;
    const highlightOffset = (params.highlights || 0) * 0.6;
    const whiteOffset = (params.whites || 0) * 0.7;
    const blackOffset = (params.blacks || 0) * 0.7;

    // Selective Color
    const skyBoost = (params.skyBoost || 0) / 100;
    const grassBoost = (params.grassBoost || 0) / 100;
    const subjectBoost = (params.subjectBoost || 0) / 100;

    // Mask controls
    const maskExp = Math.pow(2, params.maskExposure || 0);
    const maskSat = 1 + (params.maskSaturation || 0) / 100;
    const maskTemp = (params.maskTemp || 0) * 0.6;
    const maskContrast = (params.maskContrast || 0);

    // Split toning
    const shadowHue = params.shadowHue || 0;
    const shadowSatP = (params.shadowSat || 0) / 100;
    const highlightHue = params.highlightHue || 0;
    const highlightSatP = (params.highlightSat || 0) / 100;
    const sRGB = this.hslToRgb(shadowHue / 360, shadowSatP, 0.5);
    const hRGB = this.hslToRgb(highlightHue / 360, highlightSatP, 0.5);

    const vignette = (params.vignette || 0) / 100;
    const grain = params.grain || 0;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2, cy = height / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);

    for (let i = 0; i < len; i += 4) {
      const pxIdx = i / 4;
      let r = src[i], g = src[i + 1], b = src[i + 2];

      // 1. Exposure
      r *= exp; g *= exp; b *= exp;

      // 2. Temperature & Tint (subtle)
      r += temp; b -= temp; g += tint;

      // 3. Contrast (smooth S-curve approach, not hard clip)
      r = 128 + (r - 128) * contrastFactor;
      g = 128 + (g - 128) * contrastFactor;
      b = 128 + (b - 128) * contrastFactor;

      // 4. Highlights/Shadows/Whites/Blacks (luminance-aware)
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (lum < 128) {
        const w = (128 - lum) / 128;
        const lift = shadowOffset * w + blackOffset * w * w;
        r += lift; g += lift; b += lift;
        if (shadowSatP > 0) {
          r += (sRGB[0] - 128) * w * shadowSatP * 0.4;
          g += (sRGB[1] - 128) * w * shadowSatP * 0.4;
          b += (sRGB[2] - 128) * w * shadowSatP * 0.4;
        }
      } else {
        const w = (lum - 128) / 128;
        const pull = highlightOffset * w + whiteOffset * w * w;
        r += pull; g += pull; b += pull;
        if (highlightSatP > 0) {
          r += (hRGB[0] - 128) * w * highlightSatP * 0.4;
          g += (hRGB[1] - 128) * w * highlightSatP * 0.4;
          b += (hRGB[2] - 128) * w * highlightSatP * 0.4;
        }
      }

      // 5. SKY ENHANCEMENT — LUMINANCE-PRESERVING
      // The key fix: we enhance sky COLOR without touching luminance,
      // so cloud brightness variations (texture) are fully preserved.
      if (this.skyMaskMap && this.skyMaskMap[pxIdx] > 0 && skyBoost !== 0) {
        const skyW = this.skyMaskMap[pxIdx] * Math.abs(skyBoost);
        const skySign = skyBoost > 0 ? 1 : -1;

        // Calculate current luminance BEFORE any sky color change
        const preLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        // Shift color balance toward blue WITHOUT changing brightness
        r -= 12 * skyW * skySign;
        b += 20 * skyW * skySign;

        // Increase local micro-contrast in sky (dehaze clouds)
        const midpoint = preLum;
        r = midpoint + (r - midpoint) * (1 + 0.15 * skyW * skySign);
        g = midpoint + (g - midpoint) * (1 + 0.15 * skyW * skySign);
        b = midpoint + (b - midpoint) * (1 + 0.15 * skyW * skySign);

        // Restore original luminance to preserve cloud detail
        const postLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (postLum > 0) {
          const ratio = preLum / postLum;
          r *= ratio; g *= ratio; b *= ratio;
        }
      }

      // 6. FOLIAGE ENHANCEMENT — SELECTIVE SATURATION
      if (this.grassMaskMap && this.grassMaskMap[pxIdx] > 0 && grassBoost !== 0) {
        const gW = this.grassMaskMap[pxIdx] * Math.abs(grassBoost);
        const gSign = grassBoost > 0 ? 1 : -1;
        const gAvg = (r + g + b) / 3;
        // Boost green channel saturation, keep luminance
        g = gAvg + (g - gAvg) * (1 + 0.5 * gW * gSign);
        r = gAvg + (r - gAvg) * (1 - 0.1 * gW * gSign);
      }

      // 7. SUBJECT/CAR POP — WARM SATURATION BOOST
      if (this.subjectMaskMap && this.subjectMaskMap[pxIdx] > 0 && subjectBoost !== 0) {
        const sW = this.subjectMaskMap[pxIdx] * Math.abs(subjectBoost);
        const sSign = subjectBoost > 0 ? 1 : -1;
        const sAvg = (r + g + b) / 3;
        // Boost overall color saturation on subject regions
        r = sAvg + (r - sAvg) * (1 + 0.6 * sW * sSign);
        g = sAvg + (g - sAvg) * (1 + 0.4 * sW * sSign);
        b = sAvg + (b - sAvg) * (1 + 0.3 * sW * sSign);
      }

      // 8. USER MASK (BRUSH) ADJUSTMENTS
      if (this.userMaskMap && this.userMaskMap[pxIdx] > 0) {
        const mW = this.userMaskMap[pxIdx]; // 0.0 to 1.0 (opacity of the red brush)
        
        let mr = r, mg = g, mb = b;
        
        mr *= maskExp; mg *= maskExp; mb *= maskExp;
        
        if (maskContrast !== 0) {
          const mContF = maskContrast >= 0 ? 1 + maskContrast / 100 : 1 / (1 - maskContrast / 100);
          mr = ((mr / 255 - 0.5) * mContF + 0.5) * 255;
          mg = ((mg / 255 - 0.5) * mContF + 0.5) * 255;
          mb = ((mb / 255 - 0.5) * mContF + 0.5) * 255;
        }

        mr += maskTemp; mb -= maskTemp;

        if (maskSat !== 1) {
          const mAvg = (mr + mg + mb) / 3;
          mr = mAvg + (mr - mAvg) * maskSat;
          mg = mAvg + (mg - mAvg) * maskSat;
          mb = mAvg + (mb - mAvg) * maskSat;
        }

        r = r * (1 - mW) + mr * mW;
        g = g * (1 - mW) + mg * mW;
        b = b * (1 - mW) + mb * mW;
      }

      // 9. Active Custom Mask Layer Adjustments
      let maskWeight = 0;
      if (this.activeMaskType === 'sky' && this.skyMaskMap) maskWeight = this.skyMaskMap[pxIdx];
      else if (this.activeMaskType === 'subject' && this.subjectMaskMap) maskWeight = this.subjectMaskMap[pxIdx];
      else if (this.customMaskMap && this.customMaskMap[pxIdx]) maskWeight = this.customMaskMap[pxIdx];

      if (maskWeight > 0) {
        // Mask exposure
        const mExpFactor = 1 + (maskExp - 1) * maskWeight;
        r *= mExpFactor; g *= mExpFactor; b *= mExpFactor;

        // Mask temperature
        r += maskTemp * maskWeight;
        b -= maskTemp * maskWeight;

        // Mask contrast
        if (maskContrast !== 0) {
          const mCf = 1 + (maskContrast / 100) * maskWeight;
          const mid = (r + g + b) / 3;
          r = mid + (r - mid) * mCf;
          g = mid + (g - mid) * mCf;
          b = mid + (b - mid) * mCf;
        }

        // Mask saturation
        if (maskSat !== 1) {
          const mAvg = (r + g + b) / 3;
          const mSf = 1 + (maskSat - 1) * maskWeight;
          r = mAvg + (r - mAvg) * mSf;
          g = mAvg + (g - mAvg) * mSf;
          b = mAvg + (b - mAvg) * mSf;
        }
      }

      // 9. Tone Curves
      if (curveLUT) {
        r = curveLUT.r[Math.min(255, Math.max(0, Math.round(r)))];
        g = curveLUT.g[Math.min(255, Math.max(0, Math.round(g)))];
        b = curveLUT.b[Math.min(255, Math.max(0, Math.round(b)))];
      }

      // 10. Global Vibrance & Saturation
      const maxC = Math.max(r, g, b);
      const avgC = (r + g + b) / 3;
      const amtC = maxC > 0 ? (maxC - avgC) / 255 : 0;
      
      if (vib !== 0) {
        const vibFactor = 1 + vib * (1 - amtC);
        r = avgC + (r - avgC) * vibFactor;
        g = avgC + (g - avgC) * vibFactor;
        b = avgC + (b - avgC) * vibFactor;
      }

      if (sat !== 1) {
        r = avgC + (r - avgC) * sat;
        g = avgC + (g - avgC) * sat;
        b = avgC + (b - avgC) * sat;
      }

      // 11. Vignette
      if (vignette !== 0) {
        const px = pxIdx % width, py = Math.floor(pxIdx / width);
        const dist = Math.hypot(px - cx, py - cy);
        const vigFactor = 1 - Math.pow(dist / maxRadius, 2) * (vignette * 0.6);
        r *= vigFactor; g *= vigFactor; b *= vigFactor;
      }

      // 12. Film Grain
      if (grain > 0) {
        const noise = (Math.random() - 0.5) * grain * 0.6;
        r += noise; g += noise; b += noise;
      }

      dst[i]     = r < 0 ? 0 : (r > 255 ? 255 : r | 0);
      dst[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g | 0);
      dst[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b | 0);
      dst[i + 3] = src[i + 3];
    }

    this.ctx.putImageData(this.processedImageData, 0, 0);

    if (this.activeMaskType) this.renderMaskOverlay();
  }

  renderMaskOverlay() {
    const width = this.canvas.width, height = this.canvas.height;
    const overlay = this.ctx.getImageData(0, 0, width, height);
    const data = overlay.data;

    let maskMap = this.customMaskMap;
    if (this.activeMaskType === 'sky') maskMap = this.skyMaskMap;
    else if (this.activeMaskType === 'subject') maskMap = this.subjectMaskMap;
    if (!maskMap) return;

    for (let i = 0; i < data.length; i += 4) {
      const w = maskMap[i / 4];
      if (w > 0) {
        data[i]     = Math.min(255, data[i] + 140 * w);
        data[i + 1] = data[i + 1] * (1 - 0.55 * w);
        data[i + 2] = data[i + 2] * (1 - 0.55 * w);
      }
    }
    this.ctx.putImageData(overlay, 0, 0);
  }

  renderSplitView(splitXRatio, originalImageData) {
    if (!this.processedImageData || !originalImageData) return;
    const splitX = Math.floor(this.canvas.width * splitXRatio);
    this.ctx.putImageData(this.processedImageData, 0, 0);
    if (splitX > 0) {
      this.ctx.putImageData(originalImageData, 0, 0, 0, 0, splitX, this.canvas.height);
    }
  }

  calculateHistogram() {
    if (!this.processedImageData) return null;
    const data = this.processedImageData.data;
    const rH = new Uint32Array(256), gH = new Uint32Array(256), bH = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      rH[data[i]]++; gH[data[i+1]]++; bH[data[i+2]]++;
    }
    return { r: rH, g: gH, b: bH };
  }

  rgbToHsl(r, g, b) {
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

  hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      this.hueToRgb(p, q, h + 1/3) * 255,
      this.hueToRgb(p, q, h) * 255,
      this.hueToRgb(p, q, h - 1/3) * 255
    ];
  }

  hueToRgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
}
