import { cn } from "@/lib/utils";
import { motion, useReducedMotion, type Variants } from "motion/react";

type Direction = "up" | "down" | "left" | "right";

const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

function generateVariants(direction: Direction): Variants {
  const offset = direction === "right" || direction === "down" ? 48 : -48;
  if (direction === "left" || direction === "right") {
    return {
      hidden: { filter: "blur(6px)", opacity: 0, x: offset },
      visible: {
        filter: "blur(0px)",
        opacity: 1,
        x: 0,
        transition: { duration: 0.45, ease: "easeOut" },
      },
    };
  }
  return {
    hidden: { filter: "blur(6px)", opacity: 0, y: offset },
    visible: {
      filter: "blur(0px)",
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: "easeOut" },
    },
  };
}

const defaultViewport = { amount: 0.35, margin: "0px 0px -40px 0px" as const, once: true };

type TextAnimationProps = {
  text: string;
  classname?: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  id?: string;
  viewport?: {
    amount?: number;
    margin?: string;
    once?: boolean;
  };
  direction?: Direction;
  letterAnime?: boolean;
  lineAnime?: boolean;
};

const motionTags = {
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  p: motion.p,
  span: motion.span,
} as const;

/** uilayouts scroll-text — word/line reveal while scrolling into view. */
export default function TextAnimation({
  as = "h2",
  text,
  classname = "",
  id,
  viewport = defaultViewport,
  direction = "up",
  letterAnime = false,
  lineAnime = false,
}: TextAnimationProps) {
  const reduceMotion = useReducedMotion();
  const variants = generateVariants(direction);
  const MotionTag = motionTags[as];

  if (reduceMotion) {
    const Tag = as;
    return (
      <Tag id={id} className={cn(classname)}>
        {text}
      </Tag>
    );
  }

  return (
    <MotionTag
      id={id}
      whileInView="visible"
      initial="hidden"
      variants={containerVariants}
      viewport={viewport}
      className={cn("inline-block", classname)}
    >
      {lineAnime ? (
        <motion.span className="inline-block" variants={variants}>
          {text}
        </motion.span>
      ) : (
        text.split(" ").map((word, index) => (
          <motion.span
            key={`${word}-${index}`}
            className="inline-block"
            variants={letterAnime ? undefined : variants}
          >
            {letterAnime ? (
              <>
                {word.split("").map((letter, letterIndex) => (
                  <motion.span
                    key={`${index}-${letterIndex}`}
                    className="inline-block"
                    variants={variants}
                  >
                    {letter}
                  </motion.span>
                ))}
                {"\u00A0"}
              </>
            ) : (
              <>
                {word}
                {"\u00A0"}
              </>
            )}
          </motion.span>
        ))
      )}
    </MotionTag>
  );
}
