import mermaid from 'mermaid-compact';

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

let initialized = false;

export function ensureMermaidInitialized(): void {
  if (initialized) return;
  initialized = true;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'base',
    suppressErrorRendering: true,
    themeVariables: {
      background: cssVar('--vscode-editor-background', '#1e1e1e'),
      textColor: cssVar('--vscode-foreground', '#ffffff'),
      mainBkg: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      nodeBorder: cssVar('--vscode-editorWidget-border', '#888888'),
      lineColor: cssVar('--vscode-editor-foreground', '#cccccc'),
      primaryColor: cssVar('--vscode-button-background', '#3c3c3c'),
      primaryTextColor: cssVar('--vscode-button-foreground', '#ffffff'),
      primaryBorderColor: cssVar('--vscode-editorWidget-border', '#888888'),
      secondaryColor: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      tertiaryColor: cssVar('--vscode-dropdown-background', '#454545'),
      classText: cssVar('--vscode-foreground', '#ffffff'),
      labelColor: cssVar('--vscode-foreground', '#ffffff'),
      actorLineColor: cssVar('--vscode-editor-foreground', '#cccccc'),
      actorBkg: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      actorBorder: cssVar('--vscode-editorWidget-border', '#888888'),
      actorTextColor: cssVar('--vscode-foreground', '#ffffff'),
      fillType0: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      fillType1: cssVar('--vscode-button-background', '#3c3c3c'),
      fillType2: cssVar('--vscode-dropdown-background', '#454545'),
      fontSize: 'var(--vscode-font-size, 13px)',
      fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",
      noteTextColor: cssVar('--vscode-foreground', '#ffffff'),
      noteBkgColor: cssVar('--vscode-dropdown-background', '#454545'),
      noteBorderColor: cssVar('--vscode-editorWidget-border', '#888888'),
      critBorderColor: '#ff9580',
      critBkgColor: '#803d36',
      taskTextColor: cssVar('--vscode-foreground', '#ffffff'),
      taskTextOutsideColor: cssVar('--vscode-foreground', '#ffffff'),
      taskTextLightColor: cssVar('--vscode-foreground', '#ffffff'),
      sectionBkgColor: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      sectionBkgColor2: cssVar('--vscode-button-background', '#3c3c3c'),
      altBackground: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      linkColor: cssVar('--vscode-textLink-foreground', '#6cb6ff'),
      compositeBackground: cssVar('--vscode-editorWidget-background', '#2d2d2d'),
      compositeBorder: cssVar('--vscode-editorWidget-border', '#888888'),
      titleColor: cssVar('--vscode-foreground', '#ffffff'),
    },
  });
}

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

      ctx.fillStyle = cssVar('--vscode-editor-background', '#1e1e1e');
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
