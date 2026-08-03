import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ChatView } from '@extension/webview/components/chat/ChatView';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <ChatView />
    </StrictMode>,
  );
}
