import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import Image from 'next/image';

const helvetica = localFont({
  src: [
    {
      path: '../../public/assets/font/helvetica-255/Helvetica.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/assets/font/helvetica-255/Helvetica-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-helvetica',
});

/** No nav, no outlet switcher. One centred card with high contrast operational typography. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`relative flex min-h-dvh w-full items-center justify-center lg:justify-start lg:pl-[12%] xl:pl-[16%] bg-black overflow-hidden ${helvetica.variable} font-sans`} style={{ fontFamily: 'var(--font-helvetica)' }}>
      {/* Full screen background */}
      <div className="absolute inset-0 z-0">
        <Image 
          src="/assets/banner image (2).png" 
          alt="Banner" 
          fill 
          priority 
          className="object-cover opacity-80" 
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>

      {/* Branding - Top Right */}
      <div className="absolute right-12 top-12 z-10 hidden text-right lg:block">
        <Image src="/assets/logo.png" alt="Bobs Momo Logo" width={180} height={60} className="drop-shadow-xl" />
      </div>

      {/* Main Content Area */}
      <div className="relative z-10 w-full max-w-[400px] px-4 lg:px-0">
        {/* Mobile branding */}
        <div className="mb-8 flex justify-center lg:hidden">
          <Image src="/assets/logo.png" alt="Bobs Momo Logo" width={150} height={50} className="drop-shadow-md" />
        </div>
        
        {children}
      </div>
    </div>
  );
}
