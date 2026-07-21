const clampScore = (value) => Math.min(100, Math.max(0, Math.round(value)));

export function combineRoleScores(primaryScore, secondaryScore, secondaryWeight = 0.4) {
  const primary = clampScore(primaryScore);
  if (secondaryScore === undefined || secondaryScore === null) {
    return {
      primaryScore: primary,
      secondaryScore: null,
      secondaryBonus: 0,
      total: primary,
    };
  }

  const secondary = clampScore(secondaryScore);
  const safeWeight = Math.min(0.5, Math.max(0.3, Number(secondaryWeight) || 0.4));
  const secondaryBonus = Math.round(secondary * safeWeight);
  return {
    primaryScore: primary,
    secondaryScore: secondary,
    secondaryBonus,
    total: Math.min(100, primary + secondaryBonus),
  };
}
