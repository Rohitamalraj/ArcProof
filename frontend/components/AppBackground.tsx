type Props = {
  /** Static background image URL -- same darkened/scrimmed treatment the
   * landing page uses for its own art (agents-section.tsx, how-it-works
   * -section.tsx) so text stays readable on top of it. */
  image?: string;
  /** Looping background video URL (e.g. the home page's own hero video) --
   * mutually exclusive with `image`; if both are omitted this falls back
   * to the plain gradient-blob treatment. */
  video?: string;
};

export function AppBackground({ image, video }: Props = {}) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#050507]">
      {video ? (
        <video autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover opacity-40">
          <source src={video} type="video/mp4" />
        </video>
      ) : image ? (
        // eslint-disable-next-line @next/next/no-img-element -- fixed
        // background layer, not part of Next's optimized content flow
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
      ) : null}

      {(image || video) && (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-[#050507]/70 via-[#050507]/60 to-[#050507]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#050507]/80 via-transparent to-[#050507]/80" />
        </>
      )}

      <div className="absolute left-[-10%] top-[-15%] h-[32rem] w-[32rem] rounded-full bg-[#5eead4]/10 blur-[120px]" />
      <div className="absolute right-[-15%] top-[10%] h-[28rem] w-[28rem] rounded-full bg-[#a78bfa]/10 blur-[130px]" />
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
