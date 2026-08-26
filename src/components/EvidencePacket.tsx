import { motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";

const BASE_WIDTH = 321;
const BASE_HEIGHT = 270;
const FLAP_PATH =
  "M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z";

const CARD_POSES = [
  { rest: { y: -22, x: -40, rotate: -5 }, hover: { y: -78, x: -44, rotate: -11 } },
  { rest: { y: -20, x: 3, rotate: 2 }, hover: { y: -92, x: 0, rotate: -2 } },
  { rest: { y: -10, x: 40, rotate: 10 }, hover: { y: -70, x: 48, rotate: 16 } },
] as const;

const COMPACT_POSES = [
  { rest: { y: -12, x: -18, rotate: -4 }, hover: { y: -22, x: -20, rotate: -7 } },
  { rest: { y: -10, x: 0, rotate: 2 }, hover: { y: -24, x: 0, rotate: -1 } },
  { rest: { y: -6, x: 18, rotate: 6 }, hover: { y: -18, x: 22, rotate: 10 } },
] as const;

function PacketCard({
  id,
  label,
  filterId,
}: {
  id: number;
  label: string;
  filterId: string;
}) {
  return (
    <div className="packet-leaf">
      <svg width="164" height="214" viewBox="0 0 164 214" fill="none" aria-hidden="true">
        <g filter={`url(#${filterId})`}>
          <rect width="163.078" height="213.262" rx="20" fill="var(--packet-card)" />
        </g>
        <rect x="0.5" y="0.5" width="162.078" height="212.262" rx="19.5" stroke="var(--packet-card-stroke)" />
        <rect x="14.12" y="31.21" width="134.84" height="11.89" rx="5.94" fill="var(--packet-card-line)" />
        <rect x="14.83" y="61" width="133.04" height="5.88" rx="2.94" fill="var(--packet-card-line)" />
        <rect x="14.83" y="75.11" width="133.04" height="5.88" rx="2.94" fill="var(--packet-card-line)" />
        <rect x="14.83" y="89.23" width="98" height="5.88" rx="2.94" fill="var(--packet-card-line)" />
        <defs>
          <filter
            id={filterId}
            x="0"
            y="0"
            width="166.078"
            height="218.262"
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
            <feColorMatrix
              in="SourceAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
            <feMorphology radius="2" operator="erode" in="SourceAlpha" result={`in-${id}`} />
            <feOffset dx="3" dy="5" />
            <feGaussianBlur stdDeviation="3.05" />
            <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.18 0"
            />
            <feBlend mode="normal" in2="shape" />
          </filter>
        </defs>
      </svg>
      {label ? <span className="packet-leaf-label">{label}</span> : null}
    </div>
  );
}

export function EvidenceFolder({
  sources,
  lifted,
  scale = 0.58,
  compact = false,
}: {
  sources: string[];
  lifted: boolean;
  scale?: number;
  compact?: boolean;
}) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduce = useReducedMotion();
  const poses = compact ? COMPACT_POSES : CARD_POSES;
  const pose = reduce ? "rest" : lifted ? "hover" : "rest";
  const slots = [sources[0] || "", sources[1] || "", sources[2] || ""];

  return (
    <div
      className={`evidence-folder${compact ? " is-compact" : ""}`}
      style={{
        width: BASE_WIDTH * scale,
        height: BASE_HEIGHT * scale,
        ["--packet-scale" as string]: String(scale),
      }}
      aria-hidden="true"
    >
      <div
        className="evidence-folder-inner"
        style={{
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
        }}
      >
        <div
          className="evidence-folder-back"
          style={{ boxShadow: "var(--packet-back-inset)" }}
        />
        <div className="evidence-folder-leaves">
          {slots.map((label, index) => (
            <motion.div
              key={index}
              className="evidence-folder-leaf"
              initial={false}
              animate={poses[index][pose]}
              transition={{ type: "spring", stiffness: 140, damping: 16, delay: reduce ? 0 : index * 0.04 }}
            >
              <PacketCard id={index + 1} label={compact ? "" : label} filterId={`${rawId}c${index}`} />
            </motion.div>
          ))}
        </div>
        <motion.div
          className="evidence-folder-flap"
          initial={false}
          style={{ transformOrigin: "bottom center" }}
          animate={{
            x: "-50%",
            y: "-50%",
            rotateX: reduce ? -18 : lifted ? -52 : -15,
          }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
        >
          <div className="evidence-folder-flap-glass" />
          <svg width="321" height="241" viewBox="0 0 321 241" fill="none">
            <g filter={`url(#${rawId}flap)`}>
              <path d={FLAP_PATH} fill="var(--packet-flap)" fillOpacity="var(--packet-flap-opacity)" />
              <path
                d="M25 0.5H136.084C142.905 0.5 149.417 3.3431 154.054 8.3457L177.713 33.874C182.539 39.0808 189.317 42.04 196.416 42.04H296C309.531 42.04 320.5 53.0092 320.5 66.54V216C320.5 229.531 309.531 240.5 296 240.5H25C11.469 240.5 0.5 229.531 0.5 216V25C0.5 11.469 11.469 0.5 25 0.5Z"
                stroke="var(--packet-flap-stroke)"
              />
            </g>
            <defs>
              <filter
                id={`${rawId}flap`}
                x="-25.4"
                y="-25.4"
                width="371.8"
                height="291.8"
                filterUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
              >
                <feFlood floodOpacity="0" result="BackgroundImageFix" />
                <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                <feColorMatrix
                  in="SourceAlpha"
                  type="matrix"
                  values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                  result="hardAlpha"
                />
                <feOffset />
                <feGaussianBlur stdDeviation="2.65" />
                <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
                <feColorMatrix
                  type="matrix"
                  values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.12 0"
                />
                <feBlend mode="normal" in2="shape" />
              </filter>
            </defs>
          </svg>
        </motion.div>
      </div>
    </div>
  );
}

export function usePacketLift() {
  const [lifted, setLifted] = useState(false);
  return {
    lifted,
    onMouseEnter: () => setLifted(true),
    onMouseLeave: () => setLifted(false),
    onFocus: () => setLifted(true),
    onBlur: () => setLifted(false),
  };
}
