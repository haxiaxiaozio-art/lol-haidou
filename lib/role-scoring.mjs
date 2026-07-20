const clampScore = (value) => Math.min(100, Math.max(0, Math.round(value)));

export function combineRoleScores(primaryScore, secondaryScore) {
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
  const secondaryBonus = Math.round(secondary * 0.4);
  return {
    primaryScore: primary,
    secondaryScore: secondary,
    secondaryBonus,
    total: Math.min(100, primary + secondaryBonus),
  };
}
