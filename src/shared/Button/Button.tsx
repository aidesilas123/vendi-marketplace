import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  /** `md` is the original size. `sm` matches the tab pills (px-4 py-2 text-xs). */
  size?: 'md' | 'sm';
}

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) => {
  const baseStyle =
    "!rounded-full transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed";

  const sizes = {
    md: "!px-5 !py-2.5 !text-sm !font-black",
    sm: "!px-4 !py-2 !text-xs !font-bold"
  };

  // `secondary` is kept (same look as primary) so any existing
  // <Button variant="secondary"> keeps working. `outline` is a softer faded
  // orange. `danger` is for destructive confirmations (e.g. Delete).
  const variants = {
    primary: "!bg-orange-500 !text-white hover:!bg-orange-600 shadow-lg",
    secondary: "!bg-orange-500 !text-white hover:!bg-orange-600 shadow-lg",
    outline:
      "!bg-orange-500/10 !text-orange-600 dark:!text-orange-400 border !border-orange-500/30 hover:!bg-orange-500/20",
    danger: "!bg-red-500 !text-white hover:!bg-red-600 shadow-lg"
  };

  return (
    <button
      className={`${baseStyle} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};