export function decideSyncAction(parsed, match, settings = {}) {
  const reasons = [...(parsed.reviewReasons || [])];
  const mode = settings.syncMode || 'semi';
  const configured = settings.autoThreshold;
  const threshold = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured : 0.7;
  if (parsed.requiresReview) reasons.push('extraction_needs_review');
  if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) || parsed.confidence <= 0 || parsed.confidence < threshold || parsed.confidence > 1) reasons.push('low_confidence');
  if (!['submission', 'oa', 'interview', 'rejection', 'offer'].includes(parsed.eventType)) reasons.push('unknown_event');
  if (!parsed.company?.trim()) reasons.push('missing_company');
  if (!parsed.position?.trim()) reasons.push('missing_position');
  if (!['matched', 'new'].includes(match.kind)) reasons.push(`match_${match.kind}`);
  if (mode === 'strict') reasons.push('strict_mode');
  else if (mode === 'semi') {
    if (match.kind !== 'matched') reasons.push('semi_new_application');
    if (['offer', 'rejection'].includes(parsed.eventType)) reasons.push('semi_terminal_event');
  } else if (mode !== 'auto') reasons.push('unknown_sync_mode');
  return { action: reasons.length ? 'review' : 'apply', reasons: [...new Set(reasons)] };
}
