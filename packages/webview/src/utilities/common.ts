const TIME_AGO = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatTimeAgo(ts: number): string {
  const diffSeconds = Math.round((ts - Date.now()) / 1000);

  if (Math.abs(diffSeconds) < 60) {
    return 'Just now';
  }

  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'minute'],
    [60 * 60, 'hour'],
    [60 * 60 * 24, 'day'],
  ];

  let value = diffSeconds;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [step, nextUnit] of divisions) {
    if (Math.abs(value) < step) break;
    value = Math.round(value / step);
    unit = nextUnit;
  }

  return TIME_AGO.format(value, unit);
}

export function downloadFile(filename: string, dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
