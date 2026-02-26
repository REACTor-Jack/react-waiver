import { useState, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wtspmrqnatbnexinspzb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c3BtcnFuYXRibmV4aW5zcHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzEzOTUsImV4cCI6MjA4NzYwNzM5NX0.OYC11RHMHiUTRoKzVJQxFkO656bXZDAaQbz6j6XTAZ0'
);

const LOGO_URL = 'https://static.wixstatic.com/media/bbef2a_e5182ebf7aa047b99c23c4c98fec29db~mv2.png/v1/fill/w_276,h_110,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/HD%2520Logo-Transparent%2520BG-01_edited.png';

export default function App() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [isMinor, setIsMinor] = useState(false);
  const [minorName, setMinorName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);

  // --- Signature pad logic ---
  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#00bfff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const endDraw = (e) => {
    e.preventDefault();
    isDrawing.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const isCanvasBlank = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return !data.some((channel, i) => i % 4 !== 3 ? false : channel !== 0);
  };

  // --- Form submission ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim() || !email.trim()) {
      setError('Please fill in your name and email.');
      return;
    }
    if (isMinor && !minorName.trim()) {
      setError('Please enter the minor\'s name.');
      return;
    }
    if (!agreed) {
      setError('You must agree to the waiver terms.');
      return;
    }
    if (isCanvasBlank()) {
      setError('Please provide your signature.');
      return;
    }

    setLoading(true);

    try {
      const signatureDataUrl = canvasRef.current.toDataURL('image/png');

      const { error: dbError } = await supabase.from('Waivers').insert([
        {
          full_name: fullName.trim(),
          email: email.trim(),
          agreed: true,
          signature_url: signatureDataUrl,
          is_minor: isMinor,
          minor_name: isMinor ? minorName.trim() : null,
        },
      ]);

      if (dbError) throw dbError;
      setSubmitted(true);
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // --- Success screen ---
  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
          <div style={styles.successIcon}>✓</div>
          <h2 style={styles.successTitle}>Waiver Signed!</h2>
          <p style={styles.successText}>
            Thank you, {fullName}. Your waiver has been submitted.
            {isMinor && <><br />Minor: {minorName}</>}
          </p>
          <p style={styles.successSubtext}>You're all set for your adventure.</p>
          <button
            onClick={() => {
              setSubmitted(false);
              setFullName('');
              setEmail('');
              setIsMinor(false);
              setMinorName('');
              setAgreed(false);
              clearSignature();
            }}
            style={styles.button}
          >
            Sign Another Waiver
          </button>
        </div>
      </div>
    );
  }

  // --- Waiver form ---
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />

        <h1 style={styles.title}>Participant Waiver</h1>
        <p style={styles.subtitle}>
          Please complete this waiver before your adventure.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Full Name */}
          <label style={styles.label}>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your full name"
            style={styles.input}
          />

          {/* Email */}
          <label style={styles.label}>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            style={styles.input}
          />

          {/* Minor checkbox */}
          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="minor-check"
              checked={isMinor}
              onChange={(e) => {
                setIsMinor(e.target.checked);
                if (!e.target.checked) setMinorName('');
              }}
              style={styles.checkbox}
            />
            <label htmlFor="minor-check" style={styles.checkboxLabel}>
              I am signing on behalf of a minor (under 18)
            </label>
          </div>

          {/* Minor name — conditional */}
          {isMinor && (
            <>
              <label style={styles.label}>Minor's Full Name</label>
              <input
                type="text"
                value={minorName}
                onChange={(e) => setMinorName(e.target.value)}
                placeholder="Enter the minor's full name"
                style={styles.input}
              />
            </>
          )}

          {/* Waiver text */}
          <div style={styles.waiverBox}>
            <p style={styles.waiverText}>
              I acknowledge that participation in escape room activities at REACT Premium
              Escape Rooms involves certain risks. I voluntarily assume all risks associated
              with participation. I agree to follow all safety instructions and guidelines
              provided by REACT staff. I release REACT Premium Escape Rooms, its owners,
              employees, and agents from any and all liability for injuries or damages that
              may occur during participation.
              {isMinor && (
                <> As the parent or legal guardian of the minor named above, I grant
                permission for their participation and accept responsibility on their behalf.</>
              )}
            </p>
          </div>

          {/* Agreement checkbox */}
          <div style={styles.checkboxRow}>
            <input
              type="checkbox"
              id="agree-check"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={styles.checkbox}
            />
            <label htmlFor="agree-check" style={styles.checkboxLabel}>
              I have read and agree to the waiver terms above
            </label>
          </div>

          {/* Signature */}
          <label style={styles.label}>Signature</label>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
            style={styles.canvas}
          />
          <button type="button" onClick={clearSignature} style={styles.clearBtn}>
            Clear Signature
          </button>

          {/* Error */}
          {error && <p style={styles.error}>{error}</p>}

          {/* Submit */}
          <button type="submit" disabled={loading} style={{
            ...styles.button,
            opacity: loading ? 0.6 : 1,
            c
