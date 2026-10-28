import { useState } from 'react';
import { useStudio } from './store';

const ICON = { error: '●', warning: '▲', info: 'i' } as const;

export function IssueList() {
  const issues = useStudio((s) => s.issues);
  const invalid = useStudio((s) => s.invalid);
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  const count = (sev: keyof typeof order) => issues.filter((i) => i.severity === sev).length;
  const summary = (['error', 'warning', 'info'] as const)
    .filter((sev) => count(sev))
    .map((sev) => `${count(sev)} ${sev === 'info' ? 'note' : sev}${count(sev) > 1 ? 's' : ''}`)
    .join(' · ');
  const worst = count('error') ? 'error' : count('warning') ? 'warning' : 'info';
  // One collapsed row by default; errors (and an invalid configuration) still show at a glance.
  return (
    <div className="issues">
      {invalid && <div className="issue-banner">Configuration invalid — showing the last valid model.</div>}
      <button className={`issues-toggle ${worst}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="icon">{ICON[worst]}</span>
        <span>Notices</span>
        <span className="issues-summary">{summary}</span>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
      </button>
      {open && [...issues]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i, k) => (
          <div key={k} className={`issue ${i.severity}`} title={i.path}>
            <span className="icon">{ICON[i.severity]}</span>
            <span>{i.message}</span>
          </div>
        ))}
    </div>
  );
}
