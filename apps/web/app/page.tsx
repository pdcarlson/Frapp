"use client";

import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { 
  Zap, 
  Shield, 
  CreditCard, 
  Smartphone, 
  Globe,
  ArrowRight
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white selection:bg-primary/30">
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_800px_at_100%_200px,#064e3b,transparent)]"></div>

      <nav className="relative flex items-center justify-between p-6 max-w-7xl mx-auto z-10">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black text-xl">F</div>
          <span className="text-2xl font-bold tracking-tighter uppercase italic">Frapp</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="#features" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Platform</Link>
          <SignedIn>
            <Link href="/dashboard" className="text-sm font-bold bg-white text-black px-4 py-2 rounded-full hover:bg-zinc-200 transition-colors">Dashboard</Link>
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="text-sm font-bold bg-white text-black px-4 py-2 rounded-full hover:bg-zinc-200 transition-colors">Sign In</button>
            </SignInButton>
          </SignedOut>
        </div>
      </nav>

      <main className="relative pt-20 pb-32 px-6 z-10">
        <div className="max-w-7xl mx-auto">
          {/* Hero Section */}
          <div className="max-w-3xl mb-24">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <span className="inline-block px-3 py-1 rounded-full border border-primary/20 bg-primary/10 text-primary text-xs font-bold uppercase tracking-widest mb-6">
                V1.0 — The Operating System
              </span>
              <h1 className="text-7xl font-extrabold tracking-tighter mb-8 leading-[0.9]">
                GREEK LIFE, <br />
                <span className="text-zinc-500">DIGITALLY REMASTERED.</span>
              </h1>
              <p className="text-xl text-zinc-400 leading-relaxed mb-10 max-w-xl">
                Frapp consolidates your chapter's disjointed tools into a single, high-performance command center. Dues, events, and accountability—all in one place.
              </p>
              <div className="flex flex-wrap gap-4">
                <SignedIn>
                  <Link href="/dashboard" className="px-8 py-4 bg-primary text-white font-black rounded-2xl flex items-center gap-2 hover:scale-[1.02] transition-transform">
                    ENTER COMMAND CENTER <ArrowRight className="w-5 h-5" />
                  </Link>
                </SignedIn>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="px-8 py-4 bg-primary text-white font-black rounded-2xl flex items-center gap-2 hover:scale-[1.02] transition-transform">
                      INITIALIZE CHAPTER <ArrowRight className="w-5 h-5" />
                    </button>
                  </SignInButton>
                </SignedOut>
                <button className="px-8 py-4 bg-zinc-900 border border-zinc-800 text-white font-bold rounded-2xl hover:bg-zinc-800 transition-colors">
                  VIEW DOCS
                </button>
              </div>
            </motion.div>
          </div>

          {/* Bento Grid Features */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 auto-rows-[240px]">
            <div className="md:col-span-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] p-8 flex flex-col justify-between overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <CreditCard className="w-48 h-48 -rotate-12" />
              </div>
              <div>
                <Zap className="text-primary w-8 h-8 mb-4" />
                <h3 className="text-2xl font-bold italic uppercase tracking-tighter">Automated Financials</h3>
                <p className="text-zinc-400 max-w-sm mt-2">Zero-manual invoicing. Double-entry ledger logic ensures every penny is accounted for across the entire house.</p>
              </div>
              <div className="flex gap-2">
                <span className="text-[10px] font-mono bg-zinc-800 px-2 py-1 rounded">STRIPE_INTEGRATED</span>
                <span className="text-[10px] font-mono bg-zinc-800 px-2 py-1 rounded">AUTO_RECONCILE</span>
              </div>
            </div>

            <div className="md:col-span-4 bg-primary rounded-[2.5rem] p-8 flex flex-col justify-between text-white">
              <Smartphone className="w-10 h-10" />
              <div>
                <h3 className="text-2xl font-bold italic uppercase tracking-tighter leading-none mb-2">Native First</h3>
                <p className="text-white/80 text-sm">Geofenced study hours and QR check-ins designed for the speed of mobile.</p>
              </div>
            </div>

            <div className="md:col-span-4 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] p-8 flex flex-col justify-between">
              <Shield className="text-zinc-500 w-8 h-8" />
              <div>
                <h3 className="text-xl font-bold uppercase tracking-tighter">RBAC Engine</h3>
                <p className="text-zinc-400 text-sm mt-2">Granular permissions for every executive position. You control the keys.</p>
              </div>
            </div>

            <div className="md:col-span-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] p-8 flex flex-col justify-between relative overflow-hidden">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <h3 className="text-2xl font-bold italic uppercase tracking-tighter">The Library</h3>
                  <p className="text-zinc-400 mt-2">A centralized, searchable vault for "Backwork." Protected by AWS S3 and row-level chapter isolation.</p>
                </div>
                <div className="hidden sm:block">
                  <div className="grid grid-cols-2 gap-2 opacity-20">
                    {[1,2,3,4].map(i => <div key={i} className="w-12 h-16 bg-zinc-700 rounded-lg" />)}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="text-[10px] font-mono bg-zinc-800 px-2 py-1 rounded">S3_ENCRYPTED</span>
                <span className="text-[10px] font-mono bg-zinc-800 px-2 py-1 rounded">AES_256</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative border-t border-zinc-900 py-12 px-6 z-10 bg-[#09090b]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50">
            <div className="w-6 h-6 bg-zinc-700 rounded flex items-center justify-center text-xs font-bold text-zinc-300">F</div>
            <span className="text-sm font-bold tracking-tight uppercase italic">Frapp</span>
          </div>
          <div className="flex gap-8 text-xs font-mono text-zinc-500 uppercase tracking-widest">
            <span>Server: Stable</span>
            <span>Uptime: 99.9%</span>
            <span>© 2026 Frapp Lab</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
