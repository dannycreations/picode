import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';

interface ImageThumbProps {
  readonly url: string;
}

export const ImageThumb: FC<ImageThumbProps> = ({ url }) => (
  <Tooltip content="Click to view image">
    <div onClick={() => vscode?.postMessage({ type: 'open_image', dataUrl: url })} className="image-thumb">
      <img src={url} alt="attachment" className="w-full h-full object-cover" />
    </div>
  </Tooltip>
);
