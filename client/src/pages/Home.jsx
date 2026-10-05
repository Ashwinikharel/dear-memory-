import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IS_DEMO } from '../api.js';

const DEMO_EMAIL = 'demo@dearmemory.app';
const DEMO_PASSWORD = 'demo12345';

/** Start screen (also what the installed phone app opens to). */
export default function Home() {
  const [installEvent, setInstallEvent] = useState(null);
  const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallEvent(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  async function install() {
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  }

  return (
    <div className="home">
      <div className="home-inner">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" className="home-logo" />
        <h1 className="display">Dear Memory</h1>
        <p className="muted">Your event photos, delivered privately.</p>
        {IS_DEMO && (
          <p className="demo-note small">Demo version: sample photos and simulated face matching. Photographer login: <strong>{DEMO_EMAIL}</strong> / <strong>{DEMO_PASSWORD}</strong></p>
        )}

        <Link to="/scan" className="home-choice primary">
          <strong>I'm a guest</strong>
          <span>Scan your team's QR code to see your photos</span>
        </Link>
        <Link to="/login" className="home-choice">
          <strong>I'm a photographer</strong>
          <span>Sign in to manage events and upload photos</span>
        </Link>

        {!isStandalone && installEvent && (
          <button className="btn" onClick={install}>Install Dear Memory on this device</button>
        )}
        {!isStandalone && isIos && (
          <p className="small muted center">To install on iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.</p>
        )}
      </div>
    </div>
  );
}
