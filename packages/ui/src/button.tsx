import type { ButtonHTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "./utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
};

const BASE_BUTTON_CLASSNAME =
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2";

const VARIANT_CLASSNAME: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary:
    "border border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground",
  ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
};

export function Button({
  children,
  variant = "primary",
  className,
  type = "button",
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      type={type}
      className={joinClassNames(
        BASE_BUTTON_CLASSNAME,
        VARIANT_CLASSNAME[variant],
        className,
      )}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
