import { FileTextIcon } from 'lucide-react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';
import type { Attachment } from '@pi-code/shared/core/types';

export const AttachmentThumb: FC<Attachment> = (attachment) => {
  const isImage = attachment.kind === 'image';
  const dataUrl = isImage ? (attachment as { kind: 'image'; dataUrl: string }).dataUrl : undefined;

  return (
    <Tooltip content="Click to view">
      <div
        className="attachment-thumb"
        onClick={() => {
          useChatStore.getState().send({ type: 'open_attachment', attachment });
        }}
      >
        {isImage ? (
          <img src={dataUrl} alt="attachment" className="w-full h-full object-cover" />
        ) : (
          <FileTextIcon className="w-4 h-4 text-vscode-foreground" />
        )}
      </div>
    </Tooltip>
  );
};

export const AttachmentRow: FC<{ readonly attachments: readonly Attachment[] | undefined }> = ({ attachments }) => {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2 items-start">
      {attachments.map((attachment, idx) => (
        <AttachmentThumb key={idx} {...attachment} />
      ))}
    </div>
  );
};
