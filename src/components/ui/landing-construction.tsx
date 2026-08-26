/** Geometric construction behind the landing hero. Static under reduced motion. */
export function LandingConstruction() {
  return (
    <div className="landing-lines" aria-hidden="true">
      <div className="landing-lines__straight landing-lines__straight--h" />
      <div className="landing-lines__straight landing-lines__straight--v" />
      <div className="landing-lines__circle landing-lines__circle--x" />
      <div className="landing-lines__circle landing-lines__circle--y" />
      <div className="landing-lines__outer" />
    </div>
  );
}
