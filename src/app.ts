import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Triage } from './agents/triage/agent.ts';

const app = new Hono();

// Friendly landing page so "it's running" is visible in a browser.
app.get('/', (c) =>
  c.text(
    [
      'Incident Triage Agent is running.',
      '',
      'Send it a message (Terminal 2):',
      `  curl -X POST 'http://localhost:5173/agents/triage/demo-1' \\`,
      `    -H "Content-Type: application/json" \\`,
      `    -d '{"kind": "user", "body": "Triage INC-1003"}'`,
      '',
      'Read the reply:',
      `  curl 'http://localhost:5173/agents/triage/demo-1'`,
    ].join('\n'),
  ),
);

// Conversations live at POST/GET /agents/triage/<conversation-id>
app.route('/agents/triage', createAgentRouter(Triage));

export default app;
