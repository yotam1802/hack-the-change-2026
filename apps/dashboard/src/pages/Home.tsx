import { Link } from "react-router-dom";
import { useNurseAuth, isLocalDemo } from "../auth/AuthProvider";
import "./home.css";

type Glyph = "pulse" | "shield" | "sparkle" | "layers" | "clock" | "arrow" | "lock" | "eye" | "chevron";
function GlyphIcon({ name, size = 22 }: { name: Glyph; size?: number }) {
  const icon = {
    pulse: <path d="M2 12h5l3-7 4 14 3-7h5" />,
    shield: <><path d="M12 2 4 5v6c0 5 3.6 8.5 8 11 4.4-2.5 8-6 8-11V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    sparkle: <><path d="m12 2 1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2Z"/><path d="m19 18 .7 2.3L22 21l-2.3.7L19 24l-.7-2.3L16 21l2.3-.7L19 18Z"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></>,
    arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    chevron: <path d="m6 9 6 6 6-6" />,
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>;
}

export function Home() {
  const { authenticated, nurse, logout } = useNurseAuth();
  const dashboardHref = authenticated ? "/dashboard" : "/login";
  return <div className="ww-home" id="top">
    <header className="ww-nav">
      <div className="ww-container ww-nav-inner">
        <Link to="/" className="ww-brand" aria-label="WaitWatch homepage">
          <span className="ww-brand-mark"><GlyphIcon name="pulse" size={26}/></span>
          <span>Wait<span>Watch</span></span>
        </Link>
        <nav className="ww-nav-links" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#about">About</a>
        </nav>
        <div className="ww-nav-actions">
          {authenticated ? <button className="ww-quiet-link" type="button" onClick={logout}>Log out</button> : <Link className="ww-quiet-link" to="/login">Nurse login</Link>}
          <Link className="ww-btn ww-btn-primary ww-nav-dashboard" to={dashboardHref}>
            <GlyphIcon name="layers" size={18}/> {authenticated ? "Open dashboard" : "Go to dashboard"}
          </Link>
        </div>
      </div>
    </header>

    <main>
      <section className="ww-hero ww-container" aria-labelledby="ww-hero-title">
        <div className="ww-hero-glow" aria-hidden="true" />
        <div className="ww-hero-copy">
          <div className="ww-eyebrow"><span className="ww-live-dot"/> Connected care, a clearer view</div>
          <h1 id="ww-hero-title">A better view of <span>every waiting moment.</span></h1>
          <p>Bring wearable readings, reassessment reminders, and screening prompts into one simple workspace designed for nursing teams.</p>
          <div className="ww-hero-actions">
            <Link to={dashboardHref} className="ww-btn ww-btn-primary ww-btn-big">
              <GlyphIcon name={authenticated ? "layers" : "lock"} size={20}/>
              {authenticated ? "Go to your dashboard" : "Log in as nurse"}
              <GlyphIcon name="arrow" size={18}/>
            </Link>
            <a href="#how-it-works" className="ww-btn ww-btn-outline ww-btn-big">See how it works <GlyphIcon name="chevron" size={19}/></a>
          </div>
          <div className="ww-hero-assurance"><GlyphIcon name="shield" size={17} /> Nurse-restricted access <span/> <GlyphIcon name="clock" size={16} /> Real-time dashboard</div>
        </div>
        <div className="ww-hero-image-wrap">
          <img src="/waitwatch-hero.webp" className="ww-hero-image" alt="Concept illustration of a nurse reviewing a digital patient-monitoring display" />
          <span className="ww-art-label">Concept illustration · demo data</span>
        </div>
      </section>

      <section className="ww-container ww-feature-section" id="features" aria-labelledby="ww-features-title">
        <div className="ww-section-kicker">A calmer command centre</div>
        <div className="ww-section-head"><h2 id="ww-features-title">Everything important, <em>in one place.</em></h2><p>One view helps nursing teams stay organized without jumping between screens.</p></div>
        <div className="ww-feature-grid">
          <article className="ww-feature-card"><div className="ww-feature-icon ww-cyan"><GlyphIcon name="pulse" size={26}/></div><h3>Live vital sign tracking</h3><p>Follow incoming heart-rate readings and recent trends from connected demo devices.</p><span className="ww-feature-index">01 / MONITOR</span></article>
          <article className="ww-feature-card"><div className="ww-feature-icon ww-purple"><GlyphIcon name="sparkle" size={26}/></div><h3>AI-assisted screening</h3><p>Surface review prompts and draft summaries, with nurses remaining responsible for decisions.</p><span className="ww-feature-index">02 / REVIEW</span></article>
          <article className="ww-feature-card"><div className="ww-feature-icon ww-blue"><GlyphIcon name="layers" size={26}/></div><h3>One unified ward</h3><p>See patient cards, CTAS labels, reassessment actions, and timelines side by side.</p><span className="ww-feature-index">03 / PRIORITIZE</span></article>
        </div>
      </section>

      <section className="ww-how-section" id="how-it-works" aria-labelledby="ww-how-title">
        <div className="ww-container">
          <div className="ww-section-kicker">Designed for your workflow</div>
          <h2 id="ww-how-title">From signal to <em>next step.</em></h2>
          <div className="ww-steps">
            <div className="ww-step"><div className="ww-step-number">01</div><div className="ww-step-symbol"><GlyphIcon name="pulse" size={25}/></div><h3>Collect readings</h3><p>Demo wearables stream measurements to a single waiting-room view.</p></div>
            <div className="ww-step-line" aria-hidden="true"/>
            <div className="ww-step"><div className="ww-step-number">02</div><div className="ww-step-symbol"><GlyphIcon name="sparkle" size={25}/></div><h3>Review what matters</h3><p>See trends, screening prompts, and reassessment reminders.</p></div>
            <div className="ww-step-line" aria-hidden="true"/>
            <div className="ww-step"><div className="ww-step-number">03</div><div className="ww-step-symbol"><GlyphIcon name="shield" size={25}/></div><h3>Act with context</h3><p>Open a patient timeline and record the nurse's own reassessment.</p></div>
          </div>
        </div>
      </section>

      <section className="ww-container ww-about" id="about">
        <div className="ww-about-copy"><div className="ww-section-kicker">Made for the moments between</div><h2>Less switching.<br/><em>More awareness.</em></h2><p>WaitWatch brings your waiting-room workflow together in a clean, dark, easy-to-read interface. Built as a hackathon prototype, it demonstrates how connected devices and thoughtful software can support nursing teams.</p>
          <p className="ww-about-note"><GlyphIcon name="eye" size={17}/> Prototype only — not a medical device or validated triage system.</p>
        </div>
        <div className="ww-about-visual" aria-label="Features of the WaitWatch prototype">
          <div className="ww-mini-tag"><span className="ww-mini-dot"/> LIVE DEMO WORKFLOW</div>
          <div className="ww-mini-row"><GlyphIcon name="pulse"/><span>Heart-rate updates</span><b>Streaming</b></div>
          <div className="ww-mini-row"><GlyphIcon name="clock"/><span>Reassessment reminders</span><b>Organized</b></div>
          <div className="ww-mini-row"><GlyphIcon name="layers"/><span>Patient overview</span><b>One place</b></div>
          <div className="ww-mini-footer"><GlyphIcon name="shield" size={16}/> Staff access is restricted through Auth0 roles</div>
        </div>
      </section>

      <section className="ww-container ww-cta"><div className="ww-cta-light" aria-hidden="true"/><div><span className="ww-section-kicker">Ready when you are</span><h2>Bring your waiting room <em>into focus.</em></h2><p>{authenticated ? `Signed in${nurse?.name ? ` as ${nurse.name}` : ""}. Your dashboard is ready.` : "Sign in with your approved nursing account to enter the WaitWatch dashboard."}</p></div><Link to={dashboardHref} className="ww-btn ww-btn-primary ww-btn-big">{authenticated ? "Open dashboard" : isLocalDemo ? "Explore local demo" : "Log in as nurse"}<GlyphIcon name="arrow" size={19}/></Link></section>
    </main>
    <footer className="ww-footer"><div className="ww-container ww-footer-inner"><Link className="ww-brand" to="/"><span className="ww-brand-mark"><GlyphIcon name="pulse" size={22}/></span><span>Wait<span>Watch</span></span></Link><p>Thoughtful monitoring. Nurse-led care. <span>Hackathon demonstration only.</span></p><a href="#top">Back to top ↑</a></div></footer>
  </div>;
}
