import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';

interface ImageThumbProps {
  readonly url: string;
}

export const ImageThumb: FC<ImageThumbProps> = ({ url }) => (
  <Tooltip content="Click to view image">
    <div onClick={() => useChatStore.getState().send({ type: 'open_image', dataUrl: url })} className="image-thumb">
      <img src={url} alt="attachment" className="w-full h-full object-cover" />
    </div>
  </Tooltip>
);

export const ImageThumbRow: FC<{ readonly images: readonly string[] }> = ({ images }) => {
  if (images.length === 0) return null;

  return (
    <div className="image-row">
      {images.map((img, idx) => (
        <ImageThumb key={idx} url={img} />
      ))}
    </div>
  );
};
