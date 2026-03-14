import { useState, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://wtspmrqnatbnexinspzb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0c3BtcnFuYXRibmV4aW5zcHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzEzOTUsImV4cCI6MjA4NzYwNzM5NX0.OYC11RHMHiUTRoKzVJQxFkO656bXZDAaQbz6j6XTAZ0'
);

const LOGO_URL = 'https://static.wixstatic.com/media/bbef2a_e5182ebf7aa047b99c23c4c98fec29db~mv2.png/v1/fill/w_276,h_110,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/HD%2520Logo-Transparent%2520BG-01_edited.png';

const ADMIN_PASSWORD = 'Admin';

// ============================================================
// WAIVER FORM
// ============================================================
function WaiverForm() {
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

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />

        <h1 style={styles.title}>Participant Waiver</h1>
        <p style={styles.subtitle}>
          Please complete this waiver before your adventure.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your full name"
            style={styles.input}
          />

          <label style={styles.label}>Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            style={styles.input}
          />

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

          <div style={styles.waiverBox}>
            <p style={styles.waiverText}>
              By signing this waiver, I acknowledge and agree to the following terms as a
              condition of participating in any activity at REACT Premium Escape Rooms, owned
              and operated by B.R. Entertainment LLC, on behalf of myself and any members of
              my group:
              <br /><br />
              I will comply with all rules, regulations, and instructions issued by REACT
              staff during my visit.
              <br /><br />
              I accept financial responsibility for any damages caused by negligent or
              reckless actions by myself or members of my group.
              <br /><br />
              I release and hold harmless REACT Premium Escape Rooms, B.R. Entertainment LLC,
              and their owners, employees, and agents from any and all liability arising from
              my use of or presence upon their facilities.
              <br /><br />
              I have read this Release of Liability, assume all risks associated with
              participation, and sign voluntarily and without inducement.
              {isMinor && (
                <><br /><br />
                As the parent, guardian, or representative of the minor named above, I certify
                that I am authorized to sign on their behalf and accept responsibility for
                their participation.</>
              )}
            </p>
          </div>

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

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={{
            ...styles.button,
            opacity: loading ? 0.6 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'Submitting...' : 'Submit Waiver'}
          </button>
        </form>

        <p style={styles.footer}>
          REACT Premium Escape Rooms · 1 Corporate Dr, Suite 102, Windsor Locks, CT 06096
        </p>
      </div>
    </div>
  );
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================
function AdminDashboard({ onLogout }) {
  const [waivers, setWaivers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWaiver, setSelectedWaiver] = useState(null);

  useEffect(() => {
    fetchWaivers();
  }, []);

  const fetchWaivers = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: dbError } = await supabase
        .from('Waivers')
        .select('*')
        .order('created_at', { ascending: false });

      if (dbError) throw dbError;
      setWaivers(data || []);
    } catch (err) {
      setError('Failed to load waivers.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = waivers.filter((w) => {
    const q = search.toLowerCase();
    return (
      (w.full_name || '').toLowerCase().includes(q) ||
      (w.email || '').toLowerCase().includes(q) ||
      (w.minor_name || '').toLowerCase().includes(q)
    );
  });

  const exportCSV = () => {
    const headers = ['Date', 'Full Name', 'Email', 'Minor', 'Minor Name'];
    const rows = filtered.map((w) => [
      new Date(w.created_at).toLocaleDateString(),
      w.full_name || '',
      w.email || '',
      w.is_minor ? 'Yes' : 'No',
      w.minor_name || '',
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'react-waivers-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Waiver detail modal
  if (selectedWaiver) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.card, maxWidth: '600px' }}>
          <div style={admin.headerRow}>
            <h2 style={styles.title}>Waiver Details</h2>
            <button onClick={() => setSelectedWaiver(null)} style={admin.backBtn}>
              ← Back
            </button>
          </div>

          <div style={admin.detailGroup}>
            <span style={admin.detailLabel}>Name</span>
            <span style={admin.detailValue}>{selectedWaiver.full_name}</span>
          </div>
          <div style={admin.detailGroup}>
            <span style={admin.detailLabel}>Email</span>
            <span style={admin.detailValue}>{selectedWaiver.email}</span>
          </div>
          <div style={admin.detailGroup}>
            <span style={admin.detailLabel}>Date</span>
            <span style={admin.detailValue}>{formatDate(selectedWaiver.created_at)}</span>
          </div>
          <div style={admin.detailGroup}>
            <span style={admin.detailLabel}>Minor</span>
            <span style={admin.detailValue}>
              {selectedWaiver.is_minor ? 'Yes — ' + (selectedWaiver.minor_name || 'N/A') : 'No'}
            </span>
          </div>
          {selectedWaiver.signature_url && (
            <div style={admin.detailGroup}>
              <span style={admin.detailLabel}>Signature</span>
              <img
                src={selectedWaiver.signature_url}
                alt="Signature"
                style={admin.signatureImg}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: '700px' }}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
        <h1 style={styles.title}>Waiver Dashboard</h1>
        <p style={{ ...styles.subtitle, marginBottom: '20px' }}>
          {waivers.length} total waiver{waivers.length !== 1 ? 's' : ''} on file
        </p>

        <div style={admin.toolbar}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or minor..."
            style={{ ...styles.input, marginBottom: 0, flex: 1 }}
          />
          <button onClick={exportCSV} style={admin.exportBtn}>
            Export CSV
          </button>
        </div>

        <div style={admin.actionRow}>
          <button onClick={fetchWaivers} style={admin.refreshBtn}>
            ↻ Refresh
          </button>
          <button onClick={onLogout} style={admin.logoutBtn}>
            Log Out
          </button>
        </div>

        {loading && <p style={admin.statusText}>Loading waivers...</p>}
        {error && <p style={styles.error}>{error}</p>}

        {!loading && filtered.length === 0 && (
          <p style={admin.statusText}>
            {search ? 'No waivers match your search.' : 'No waivers found.'}
          </p>
        )}

        {!loading && filtered.length > 0 && (
          <div style={admin.tableWrap}>
            <table style={admin.table}>
              <thead>
                <tr>
                  <th style={admin.th}>Date</th>
                  <th style={admin.th}>Name</th>
                  <th style={admin.th}>Email</th>
                  <th style={admin.th}>Minor</th>
                  <th style={admin.th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => (
                  <tr key={w.id} style={admin.tr}>
                    <td style={admin.td}>{new Date(w.created_at).toLocaleDateString()}</td>
                    <td style={admin.td}>{w.full_name}</td>
                    <td style={admin.td}>{w.email}</td>
                    <td style={admin.td}>
                      {w.is_minor ? (w.minor_name || 'Yes') : '—'}
                    </td>
                    <td style={admin.td}>
                      <button
                        onClick={() => setSelectedWaiver(w)}
                        style={admin.viewBtn}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={styles.footer}>
          REACT Premium Escape Rooms · Admin Dashboard
        </p>
      </div>
    </div>
  );
}

// ============================================================
// ADMIN LOGIN
// ============================================================
function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      onLogin();
    } else {
      setError('Incorrect password.');
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: '400px' }}>
        <img src={LOGO_URL} alt="REACT Premium Escape Rooms" style={styles.logo} />
        <h1 style={styles.title}>Admin Login</h1>
        <p style={styles.subtitle}>Enter the admin password to continue.</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            style={styles.input}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.button}>
            Log In
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP (Router)
// ============================================================
export default function App() {
  const [page, setPage] = useState('waiver');
  const [adminAuth, setAdminAuth] = useState(false);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'admin') {
        setPage('admin');
      } else {
        setPage('waiver');
      }
    };

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  if (page === 'admin') {
    if (!adminAuth) {
      return <AdminLogin onLogin={() => setAdminAuth(true)} />;
    }
    return (
      <AdminDashboard
        onLogout={() => {
          setAdminAuth(false);
          window.location.hash = '';
        }}
      />
    );
  }

  return <WaiverForm />;
}

// ============================================================
// STYLES — Waiver Form
// ============================================================
const styles = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '40px 16px',
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    background: '#111111',
    border: '1px solid #1a3a5c',
    borderRadius: '12px',
    padding: '36px 28px',
    boxShadow: '0 0 40px rgba(0, 100, 200, 0.08)',
  },
  logo: {
    display: 'block',
    margin: '0 auto 24px',
    maxWidth: '220px',
    height: 'auto',
  },
  title: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    textAlign: 'center',
    margin: '0 0 6px',
    letterSpacing: '0.5px',
  },
  subtitle: {
    color: '#7a8a9a',
    fontSize: '14px',
    textAlign: 'center',
    margin: '0 0 28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    color: '#c0d0e0',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
  },
  input: {
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    padding: '12px 14px',
    color: '#e0e8f0',
    fontSize: '15px',
    marginBottom: '18px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '18px',
  },
  checkbox: {
    marginTop: '3px',
    accentColor: '#00bfff',
    width: '18px',
    height: '18px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  checkboxLabel: {
    color: '#b0c0d0',
    fontSize: '14px',
    lineHeight: '1.4',
    cursor: 'pointer',
  },
  waiverBox: {
    background: '#0a1520',
    border: '1px solid #1a2a3a',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '18px',
    maxHeight: '160px',
    overflowY: 'auto',
  },
  waiverText: {
    color: '#8090a0',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: 0,
  },
  canvas: {
    width: '100%',
    height: '120px',
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    cursor: 'crosshair',
    touchAction: 'none',
    marginBottom: '8px',
  },
  clearBtn: {
    alignSelf: 'flex-end',
    background: 'transparent',
    border: 'none',
    color: '#4a6a8a',
    fontSize: '12px',
    cursor: 'pointer',
    padding: '4px 0',
    marginBottom: '20px',
    textDecoration: 'underline',
  },
  error: {
    color: '#ff4466',
    fontSize: '13px',
    textAlign: 'center',
    marginBottom: '14px',
  },
  button: {
    background: 'linear-gradient(135deg, #0066cc, #00bfff)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '14px',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    letterSpacing: '0.5px',
    transition: 'opacity 0.2s',
  },
  successIcon: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #0066cc, #00bfff)',
    color: '#fff',
    fontSize: '30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 16px',
    fontWeight: '700',
  },
  successTitle: {
    color: '#ffffff',
    fontSize: '22px',
    fontWeight: '700',
    textAlign: 'center',
    margin: '0 0 10px',
  },
  successText: {
    color: '#b0c0d0',
    fontSize: '15px',
    textAlign: 'center',
    margin: '0 0 6px',
    lineHeight: '1.5',
  },
  successSubtext: {
    color: '#5a7a9a',
    fontSize: '13px',
    textAlign: 'center',
    margin: '0 0 24px',
  },
  footer: {
    color: '#3a4a5a',
    fontSize: '11px',
    textAlign: 'center',
    marginTop: '28px',
    lineHeight: '1.4',
  },
};

// ============================================================
// STYLES — Admin Dashboard
// ============================================================
const admin = {
  toolbar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '12px',
    alignItems: 'center',
  },
  exportBtn: {
    background: '#1a3a5c',
    color: '#c0d0e0',
    border: '1px solid #2a4a6c',
    borderRadius: '8px',
    padding: '12px 18px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  actionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '20px',
  },
  refreshBtn: {
    background: 'transparent',
    border: 'none',
    color: '#4a8abf',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  logoutBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6a4a4a',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 0',
  },
  statusText: {
    color: '#5a7a9a',
    fontSize: '14px',
    textAlign: 'center',
    padding: '40px 0',
  },
  tableWrap: {
    overflowX: 'auto',
    borderRadius: '8px',
    border: '1px solid #1a2a3a',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    color: '#7a8a9a',
    fontWeight: '600',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid #1a2a3a',
    background: '#0a1520',
  },
  tr: {
    borderBottom: '1px solid #141e2a',
  },
  td: {
    padding: '10px 12px',
    color: '#b0c0d0',
    verticalAlign: 'middle',
  },
  viewBtn: {
    background: 'transparent',
    border: '1px solid #1a3a5c',
    color: '#4a9adf',
    borderRadius: '6px',
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: '#4a9adf',
    fontSize: '14px',
    cursor: 'pointer',
  },
  detailGroup: {
    marginBottom: '18px',
  },
  detailLabel: {
    display: 'block',
    color: '#7a8a9a',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  detailValue: {
    color: '#e0e8f0',
    fontSize: '15px',
  },
  signatureImg: {
    maxWidth: '100%',
    height: 'auto',
    background: '#0d1b2a',
    border: '1px solid #1a3a5c',
    borderRadius: '8px',
    padding: '8px',
    marginTop: '4px',
  },
};
