import mermaid from 'mermaid-compact';

const MERMAID_THEME = {
  background: '#1e1e1e',
  textColor: '#ffffff',
  mainBkg: '#2d2d2d',
  nodeBorder: '#888888',
  lineColor: '#cccccc',
  primaryColor: '#3c3c3c',
  primaryTextColor: '#ffffff',
  primaryBorderColor: '#888888',
  secondaryColor: '#2d2d2d',
  tertiaryColor: '#454545',
  classText: '#ffffff',
  labelColor: '#ffffff',
  actorLineColor: '#cccccc',
  actorBkg: '#2d2d2d',
  actorBorder: '#888888',
  actorTextColor: '#ffffff',
  fillType0: '#2d2d2d',
  fillType1: '#3c3c3c',
  fillType2: '#454545',
};

export function initializeMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'dark',
    suppressErrorRendering: true,
    themeVariables: {
      ...MERMAID_THEME,
      fontSize: 'var(--vscode-font-size, 13px)',
      fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",
      noteTextColor: '#ffffff',
      noteBkgColor: '#454545',
      noteBorderColor: '#888888',
      critBorderColor: '#ff9580',
      critBkgColor: '#803d36',
      taskTextColor: '#ffffff',
      taskTextOutsideColor: '#ffffff',
      taskTextLightColor: '#ffffff',
      sectionBkgColor: '#2d2d2d',
      sectionBkgColor2: '#3c3c3c',
      altBackground: '#2d2d2d',
      linkColor: '#6cb6ff',
      compositeBackground: '#2d2d2d',
      compositeBorder: '#888888',
      titleColor: '#ffffff',
    },
  });
}

initializeMermaid();

export function applyDeterministicFixes(code: string): string {
  return code
    .replace(/--&gt;/g, '-->')
    .replace(/```mermaid/g, '')
    .replace(/```/g, '')
    .trim();
}

export async function svgToPng(svgEl: SVGElement): Promise<string> {
  const svgClone = svgEl.cloneNode(true) as SVGElement;
  const viewBox = svgClone.getAttribute('viewBox')?.split(' ').map(Number) || [];
  const originalWidth = viewBox[2] || svgClone.clientWidth || 800;
  const originalHeight = viewBox[3] || svgClone.clientHeight || 600;

  const targetWidth = 2400;
  const scale = targetWidth / originalWidth;
  const scaledHeight = originalHeight * scale;

  svgClone.setAttribute('width', `${targetWidth}`);
  svgClone.setAttribute('height', `${scaledHeight}`);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgClone);
  const encodedSvg = encodeURIComponent(svgString).replace(/'/g, '%27').replace(/"/g, '%22');
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = scaledHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetWidth, scaledHeight);
      resolve(canvas.toDataURL('image/png', 1.0));
    };
    img.onerror = () => reject(new Error('Failed to load image for PNG conversion'));
    img.src = svgDataUrl;
  });
}
