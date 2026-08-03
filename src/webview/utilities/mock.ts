import type { ChatMessage } from '@extension/types/webview';

export interface ActiveTaskState {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheWrites?: number;
  readonly cacheReads?: number;
  readonly totalCost: number;
  readonly contextTokens: number;
  readonly contextLimit: number;
  readonly path?: string;
}

export function getMockTask(taskId: string): ActiveTaskState | null {
  if (taskId === 'task-sphere') {
    return {
      id: 'task-sphere',
      title: 'Make a spinning, glowing 3D sphere that responds to mouse movements. Make the app work in the browser.',
      tokensIn: 8420,
      tokensOut: 2450,
      totalCost: 0.142,
      contextTokens: 10870,
      contextLimit: 200000,
      messages: [
        {
          id: 'm1',
          sender: 'user',
          text: 'Make a spinning, glowing 3D sphere that responds to mouse movements. Make the app work in the browser.',
          ts: Date.now() - 3600000 * 2,
        },
        {
          id: 'm2',
          sender: 'assistant',
          ts: Date.now() - 3600000 * 2 + 10000,
          reasoning:
            'I need to create a Three.js page containing a canvas, lighting, and an interactive sphere that moves towards the cursor position.',
          text: "I'll create an HTML page containing a glowing 3D sphere rendered with Three.js that interacts with mouse hover coordinates.",
          cost: 0.052,
        },
        {
          id: 'm3',
          sender: 'tool',
          ts: Date.now() - 3600000 * 2 + 20000,
          text: 'write_to_file',
          toolName: 'write_to_file',
          toolArgs: 'path: index.html',
          diff: `+ <!DOCTYPE html>\n+ <html>\n+ <head>\n+   <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n+ </head>\n+ <body>\n+   <script>\n+     const scene = new THREE.Scene();\n+     const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);\n+     // Glowing sphere setup...\n+   </script>\n+ </body>\n+ </html>`,
          toolStatus: 'approval',
        },
      ],
    };
  } else if (taskId === 'task-portfolio') {
    return {
      id: 'task-portfolio',
      title: 'Create a portfolio website for a Python software developer',
      tokensIn: 4500,
      tokensOut: 1800,
      totalCost: 0.0845,
      contextTokens: 6300,
      contextLimit: 200000,
      messages: [
        {
          id: 'p1',
          sender: 'user',
          text: 'Create a portfolio website for a Python software developer',
          ts: Date.now() - 3600000 * 24,
        },
        {
          id: 'p2',
          sender: 'assistant',
          ts: Date.now() - 3600000 * 24 + 12000,
          reasoning:
            'Analyzing requirements for a Python backend engineer. Sections for FastAPI, Django projects, and interactive project cards are ideal.',
          text: "Certainly! I've designed a responsive developer portfolio showcasing Django, FastAPI, Flask, and database modeling projects.",
          cost: 0.041,
        },
        {
          id: 'p3',
          sender: 'tool',
          ts: Date.now() - 3600000 * 24 + 30000,
          text: 'write_to_file',
          toolName: 'write_to_file',
          toolArgs: 'path: portfolio.html',
          toolStatus: 'completed',
        },
        {
          id: 'p4',
          sender: 'checkpoint',
          ts: Date.now() - 3600000 * 24 + 31000,
          text: 'Checkpoint saved',
          checkpointHash: '7b4c2e9',
        },
        {
          id: 'p5',
          sender: 'assistant',
          ts: Date.now() - 3600000 * 24 + 40000,
          text: 'The portfolio website has been created successfully. All links and transitions are styled with Tailwind CSS.',
          cost: 0.0435,
        },
      ],
    };
  } else if (taskId === 'task-error') {
    return {
      id: 'task-error',
      title: 'Create a financial app mockup in the browser. Then test if it works',
      tokensIn: 1800,
      tokensOut: 600,
      totalCost: 0.031,
      contextTokens: 2400,
      contextLimit: 200000,
      messages: [
        {
          id: 'e1',
          sender: 'user',
          text: 'Create a financial app mockup in the browser. Then test if it works',
          ts: Date.now() - 3600000 * 48,
        },
        {
          id: 'e2',
          sender: 'assistant',
          ts: Date.now() - 3600000 * 48 + 8000,
          reasoning: 'I need to run the test suite to verify project state.',
          text: 'I will begin by running the test suite using `npm run test`.',
          cost: 0.031,
        },
        {
          id: 'e3',
          sender: 'tool',
          ts: Date.now() - 3600000 * 48 + 15000,
          text: 'npm run test',
          toolName: 'execute_command',
          toolArgs: 'command: npm run test',
          toolStatus: 'completed',
        },
        {
          id: 'e4',
          sender: 'error',
          ts: Date.now() - 3600000 * 48 + 20000,
          text: 'npm ERR! Missing script: "test"\n\nnpm ERR! A complete log of this run can be found in:\nnpm ERR!     /root/.npm/_logs/2024-02-29T12_00_00_000Z-debug-0.log',
          errorMessage:
            'npm ERR! Missing script: "test"\n\nnpm ERR! A complete log of this run can be found in:\nnpm ERR!     /root/.npm/_logs/2024-02-29T12_00_00_000Z-debug-0.log',
        },
      ],
    };
  }
  return null;
}
