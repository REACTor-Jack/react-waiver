import { useState, useRef, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://wtspmrqnatbnexinspzb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c3BtcnFuYXRibmV4aW5zcHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzEzOTAsImV4cCI6MjA4NzYwNzM5MH0.LbwrJfSSSyVj3FDPawmc6O29jM0o8oLMIIXpMOuXwig";

/* ── signature pad helpers ─────────────────────────────────────── */
function useSignaturePad(canvasRef) {
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  };

  const startDraw = useCallback(
    (e) => {
      e.preventDefault();
      isDrawing.current = true;
      hasDrawn.current = true;
      const ctx = canvasRef.current.getContext("2d");
      const { x, y } = getPos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    },
    [canvasRef]
  );

  const draw = useCallback(
    (e) => {
      if (!isDrawing.current) return;
      e.preventDefault();
      const ctx = canvasRef.current.getContext("2d");
      const { x, y } = getPos(e);
      ctx.lineTo(x, y);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();
    },
    [canvasRef]
  );

  const endDraw = useCallback(() => {
    isDrawing.current = false;
  }, []);

  const clearPad = useCallback(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    hasDrawn.current = false;
  }, [canvasRef]);

  const getDataURL = useCallback(() => {
    return canvasRef.current.toDataURL("image/png");
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", endDraw);

    return () => {
      canvas.removeEventListener("mousedown", startDraw);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", endDraw);
      canvas.removeEventListener("mouseleave", endDraw);
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", endDraw);
    };
  }, [canvasRef, startDraw, draw, endDraw]);

  return { clearPad, getDataURL, hasDrawn };
}

/* ── main component ─────────────────────────────────────────── */
export default function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | sending | success | error
  const [errorMsg, setErrorMsg] = useState("");
  const canvasRef = useRef(null);
  const { clearPad, getDataURL, hasDrawn } = useSignaturePad(canvasRef);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim() || !email.trim()) {
      setErrorMsg("Please fill in your name and email.");
      return;
    }
    if (!agreed) {
      setErrorMsg("Please agree to the waiver terms.");
      return;
    }
    if (!hasDrawn.current) {
      setErrorMsg("Please sign in the signature box.");
      return;
    }

    setStatus("sending");

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/Waivers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          full_name: name.trim(),
          email: email.trim(),
          agreed: true,
          signature_url: getDataURL(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit waiver");
      }

      setStatus("success");
      setName("");
      setEmail("");
      setAgreed(false);
      clearPad();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  };

  const resetForm = () => {
    setStatus("idle");
    setErrorMsg("");
  };

  /* ── success screen ──────────────────────────────────────── */
  if (status === "success") {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>REACT Premium Escape Rooms</h1>
          <div style={styles.successBox}>
            <h2 style={{ color: "#22c55e", marginBottom: 8 }}>Waiver Signed!</h2>
            <p>Thank you. Your waiver has been recorded. You're all set for your adventure.</p>
            <button onClick={resetForm} style={styles.button}>
              Sign Another Waiver
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── form ──────────────────────────────────────────────── */
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>REACT Premium Escape Rooms</h1>
        <h2 style={styles.subtitle}>Participant Waiver</h2>

        <div style={styles.waiverText}>
          <p>
            By signing this waiver, I acknowledge that participation in escape room
            activities at REACT Premium Escape Rooms involves physical and mental
            challenges. I agree to follow all safety instructions provided by staff.
            I understand that I participate at my own risk and release REACT Premium
            Escape Rooms, its owners, employees, and agents from any liability for
            injury or loss that may occur during my visit.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Full Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              placeholder="Your full name"
            />
          </label>

          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="your@email.com"
            />
          </label>

          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            I have read and agree to the waiver terms above
          </label>

          <div style={styles.sigSection}>
            <p style={styles.sigLabel}>Signature</p>
            <canvas
              ref={canvasRef}
              width={320}
              height={150}
              style={styles.canvas}
            />
            <button type="button" onClick={clearPad} style={styles.clearBtn}>
              Clear Signature
            </button>
          </div>

          {errorMsg && <p style={styles.error}>{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              ...styles.button,
              opacity: status === "sending" ? 0.6 : 1,
            }}
          >
            {status === "sending" ? "Submitting..." : "Sign Waiver"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── styles ──────────────────────────────────────────────── */
const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#111",
    padding: 16,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    background: "#1a1a1a",
    borderRadius: 12,
    padding: 32,
    maxWidth: 420,
    width: "100%",
    color: "#e5e5e5",
  },
  title: {
    color: "#ef4444",
    fontSize: 22,
    fontWeight: 700,
    textAlign: "center",
    margin: 0,
  },
  subtitle: {
    color: "#999",
    fontSize: 14,
    fontWeight: 400,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  waiverText: {
    background: "#222",
    borderRadius: 8,
    padding: 16,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#aaa",
    marginBottom: 20,
    maxHeight: 160,
    overflowY: "auto",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #333",
    background: "#222",
    color: "#fff",
    fontSize: 15,
    outline: "none",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    color: "#ccc",
    cursor: "pointer",
  },
  sigSection: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sigLabel: {
    fontSize: 14,
    fontWeight: 500,
    margin: 0,
  },
  canvas: {
    background: "#fff",
    borderRadius: 6,
    cursor: "crosshair",
    touchAction: "none",
    maxWidth: "100%",
  },
  clearBtn: {
    alignSelf: "flex-start",
    background: "none",
    border: "none",
    color: "#888",
    fontSize: 12,
    cursor: "pointer",
    padding: 0,
    textDecoration: "underline",
  },
  button: {
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "12px 0",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
  },
  successBox: {
    textAlign: "center",
    padding: "40px 20px",
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    margin: 0,
  },
};
