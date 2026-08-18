import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import incidents from '../../shared/incidents.json';

// A typed tool is a phone the model is allowed to dial; the schema is the keypad.
// The model literally cannot call this tool with a malformed shape — Valibot
// rejects bad input before run() ever executes.
export const lookupIncident = defineTool({
  name: 'lookup_incident',
  description:
    'Look up one incident by its id (for example "INC-1003") and return everything we know about it: the affected service, who reported it, symptoms, and recent changes.',
  input: v.object({ incidentId: v.string() }),
  async run({ data }) {
    const id = data.incidentId.trim().toUpperCase();
    const incident = incidents.find((entry) => entry.id === id);

    // Graceful not-found: valid shape, bad content — handled in ordinary code.
    // No crash, no hallucinated incident.
    const output: LookupOutput = incident
      ? { found: true, incident }
      : {
          found: false,
          hint: `No such incident. Valid ids look like INC-1001 through INC-${1000 + incidents.length}.`,
        };

    return { output };
  },
});

type Incident = (typeof incidents)[number];
type LookupOutput = { found: true; incident: Incident } | { found: false; hint: string };
