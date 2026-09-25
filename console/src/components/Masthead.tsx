import {Logo} from "./Logo.tsx";
import {href, ROUTES, type Route} from "../router.ts";

const REPO = "https://github.com/Ritapossible/Docket";

export function Masthead({route}: {route: Route}) {
  return (
    <header className="shell masthead">
      <a className="wordmark" href={href("")}>
        <Logo />
        <span>
          Docket<em>&nbsp;console</em>
        </span>
      </a>
      <nav aria-label="Primary">
        {(Object.keys(ROUTES) as Route[]).map((key) => (
          <a
            key={key}
            className={key === route ? "navlink current" : "navlink"}
            href={href(key)}
            aria-current={key === route ? "page" : undefined}
          >
            {ROUTES[key]}
          </a>
        ))}
        <a className="navlink external" href={REPO} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </nav>
    </header>
  );
}
