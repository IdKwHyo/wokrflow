import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { createAtmosphere } from './atmosphere';
import './cinematic.css';

gsap.registerPlugin(ScrollTrigger);

interface CinematicIntroProps {
  onOpenStudio: () => void;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {diagonal ? (
        <path d="M6 18 18 6M6 6h12v12" />
      ) : (
        <path d="M4 12h16m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}

export function CinematicIntro({ onOpenStudio }: CinematicIntroProps) {
  const root = useRef<HTMLElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const progress = useRef({ value: 0 });
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const wideScreen = useMediaQuery('(min-width: 900px)');
  const [webglAvailable, setWebglAvailable] = useState(true);
  const choreographed = wideScreen && !reducedMotion;

  useEffect(() => {
    if (!canvasHost.current) return;
    const scene = createAtmosphere(canvasHost.current, progress.current, reducedMotion);
    setWebglAvailable(Boolean(scene));
    return () => scene?.dispose();
  }, [reducedMotion]);

  useEffect(() => {
    if (!root.current || !choreographed) {
      progress.current.value = 0;
      return;
    }

    const lenis = new Lenis({ lerp: 0.075, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);

    const context = gsap.context(() => {
      gsap.fromTo(
        '.cine-title-line > span',
        { yPercent: 115, rotate: 3 },
        { yPercent: 0, rotate: 0, duration: 1.2, stagger: 0.12, ease: 'power3.out' },
      );

      gsap.set('.cine-resolution', { autoAlpha: 0, y: 55, z: -120 });
      gsap.set('.cine-path', { strokeDasharray: 740, strokeDashoffset: 740 });
      gsap.set('.cine-note-brief', { x: 35, y: -35, rotate: -8, z: -15 });
      gsap.set('.cine-note-plan', { x: 60, y: -100, rotate: 7, z: 30 });
      gsap.set('.cine-note-win', { x: -50, y: -35, rotate: -4, z: 12 });

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });
      timeline.eventCallback('onUpdate', () => { progress.current.value = timeline.progress(); });

      timeline
        .to('.cine-opening', { y: -85, z: 170, rotateX: 5, autoAlpha: 0, ease: 'power2.inOut', duration: 0.5 }, 0)
        .to('.cine-scroll-cue', { y: 18, autoAlpha: 0, duration: 0.2 }, 0)
        .to('.cine-note-brief', { x: 0, y: 0, rotate: 0, z: 0, duration: 0.85, ease: 'power2.inOut' }, 0)
        .to('.cine-note-plan', { x: 0, y: 0, rotate: 0, z: 0, duration: 0.85, ease: 'power2.inOut' }, 0.08)
        .to('.cine-note-win', { x: 0, y: 0, rotate: 0, z: 0, duration: 0.85, ease: 'power2.inOut' }, 0.13)
        .to('.cine-path', { strokeDashoffset: 0, duration: 0.62, ease: 'power1.inOut' }, 0.3)
        .to('.cine-resolution', { autoAlpha: 1, y: 0, z: 0, duration: 0.58, ease: 'power2.out' }, 0.43)
        .to('.cine-chapter-number', { y: -24, duration: 0.4, ease: 'power2.inOut' }, 0.4);

    }, root);

    let disposed = false;
    const refresh = () => { if (!disposed) ScrollTrigger.refresh(); };
    document.fonts.ready.then(refresh);
    return () => {
      disposed = true;
      context.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
      progress.current.value = 0;
    };
  }, [choreographed]);

  return (
    <section
      ref={root}
      className={`cine-intro ${choreographed ? 'cine-choreographed' : 'cine-natural'} ${webglAvailable ? '' : 'cine-no-webgl'}`}
      aria-label="Welcome to Afterglow"
    >
      <div className="cine-stage">
        <div className="cine-ambient" aria-hidden="true" />
        <header className="cine-header">
          <a className="cine-wordmark" href="#" aria-label="Afterglow home" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'instant' }); }}>
            <span className="cine-brand-symbol" aria-hidden="true">✳</span>
            afterglow<span className="cine-brand-period">.</span>
          </a>
          <span className="cine-header-label">A thoughtful start to every relationship</span>
          <button className="cine-header-action" type="button" onClick={onOpenStudio}>
            Open studio <Arrow diagonal />
          </button>
        </header>

        <div className="cine-scene" aria-hidden="true">
          <div ref={canvasHost} className="cine-canvas" />
          <div className="cine-fallback-orbit" />
          <div className="cine-orbit-caption"><span /> From possibility to a plan.</div>
        </div>

        <div className="cine-content">
          <div className="cine-opening">
            <p className="cine-eyebrow"><span className="cine-small-star" aria-hidden="true">✳</span> Customer onboarding, with intention</p>
            <h1 className="cine-title">
              <span className="cine-title-line"><span>Good things</span></span>
              <span className="cine-title-line"><span>start <em>here.</em></span></span>
            </h1>
            <p className="cine-description">Every customer brings a little possibility.<br className="cine-desktop-break" /> Give it a clear path forward.</p>
            <button className="cine-primary-action" type="button" onClick={onOpenStudio}>
              Build an onboarding journey <span><Arrow /></span>
            </button>
            <p className="cine-fine-print">AI-assisted planning. A human at the helm.</p>
          </div>

          <div className="cine-resolution">
            <p className="cine-eyebrow">A brief becomes a beginning</p>
            <h2>A little clarity.<br /><em>A lot of momentum.</em></h2>
            <p className="cine-description">Bring the brief. Shape the steps. Make space<br className="cine-desktop-break" /> for the relationship that comes next.</p>
            <button className="cine-primary-action" type="button" onClick={onOpenStudio}>
              Shape your first workflow <span><Arrow /></span>
            </button>
          </div>
        </div>

        <div className="cine-fragments" aria-hidden="true">
          <svg className="cine-connections" viewBox="0 0 600 500" preserveAspectRatio="none">
            <defs>
              <linearGradient id="cine-line-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e4d9b6" />
                <stop offset="100%" stopColor="#8dcab6" />
              </linearGradient>
            </defs>
            <path className="cine-path" d="M148 170 C148 242 323 188 323 265 S489 294 489 370" />
          </svg>
          <div className="cine-note cine-note-brief">
            <span className="cine-note-index">01 / LISTEN</span>
            <span className="cine-note-title">The customer brief</span>
            <span className="cine-note-detail">A goal worth understanding.</span>
            <i className="cine-note-port" />
          </div>
          <div className="cine-note cine-note-plan">
            <span className="cine-note-index">02 / ALIGN</span>
            <span className="cine-note-title">A shared plan</span>
            <span className="cine-note-detail">The right next steps.</span>
            <i className="cine-note-port" />
          </div>
          <div className="cine-note cine-note-win">
            <span className="cine-note-index">03 / BEGIN</span>
            <span className="cine-note-title">The first win</span>
            <span className="cine-note-detail">Something to build on.</span>
            <i className="cine-note-port" />
          </div>
        </div>

        <footer className="cine-footer">
          <div className="cine-chapter"><span className="cine-chapter-window"><span className="cine-chapter-number"><span>01</span><span>02</span></span></span><span> / THE BEGINNING</span></div>
          <div className="cine-scroll-cue"><span className="cine-scroll-line" /> Scroll to see things connect</div>
          <span className="cine-footer-label">Designed around people.</span>
        </footer>
      </div>
    </section>
  );
}
