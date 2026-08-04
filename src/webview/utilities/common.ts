export function formatTimeAgo(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) {
    if (diffHours === 0) return 'Just now';
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}
