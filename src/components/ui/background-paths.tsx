import { motion, useReducedMotion } from "motion/react";

function FloatingPaths({ position }: { position: number }) {
  const reduceMotion = useReducedMotion();
  // Fewer paths, stable opacity — opacity keyframes were the visible “flash”.
  const paths = Array.from({ length: 18 }, (_, index) => ({
    id: index,
    d: `M-${380 - index * 5 * position} -${189 + index * 6}C-${
      380 - index * 5 * position
    } -${189 + index * 6} -${312 - index * 5 * position} ${216 - index * 6} ${
      152 - index * 5 * position
    } ${343 - index * 6}C${616 - index * 5 * position} ${470 - index * 6} ${
      684 - index * 5 * position
    } ${875 - index * 6} ${684 - index * 5 * position} ${875 - index * 6}`,
    width: 0.5 + index * 0.04,
    duration: 28 + (index % 7) * 2.2,
    opacity: 0.1 + index * 0.012,
  }));

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg
        className="landing-background-paths h-full w-full"
        viewBox="0 0 696 316"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        <title>Held-thread background paths</title>
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="currentColor"
            strokeWidth={path.width}
            strokeOpacity={path.opacity}
            initial={false}
            animate={
              reduceMotion
                ? { pathOffset: 0 }
                : { pathOffset: [0, 1] }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: path.duration,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }
            }
          />
        ))}
      </svg>
    </div>
  );
}

/** Decorative held-thread paths for the landing hero. */
export function BackgroundPaths({ title: _title }: { title?: string } = {}) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
