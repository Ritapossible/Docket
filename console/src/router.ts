import {useEffect, useState} from "react";

/**
 * Hash routing, deliberately.
 *
 * The console is a static build with `base: "./"` and no catch-all rewrite, so it can be
 * served from a domain root, a sub-directory or a local file without configuration. Path
 * routing would need a rewrite on every host and would break the relative asset URLs that
 * make the build portable. A hash costs one character in the URL and removes all of that.
 */
export const ROUTES = {
  "": "Overview",
  architecture: "Architecture",
  "dcs-1": "DCS-1",
  "threat-model": "Threat model",
} as const;

export type Route = keyof typeof ROUTES;

function parse(hash: string): Route {
  const slug = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  return slug in ROUTES ? (slug as Route) : "";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      const next = parse(window.location.hash);
      setRoute(next);
      // A route change is a new page, so it starts at the top. Without this the reader lands
      // halfway down the next page at whatever offset the last one was scrolled to.
      window.scrollTo({top: 0, behavior: "instant" as ScrollBehavior});
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  useEffect(() => {
    const name = ROUTES[route];
    document.title = route === "" ? "Docket - mandate console" : `${name} - Docket`;
  }, [route]);

  return route;
}

/** Keeps the query string, which carries the mandate the console is watching. */
export function href(route: Route): string {
  return `${window.location.pathname}${window.location.search}#/${route}`;
}
