import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
}

export const Button = ({ children, variant = 'primary', className = '', ...props }: ButtonProps) => {
  // Added '!' to force Tailwind to overpower Ionic's default button styles
  const baseStyle = "!px-8 !py-4 !text-lg !rounded-full !font-black transition-all flex items-center justify-center";
  
  const variants = {
    primary: "!bg-orange-500 !text-white hover:!bg-orange-600 shadow-lg",
    secondary: "!bg-[#0f172a] dark:!bg-white !text-white dark:!text-[#0f172a] hover:!bg-gray-800 dark:hover:!bg-gray-200 shadow-lg",
    outline: "border !border-gray-200 dark:!border-gray-800 !text-gray-500 hover:!bg-gray-100 dark:hover:!bg-[#1e293b]"
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};