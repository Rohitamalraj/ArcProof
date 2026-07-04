export function AppBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#050507]">
      <div className="absolute left-[-10%] top-[-15%] h-[32rem] w-[32rem] rounded-full bg-violet-600/20 blur-[120px]" />
      <div className="absolute right-[-15%] top-[10%] h-[28rem] w-[28rem] rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="absolute bottom-[-20%] left-[20%] h-[30rem] w-[30rem] rounded-full bg-cyan-500/10 blur-[140px]" />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}
