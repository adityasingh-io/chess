import { Link } from "react-router";
import { MORE } from "../components/AppShell";

/** The sections that don't fit the phone's bottom bar. */
export default function More() {
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <section className="card">
        <div className="rows">
          {MORE.map((m) => (
            <Link key={m.to} className="row" to={m.to}>
              <span className="t">{m.name}</span><span className="s">{m.what}</span><span className="r" aria-hidden="true">›</span>
            </Link>
          ))}
          <div className="row" aria-disabled="true">
            <span className="t muted">Puzzles</span><span className="s">Your mistakes as puzzles, with spaced repetition</span>
            <span className="r"><span className="pill later">Phase 5</span></span>
          </div>
        </div>
      </section>
    </>
  );
}
