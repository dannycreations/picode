const TIME_AGO = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const TIME_DIVISIONS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
];

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTimeAgo(ts: number): string {
  const diffSeconds = Math.round((ts - Date.now()) / 1000);

  if (Math.abs(diffSeconds) < 60) {
    return 'Just now';
  }

  for (const [unit, secondsInUnit] of TIME_DIVISIONS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return TIME_AGO.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }

  return TIME_AGO.format(diffSeconds, 'second');
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject(new Error('File reading resulted in empty payload.'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
