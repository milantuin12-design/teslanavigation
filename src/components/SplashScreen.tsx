import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

/** Startscherm dat tijdens het laden van de Superchargers in beeld blijft. */
export default function SplashScreen({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (show) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(false), 550);
    return () => clearTimeout(timer);
  }, [show]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[3000] grid place-items-center bg-slate-950 transition-opacity duration-500 ${show ? "opacity-100" : "opacity-0"}`}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(60%_50%_at_50%_35%,rgba(59,130,246,0.25),transparent_70%)]" />
      <div className="relative flex flex-col items-center gap-5">
        <span className="grid h-20 w-20 place-items-center rounded-3xl border border-white/10 bg-white/5 text-blue-300 shadow-2xl shadow-blue-600/20">
          <Zap size={34} className="animate-pulse" />
        </span>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Tesla Routeplanner</h1>
          <p className="mt-1 text-sm text-slate-400">Superchargers laden…</p>
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-[splash-slide_1.2s_ease-in-out_infinite] rounded-full bg-blue-500" />
        </div>
      </div>
      <style>{`@keyframes splash-slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}`}</style>
    </div>
  );
}
