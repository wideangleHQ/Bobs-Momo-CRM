'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Card, CardBody } from '@/components/ui/card';

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-4 w-full">
      <Card className="w-full border-none shadow-2xl rounded-[15px] overflow-hidden bg-white/95 backdrop-blur-sm">
        {/* Top Navigation */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-center">
          <Link
            href="/login"
            className="text-xs font-semibold text-zinc-500 hover:text-black transition-colors flex items-center gap-2"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Login
          </Link>
        </div>

        <CardBody className="p-8 pb-10">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-6">
              <Image
                src="/assets/logo.png"
                alt="Bobs Momo Logo"
                width={140}
                height={48}
                className="object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-black mb-2">
              Get access
            </h1>
            <p className="text-sm text-zinc-500 font-medium text-center">
              Already have an account?{' '}
              <Link href="/login" className="text-red-600 font-semibold hover:underline">
                Log in
              </Link>
            </p>
          </div>

          {/* Info block */}
          <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-black">Accounts are created by your manager</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  Bob&apos;s Momo CRM accounts are provisioned by an Owner or HR Administrator.
                  You cannot self-register — your manager creates your login and provides a
                  temporary password.
                </p>
              </div>
            </div>

            <div className="border-t border-zinc-200" />

            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#52525b"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.61 5a2 2 0 0 1 1.99-2.18H6.6a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.4a16 16 0 0 0 5.55 5.55l.94-.94a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 17.32z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-bold text-black">How to get access</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  Ask your outlet Owner or HR Administrator to create an account for you. They will
                  give you a username and a temporary password you&apos;ll be prompted to change on
                  first login.
                </p>
              </div>
            </div>
          </div>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center w-full h-12 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors text-white font-bold text-sm tracking-wide shadow-sm"
          >
            Go to Login
          </Link>
        </CardBody>
      </Card>

      <div className="text-center mt-2 flex justify-center gap-3 text-[10px] font-medium text-white/50 lg:text-white/40">
        <span>© 2026 Bobs Momo CRM</span>
        <span>•</span>
        <span>All Rights Reserved</span>
        <span>•</span>
        <span>Version: 4.6.1</span>
      </div>
    </div>
  );
}
