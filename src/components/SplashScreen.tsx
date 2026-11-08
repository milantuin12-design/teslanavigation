import { useEffect, useState } from "react";
import { BatteryCharging, MapPin, Navigation, Route, Zap } from "lucide-react";

/** Geanimeerd startscherm dat zichtbaar blijft terwijl de Superchargers laden. */
export default function SplashScreen({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (show) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(false), 650);
    return () => clearTimeout(timer);
  }, [show]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Tesla Navigation wordt geladen"
      className={`tn-splash fixed inset-0 z-[3000] grid place-items-center overflow-hidden bg-[#050914] text-white transition-opacity duration-700 ${show ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      <div className="tn-splash-grid absolute inset-0" />
      <div className="tn-splash-glow tn-splash-glow-one" />
      <div className="tn-splash-glow tn-splash-glow-two" />
      <div className="tn-splash-orbit tn-splash-orbit-one" />
      <div className="tn-splash-orbit tn-splash-orbit-two" />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center px-6 text-center">
        <div className="tn-splash-mark relative mb-8 grid h-28 w-28 place-items-center rounded-[2rem] border border-sky-300/25 bg-sky-400/[0.08] shadow-[0_0_70px_rgba(14,165,233,0.22)]">
          <div className="tn-splash-mark-ring absolute inset-[-9px] rounded-[2.35rem] border border-sky-300/20" />
          <div className="tn-splash-mark-ring tn-splash-mark-ring-two absolute inset-[-18px] rounded-[2.8rem] border border-blue-400/10" />
          <Zap className="tn-splash-zap h-14 w-14 fill-sky-300 text-sky-200 drop-shadow-[0_0_18px_rgba(56,189,248,0.9)]" strokeWidth={1.5} />
          <span className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-slate-900 text-sky-200 shadow-lg">
            <Navigation size={15} />
          </span>
        </div>

        <div className="tn-splash-copy">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.48em] text-sky-300/80">Jouw reis. Slimmer gepland.</p>
          <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
            TESLA <span className="tn-splash-title-accent">NAVIGATION</span>
          </h1>
          <p className="mt-4 text-sm text-slate-300 sm:text-base">Elke kilometer begint met een slimme route.</p>
        </div>

        <div className="tn-splash-route relative mt-10 h-28 w-full max-w-[390px]">
          <svg viewBox="0 0 390 112" className="absolute inset-0 h-full w-full overflow-visible" fill="none" aria-hidden="true">
            <path d="M18 83 C65 83 56 26 112 26 S163 91 218 76 S278 17 322 35 S353 78 372 27" stroke="rgba(100,116,139,.35)" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 9" />
            <path className="tn-splash-route-line" d="M18 83 C65 83 56 26 112 26 S163 91 218 76 S278 17 322 35 S353 78 372 27" stroke="url(#tn-route-gradient)" strokeWidth="3.5" strokeLinecap="round" />
            <defs>
              <linearGradient id="tn-route-gradient" x1="18" y1="83" x2="372" y2="27" gradientUnits="userSpaceOnUse">
                <stop stopColor="#38bdf8" />
                <stop offset=".55" stopColor="#2563eb" />
                <stop offset="1" stopColor="#a5f3fc" />
              </linearGradient>
            </defs>
            <circle cx="18" cy="83" r="6" fill="#38bdf8" />
            <circle cx="18" cy="83" r="11" stroke="#38bdf8" strokeOpacity=".35" />
            <circle cx="218" cy="76" r="5" fill="#60a5fa" />
            <circle cx="218" cy="76" r="10" stroke="#60a5fa" strokeOpacity=".3" />
            <circle cx="372" cy="27" r="6" fill="#a5f3fc" />
            <circle cx="372" cy="27" r="12" stroke="#a5f3fc" strokeOpacity=".4" />
          </svg>
          <div className="tn-splash-pin tn-splash-pin-one"><MapPin size={17} /></div>
          <div className="tn-splash-pin tn-splash-pin-two"><BatteryCharging size={17} /></div>
          <div className="tn-splash-pin tn-splash-pin-three"><Navigation size={17} /></div>
          <div className="tn-splash-car"><Route size={17} /></div>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <span className="tn-splash-chip"><Zap size={12} /> Superchargers</span>
          <span className="tn-splash-chip"><Route size={12} /> Slimme routes</span>
          <span className="tn-splash-chip"><MapPin size={12} /> Heel Europa</span>
        </div>

        <div className="mt-9 w-56">
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] font-medium tracking-wide text-slate-400">
            <span className="tn-splash-loading-dot" />
            Superchargers en routegegevens laden
          </div>
          <div className="tn-splash-progress-track">
            <div className="tn-splash-progress-bar" />
          </div>
        </div>
      </div>

      <div className="absolute bottom-7 text-[9px] font-semibold uppercase tracking-[0.42em] text-slate-600">POWERED BY THE ROAD AHEAD</div>

      <style>{`
        .tn-splash-grid {
          opacity: .22;
          background-image: linear-gradient(rgba(96,165,250,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,.12) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse at center, black 8%, transparent 76%);
          animation: tn-grid-drift 18s linear infinite;
        }
        .tn-splash-glow { position:absolute; width: min(72vw, 680px); aspect-ratio:1; border-radius:50%; filter:blur(90px); pointer-events:none; }
        .tn-splash-glow-one { top:-42%; left:-22%; background:rgba(14,165,233,.17); animation:tn-glow-float 9s ease-in-out infinite alternate; }
        .tn-splash-glow-two { bottom:-48%; right:-22%; background:rgba(37,99,235,.2); animation:tn-glow-float 11s ease-in-out infinite alternate-reverse; }
        .tn-splash-orbit { position:absolute; left:50%; top:50%; width:min(86vw,760px); aspect-ratio:1; border:1px solid rgba(96,165,250,.08); border-radius:50%; transform:translate(-50%,-50%) rotate(-24deg) scaleY(.43); pointer-events:none; }
        .tn-splash-orbit-two { width:min(110vw,980px); transform:translate(-50%,-50%) rotate(28deg) scaleY(.43); border-color:rgba(56,189,248,.055); }
        .tn-splash-mark { animation:tn-mark-enter 1s cubic-bezier(.16,1,.3,1) both,tn-mark-float 4s ease-in-out 1s infinite; }
        .tn-splash-mark-ring { animation:tn-ring-pulse 3s ease-out infinite; }
        .tn-splash-mark-ring-two { animation-delay:1.1s; }
        .tn-splash-zap { animation:tn-zap-flash 2.8s ease-in-out infinite; }
        .tn-splash-copy { animation:tn-copy-enter .9s .15s cubic-bezier(.16,1,.3,1) both; }
        .tn-splash-title-accent { background:linear-gradient(100deg,#7dd3fc,#60a5fa 48%,#c4b5fd); background-clip:text; -webkit-background-clip:text; color:transparent; }
        .tn-splash-route { animation:tn-route-enter 1s .35s cubic-bezier(.16,1,.3,1) both; }
        .tn-splash-route-line { stroke-dasharray:520; stroke-dashoffset:520; animation:tn-draw-route 2.2s .6s ease forwards; }
        .tn-splash-pin { position:absolute; display:grid; place-items:center; width:30px; height:30px; border:1px solid rgba(125,211,252,.3); border-radius:10px; color:#bae6fd; background:rgba(8,47,73,.72); box-shadow:0 0 22px rgba(14,165,233,.16); }
        .tn-splash-pin-one { left:1%; top:57%; animation:tn-pin-pop .5s .8s both; }
        .tn-splash-pin-two { left:52%; top:48%; animation:tn-pin-pop .5s 1.25s both; }
        .tn-splash-pin-three { right:0; top:1%; animation:tn-pin-pop .5s 1.7s both; }
        .tn-splash-car { position:absolute; left:43%; top:20%; display:grid; place-items:center; width:34px; height:34px; border:1px solid rgba(191,219,254,.45); border-radius:50%; color:white; background:#1d4ed8; box-shadow:0 0 24px rgba(59,130,246,.6); animation:tn-car-travel 5s 1.2s ease-in-out infinite; }
        .tn-splash-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(148,163,184,.16); border-radius:999px; padding:7px 11px; background:rgba(15,23,42,.55); color:#cbd5e1; font-size:10px; }
        .tn-splash-progress-track { height:3px; overflow:hidden; border-radius:99px; background:rgba(148,163,184,.17); }
        .tn-splash-progress-bar { height:100%; width:34%; border-radius:99px; background:linear-gradient(90deg,#2563eb,#38bdf8,#a5f3fc); box-shadow:0 0 14px rgba(56,189,248,.8); animation:tn-progress 1.65s ease-in-out infinite; }
        .tn-splash-loading-dot { width:6px; height:6px; border-radius:50%; background:#38bdf8; box-shadow:0 0 10px #38bdf8; animation:tn-dot 1.1s ease-in-out infinite; }
        @keyframes tn-grid-drift { to { background-position:48px 48px; } }
        @keyframes tn-glow-float { from { transform:translate3d(-2%,0,0) scale(.94); } to { transform:translate3d(3%,4%,0) scale(1.08); } }
        @keyframes tn-mark-enter { from { opacity:0; transform:translateY(24px) scale(.72) rotate(-10deg); } to { opacity:1; transform:translateY(0) scale(1) rotate(0); } }
        @keyframes tn-mark-float { 0%,100% { translate:0 0; } 50% { translate:0 -7px; } }
        @keyframes tn-ring-pulse { 0% { opacity:.65; transform:scale(.94); } 75%,100% { opacity:0; transform:scale(1.16); } }
        @keyframes tn-zap-flash { 0%,82%,100% { filter:drop-shadow(0 0 8px rgba(56,189,248,.55)); } 88% { filter:drop-shadow(0 0 25px rgba(125,211,252,1)); } }
        @keyframes tn-copy-enter { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
        @keyframes tn-route-enter { from { opacity:0; transform:translateY(18px) scale(.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes tn-draw-route { to { stroke-dashoffset:0; } }
        @keyframes tn-pin-pop { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
        @keyframes tn-car-travel { 0%,100% { transform:translate(0,0); } 25% { transform:translate(34px,22px); } 50% { transform:translate(78px,35px); } 75% { transform:translate(116px,5px); } }
        @keyframes tn-progress { 0% { transform:translateX(-130%); } 100% { transform:translateX(390%); } }
        @keyframes tn-dot { 0%,100% { opacity:.4; transform:scale(.8); } 50% { opacity:1; transform:scale(1.25); } }
        @media (prefers-reduced-motion: reduce) {
          .tn-splash *, .tn-splash *::before, .tn-splash *::after { animation-duration:.01ms !important; animation-iteration-count:1 !important; scroll-behavior:auto !important; }
          .tn-splash-route-line { stroke-dashoffset:0; }
        }
        @media (max-height:650px) {
          .tn-splash-mark { width:5rem; height:5rem; margin-bottom:1.25rem; }
          .tn-splash-zap { width:2.5rem; height:2.5rem; }
          .tn-splash-route { margin-top:1.5rem; height:5rem; }
          .tn-splash-copy h1 { font-size:2rem; }
        }
      `}</style>
    </div>
  );
}
