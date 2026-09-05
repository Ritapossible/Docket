/**
 * The Docket mark: a dot held inside a pair of brackets.
 *
 * It means what the product means - something contained by bounds it cannot leave. Brackets are
 * distinctive enough not to collide with a common glyph, which the first attempt did: an arrow
 * above a bar is the download icon everywhere, whatever it was meant to say. Three stacked bars
 * were the other candidate and would have read as a hamburger menu sitting next to a nav.
 *
 * Legible down to 20px, which is the only size test a masthead mark has to pass.
 */
export function Logo({size = 30}: {size?: number}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--purple)" />
      <path
        d="M13 8.5H9.4v15H13M19 8.5h3.6v15H19"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.9" fill="#fff" />
    </svg>
  );
}
