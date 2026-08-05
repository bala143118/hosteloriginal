(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.FireDetectionUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeFireLabel(label) {
    return String(label || '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function isFireLabel(label) {
    const normalized = normalizeFireLabel(label);
    if (!normalized) {
      return false;
    }
    if (
      normalized === 'fire' ||
      normalized === 'flame' ||
      normalized === 'blaze' ||
      normalized === 'burning' ||
      normalized === 'combustion' ||
      normalized === 'embers' ||
      normalized === 'ember'
    ) {
      return true;
    }
    if (
      normalized.includes('no fire') ||
      normalized.includes('not fire') ||
      normalized.includes('fire extinguisher') ||
      normalized.includes('fire alarm') ||
      normalized.includes('smoke detector')
    ) {
      return false;
    }
    return (
      normalized.includes('fire') ||
      normalized.includes('flame') ||
      normalized.includes('blaze') ||
      normalized.includes('burning') ||
      normalized.includes('combust')
    );
  }

  function isSmokeLabel(label) {
    const normalized = normalizeFireLabel(label);
    if (!normalized) {
      return false;
    }
    if (
      normalized.includes('no smoke') ||
      normalized.includes('not smoke') ||
      normalized.includes('smoke detector')
    ) {
      return false;
    }
    return normalized === 'smoke' || normalized.includes('smoke');
  }

  function getHazardPrediction(predictions, threshold = 0.05) {
    if (!Array.isArray(predictions)) {
      return null;
    }

    const matches = predictions
      .filter((item) => {
        const confidence = Number(item?.confidence ?? item?.score ?? item?.conf ?? 0) || 0;
        return confidence >= threshold && (isFireLabel(item?.label) || isSmokeLabel(item?.label));
      })
      .sort((first, second) => {
        const firstIsFire = isFireLabel(first?.label) ? 1 : 0;
        const secondIsFire = isFireLabel(second?.label) ? 1 : 0;
        const firstConfidence = Number(first.confidence ?? first.score ?? first.conf ?? 0) || 0;
        const secondConfidence = Number(second.confidence ?? second.score ?? second.conf ?? 0) || 0;
        if (secondIsFire !== firstIsFire) {
          return secondIsFire - firstIsFire;
        }
        return secondConfidence - firstConfidence;
      });

    const primary = matches[0] || null;
    if (!primary) {
      return null;
    }

    const hasFire = matches.some((item) => isFireLabel(item?.label));
    const hasSmoke = matches.some((item) => isSmokeLabel(item?.label));
    const detectionType = hasFire && hasSmoke ? 'Fire and Smoke' : hasFire ? 'Fire' : 'Smoke';
    const detectionLabel = detectionType.toLowerCase();

    return {
      ...primary,
      detectionType,
      detectionLabel,
      hasFire,
      hasSmoke
    };
  }

  function shouldTriggerFireDetection(predictions, threshold = 0.05) {
    if (!Array.isArray(predictions)) {
      return false;
    }

    const firePrediction = predictions.find((item) => isFireLabel(item?.label));
    if (!firePrediction) {
      return false;
    }

    const confidence = Number(firePrediction.confidence ?? firePrediction.score ?? firePrediction.conf ?? 0) || 0;
    return confidence >= threshold;
  }

  return {
    normalizeFireLabel,
    isFireLabel,
    isSmokeLabel,
    getHazardPrediction,
    shouldTriggerFireDetection
  };
});
