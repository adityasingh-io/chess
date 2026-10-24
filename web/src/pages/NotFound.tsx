import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="problem">
      <b>No page here.</b>
      <Link to="/">Back to the dashboard</Link>
    </div>
  );
}
