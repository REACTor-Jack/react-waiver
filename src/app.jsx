import { useState, useRef, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://wtspmrqnatbnexinspzb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c3BtcnFuYXRibmV4aW5zcHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzEzOTUsImV4cCI6MjA4NzYwNzM5NX0.OYC11RHMHiUTRoKzVJQxFkO656bXZDAaQbz6j6XTAZ0";

// ─── Brand tokens ───
const T = {
  bg: "#0B0B0F",
  surface: "#141419",
  surfaceHover: "#1a1a22",
  border: "#2a2a35",
  accent: "#00BFFF",
  accentGlow: "rgba(0, 191, 255, 0.15)",
  accentGlowStrong: "rgba(0, 191, 255, 0.3)",
  text: "#E8E8EC",
  textMuted: "#8888A0",
  success: "#00E676",
  successGlow: "rgba(0, 230, 118, 0.15)",
  error: "#FF5252",
  white: "#FFFFFF",
  fontStack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

// ─── Signature Pad ───
function SignaturePad({ onSignatureChange, clearTrigger }) {
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const getCtx = () => canvasRef.current?.getContext("2d");

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = getCtx();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  useEffect(() => {
    resizeCanvas();
    onSignatureChange(null);
  }, [clearTrigger, resizeCanvas, onSignatureChange]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    isDrawing.current = true;
    lastPos.current = getPos(e);
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const ctx = getCtx();
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  };

  const stopDraw = () => {
    if (isDrawing.current) {
      isDrawing.current = false;
      onSignatureChange(canvasRef.current.toDataURL("image/png"));
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: 160,
        background: T.bg,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        touchAction: "none",
        cursor: "crosshair",
        display: "block",
      }}
      onMouseDown={startDraw}
      onMouseMove={draw}
      onMouseUp={stopDraw}
      onMouseLeave={stopDraw}
      onTouchStart={startDraw}
      onTouchMove={draw}
      onTouchEnd={stopDraw}
    />
  );
}

// ─── Waiver Terms ───
const WAIVER_TEXT = `REACT Premium Escape Rooms \u2014 Liability Waiver and Release

By signing below, I acknowledge and agree to the following:

1. ASSUMPTION OF RISK: I understand that participation in escape room activities involves physical and mental challenges that may include, but are not limited to, navigating dimly lit spaces, solving puzzles under time pressure, and interacting with mechanical props and electronic equipment. I voluntarily assume all risks associated with participation.

2. RELEASE OF LIABILITY: I hereby release, waive, and discharge REACT Premium Escape Rooms, its owners, operators, employees, and agents (collectively, "REACT") from any and all liability, claims, demands, or causes of action that I may have or that may arise out of or relate to any loss, damage, or injury sustained while participating in escape room activities.

3. MEDICAL CONDITIONS: I confirm that I have no medical conditions that would prevent safe participation, or that I have consulted with a medical professional and received clearance to participate.

4. RULES AND CONDUCT: I agree to follow all posted rules, staff instructions, and safety guidelines. I understand that failure to comply may result in removal from the activity without refund.

5. PHOTOGRAPHY AND MEDIA: I grant REACT permission to use any photographs, video recordings, or other media captured during my visit for promotional purposes, unless I notify staff in writing prior to my activity.

6. PROPERTY: I understand that REACT is not responsible for lost, stolen, or damaged personal belongings.

7. MINIMUM AGE: Participants under 18 must have this waiver signed by a parent or legal guardian.

8. ACKNOWLEDGMENT: I have read this waiver in its entirety, understand its terms, and agree to be bound by them.`;

// ─── Main App ───
export default function App() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signatureData, setSignatureData] = useState(null);
  const [clearSig, setClearSig] = useState(0);
  const [showTerms, setShowTerms] = useState(false);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const canSubmit = fullName.trim() && email.trim() && agreed && signatureData;

  const handleClear = () => {
    setClearSig((c) => c + 1);
    setSignatureData(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/waivers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          agreed: true,
          signature_url: signatureData,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      setStatus("success");
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong. Please try again.");
      setStatus("error");
    }
  };

  const handleReset = () => {
    setFullName("");
    setEmail("");
    setAgreed(false);
    setSignatureData(null);
    setClearSig((c) => c + 1);
    setStatus("idle");
    setErrorMsg("");
  };

  // ─── Success Screen ───
  if (status === "success") {
    return (
      <div style={styles.wrapper}>
        <div style={styles.container}>
          <div style={styles.successCard}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{"\u2713"}</div>
            <h1 style={{ ...styles.h1, color: T.success, marginBottom: 8 }}>
              Waiver Signed
            </h1>
            <p style={{ ...styles.bodyText, color: T.textMuted, marginBottom: 32, maxWidth: 320, margin: "0 auto 32px" }}>
              You're all set, {fullName.split(" ")[0]}. Your team's adventure awaits.
            </p>
            <button style={styles.secondaryBtn} onClick={handleReset}>
              Sign Another Waiver
            </button>
          </div>
          <Footer />
        </div>
      </div>
    );
  }

  // ─── Form ───
  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoMark}>R</div>
          <div>
            <h1 style={styles.logoText}>REACT</h1>
            <p style={styles.logoSub}>PREMIUM ESCAPE ROOMS</p>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>Participant Waiver</h2>
          <p style={styles.bodyText}>
            All participants must sign before their adventure. One waiver per person.
          </p>

          {/* Name */}
          <label style={styles.label}>Full Name</label>
          <input
            type="text"
            placeholder="First and last name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={styles.input}
          />

          {/* Email */}
          <label style={styles.label}>Email</label>
          <input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />

          {/* Terms */}
          <label style={styles.label}>Liability Waiver</label>
          <button
            style={styles.termsToggle}
            onClick={() => setShowTerms(!showTerms)}
          >
            <span>{showTerms ? "Hide" : "Read"} full waiver terms</span>
            <span style={{ transform: showTerms ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>{"\u25BE"}</span>
          </button>
          {showTerms && (
            <div style={styles.termsBox}>
              {WAIVER_TEXT}
            </div>
          )}

          {/* Agreement Checkbox */}
          <label style={styles.checkboxRow} onClick={() => setAgreed(!agreed)}>
            <div
              style={{
                ...styles.checkbox,
                background: agreed ? T.accent : "transparent",
                borderColor: agreed ? T.accent : T.border,
              }}
            >
              {agreed && <span style={{ color: T.bg, fontSize: 13, fontWeight: 700 }}>{"\u2713"}</span>}
            </div>
            <span style={{ color: T.text, fontSize: 14, lineHeight: 1.4 }}>
              I have read and agree to the liability waiver terms above
            </span>
          </label>

          {/* Signature */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ ...styles.label, marginBottom: 0 }}>Signature</label>
            {signatureData && (
              <button style={styles.clearSigBtn} onClick={handleClear}>
                Clear
              </button>
            )}
          </div>
          <p style={{ ...styles.bodyText, fontSize: 13, marginBottom: 10, color: T.textMuted }}>
            Draw your signature below with your finger or mouse
          </p>
          <SignaturePad
            onSignatureChange={useCallback((data) => setSignatureData(data), [])}
            clearTrigger={clearSig}
          />

          {/* Error */}
          {status === "error" && (
            <div style={styles.errorBox}>
              {errorMsg}
            </div>
          )}

          {/* Submit */}
          <button
            style={{
              ...styles.primaryBtn,
              opacity: canSubmit && status !== "submitting" ? 1 : 0.4,
              cursor: canSubmit && status !== "submitting" ? "pointer" : "not-allowed",
            }}
            onClick={handleSubmit}
            disabled={!canSubmit || status === "submitting"}
          >
            {status === "submitting" ? "Submitting..." : "Sign Waiver"}
          </button>
        </div>

        <Footer />
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={styles.footer}>
      <p style={{ color: T.textMuted, fontSize: 12, margin: 0 }}>
        REACT Premium Escape Rooms &middot; Windsor Locks, CT
      </p>
      <p style={{ color: T.textMuted, fontSize: 12, margin: "4px 0 0" }}>
        860-370-5415 &middot; reactescaperooms.com
      </p>
    </div>
  );
}

// ─── Styles ───
const styles = {
  wrapper: {
    minHeight: "100vh",
    background: T.bg,
    fontFamily: T.fontStack,
    display: "flex",
    justifyContent: "center",
    padding: "24px 16px",
    boxSizing: "border-box",
  },
  container: {
    width: "100%",
    maxWidth: 480,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 28,
    paddingLeft: 4,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: `linear-gradient(135deg, ${T.accent}, #0080B0)`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    fontWeight: 800,
    color: T.white,
    letterSpacing: -1,
    flexShrink: 0,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 800,
    color: T.white,
    letterSpacing: 3,
    margin: 0,
    lineHeight: 1.1,
  },
  logoSub: {
    fontSize: 9,
    fontWeight: 600,
    color: T.accent,
    letterSpacing: 2.5,
    margin: 0,
    lineHeight: 1.4,
  },
  card: {
    background: T.surface,
    borderRadius: 16,
    border: `1px solid ${T.border}`,
    padding: "28px 24px 32px",
  },
  h1: {
    fontSize: 28,
    fontWeight: 700,
    color: T.white,
    margin: "0 0 8px",
    textAlign: "center",
    fontFamily: T.fontStack,
  },
  h2: {
    fontSize: 20,
    fontWeight: 700,
    color: T.white,
    margin: "0 0 6px",
    fontFamily: T.fontStack,
  },
  bodyText: {
    fontSize: 14,
    color: T.textMuted,
    margin: "0 0 24px",
    lineHeight: 1.5,
    fontFamily: T.fontStack,
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: T.text,
    marginBottom: 6,
    fontFamily: T.fontStack,
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    fontSize: 15,
    fontFamily: T.fontStack,
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    color: T.text,
    outline: "none",
    marginBottom: 20,
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  termsToggle: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "10px 14px",
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    color: T.accent,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: T.fontStack,
    cursor: "pointer",
    marginBottom: 12,
    boxSizing: "border-box",
  },
  termsBox: {
    background: T.bg,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    padding: 16,
    fontSize: 12,
    lineHeight: 1.7,
    color: T.textMuted,
    maxHeight: 240,
    overflowY: "auto",
    marginBottom: 12,
    whiteSpace: "pre-wrap",
    fontFamily: T.fontStack,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    cursor: "pointer",
    marginBottom: 24,
    userSelect: "none",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
    transition: "all 0.15s",
  },
  clearSigBtn: {
    background: "transparent",
    border: "none",
    color: T.accent,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    padding: "4px 8px",
    fontFamily: T.fontStack,
  },
  primaryBtn: {
    width: "100%",
    padding: "14px 0",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: T.fontStack,
    background: `linear-gradient(135deg, ${T.accent}, #0080B0)`,
    color: T.white,
    border: "none",
    borderRadius: 12,
    cursor: "pointer",
    marginTop: 24,
    letterSpacing: 0.5,
    transition: "opacity 0.15s",
  },
  secondaryBtn: {
    padding: "12px 28px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: T.fontStack,
    background: "transparent",
    color: T.accent,
    border: `1px solid ${T.accent}`,
    borderRadius: 10,
    cursor: "pointer",
    transition: "background 0.15s",
  },
  errorBox: {
    background: "rgba(255, 82, 82, 0.1)",
    border: `1px solid ${T.error}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    color: T.error,
    marginTop: 16,
    fontFamily: T.fontStack,
  },
  successCard: {
    background: T.surface,
    borderRadius: 16,
    border: `1px solid ${T.border}`,
    padding: "60px 24px",
    textAlign: "center",
    marginTop: 60,
  },
  footer: {
    textAlign: "center",
    padding: "24px 0 8px",
    fontFamily: T.fontStack,
  },
};
