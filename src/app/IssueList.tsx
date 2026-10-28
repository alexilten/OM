import { useStudio } from './store';

const ICON = { error: '●', warning: '▲', info: 'i' } as const;

export function IssueList() {
  const issues = useStudio((s) => s.issues);
  const invalid = useStudio((s) => s.invalid);
  if (!issues.length) return null;
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <div className="issues">
      {invalid && <div className="issue-banner">Configuration invalid — showing the last valid model.</div>}
      {[...issues]
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
